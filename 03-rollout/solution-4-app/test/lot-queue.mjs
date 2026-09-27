// בודק את "הליפט לא מחכה" (018) מול המסד האמיתי: אישור בקבלה, תור וחניה,
// מי רשאי להחזיר לתור, מסלול המחירון, התזכורת ללקוח, ורישום התזוזות.
//
// הרצה:
//   node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local \
//        --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-4-app/test/lot-queue.mjs
//
// למה זה קיים: הכלל "דניאל מחזיר לתור, לא המכונאי" ו"מחיר קבוע עד 500 יוצא ישר
// ללקוח" הם כללים של כסף ושל הבטחות ללקוח. אם הם נאכפים רק בכפתור, מספיק
// מכונאי אחד עם כלי פיתוח כדי לעקוף אותם. כאן בודקים שהמסד עצמו אוכף.
//
// כל מה שנוצר כאן נמחק בסוף, גם אם בדיקה נכשלה.

import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY
const botToken = process.env.GARAGE_BOT_TOKEN
if (!serviceKey) throw new Error("חסר SUPABASE_SECRET_KEY (levi-garage/.env.local)")

let pass = 0
let fail = 0
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`)
  }
}

const call = (path, { token = anonKey, key = anonKey, ...init } = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
const patchJob = (id, body, token) => call(`/rest/v1/job_cards?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body), token })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
const otherMechanic = await signIn("test2@test.com")
const screen = await signIn("screen2@test.com")

const items = await (await admin(`/rest/v1/price_list?select=id,code,fixed_price,price_original`)).json()
const item = (code) => items.find((i) => i.code === code)

const PLATE = "9990018"
const jobs = []

async function newJob(extra = {}) {
  const res = await call(`/rest/v1/job_cards`, {
    method: "POST",
    token: manager,
    body: JSON.stringify({
      plate: PLATE,
      customer_name: "בדיקה אוטומטית",
      customer_phone: null,
      status: "open",
      lift: null,
      updates_consent_at: new Date().toISOString(),
      work_approved_at: new Date().toISOString(),
      ...extra,
    }),
  })
  const [row] = await res.json()
  if (!row?.id) throw new Error(`job insert: ${res.status}`)
  jobs.push(row.id)
  return row.id
}
const job = async (id) => (await (await admin(`/rest/v1/job_cards?id=eq.${id}&select=*`)).json())[0]
const moves = async (id) => (await (await admin(`/rest/v1/job_moves?job_card_id=eq.${id}&select=place,lift&order=moved_at`)).json()).map((m) => m.place)

try {
  // ---------------------------------------------------------------- חניה ותור
  const a = await newJob()
  ok("כרטיס חדש נרשם כ'בחניה, בתור'", (await moves(a)).join(",") === "lot")

  await patchJob(a, { lift: 3, status: "in_progress" }, mechanic)
  ok("המכונאי מושך לליפט", (await job(a)).lift === 3)

  const lowered = await patchJob(a, { lift: null, parked_at: new Date().toISOString() }, mechanic)
  const afterLower = await job(a)
  ok("המכונאי מוריד לחניה", lowered.ok && afterLower.lift === null && afterLower.parked_at !== null, `status ${lowered.status}`)

  const unpark = await patchJob(a, { parked_at: null }, mechanic)
  ok("מכונאי לא מחזיר לתור רכב שחונה", !unpark.ok && (await job(a)).parked_at !== null, `status ${unpark.status}`)
  const liftParked = await patchJob(a, { lift: 2 }, mechanic)
  ok("מכונאי לא מעלה לליפט רכב שחונה", !liftParked.ok && (await job(a)).lift === null, `status ${liftParked.status}`)
  const prio = await patchJob(a, { priority_at: new Date().toISOString() }, otherMechanic)
  ok("מכונאי לא מקדים בתור", !prio.ok, `status ${prio.status}`)

  const requeue = await patchJob(a, { parked_at: null, priority_at: new Date().toISOString() }, manager)
  const afterRequeue = await job(a)
  ok("דניאל מחזיר לתור, לראש התור", requeue.ok && afterRequeue.parked_at === null && afterRequeue.priority_at !== null)

  await patchJob(a, { lift: 4 }, mechanic)
  const reLifted = await job(a)
  ok("עלייה לליפט מנקה את הקדימות", reLifted.lift === 4 && reLifted.priority_at === null)

  await patchJob(a, { outside_at: new Date().toISOString(), lift: null }, manager)
  await patchJob(a, { status: "ready" }, manager)
  const doneCard = await job(a)
  ok("רכב מוכן יוצא מכל תור", doneCard.outside_at === null && doneCard.parked_at === null && doneCard.priority_at === null)
  ok("כל תזוזה נרשמה", (await moves(a)).join(",") === "lot,lift,parked,lot,lift,outside,done", (await moves(a)).join(","))

  const mechMoves = await (await call(`/rest/v1/job_moves?job_card_id=eq.${a}&select=place`, { token: mechanic })).json()
  ok("מכונאי קורא את התזוזות", Array.isArray(mechMoves) && mechMoves.length === 7)
  const screenMoves = await (await call(`/rest/v1/job_moves?job_card_id=eq.${a}&select=place`, { token: screen })).json()
  ok("מסך תלוי לא קורא את התזוזות", Array.isArray(screenMoves) && screenMoves.length === 0)
  const forge = await call(`/rest/v1/job_moves`, { method: "POST", token: manager, body: JSON.stringify({ job_card_id: a, place: "lift", status: "open" }) })
  ok("אי אפשר לזייף תזוזה", !forge.ok, `status ${forge.status}`)

  // ---------------------------------------------------------------- מסלול המחירון
  const b = await newJob({ lift: 1, status: "in_progress" })
  ok("המגבים במחיר קבוע, והרפידות לא", item("wipers").fixed_price === true && item("brakes-front-pads").fixed_price === false)

  const anonPick = await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("wipers").id })
  ok("אורח לא מוסיף ממצא", !anonPick.ok, `status ${anonPick.status}`)

  const wipers = await (await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("wipers").id }, mechanic)).json()
  ok("מגבים (180 ש\"ח, מחיר קבוע): יוצא ללקוח מיד", wipers?.sent === true && typeof wipers?.token === "string", JSON.stringify(wipers))
  const [f1] = await (await admin(`/rest/v1/findings?id=eq.${wipers.finding_id}&select=*,approvals(token,message_text)`)).json()
  ok("הממצא שלם לפי החוק: מחיר, שעות, אחריות, חלופה", f1.price_original === 180 && Number(f1.labor_hours) > 0 && f1.warranty_original && f1.price_aftermarket && f1.part_diff, JSON.stringify({ p: f1.price_original, h: f1.labor_hours }))
  const ap1 = Array.isArray(f1.approvals) ? f1.approvals[0] : f1.approvals
  ok("מסומן 'מהמחירון' ו'ישיר', עם קישור", f1.source === "pricelist" && f1.direct === true && f1.status === "sent" && ap1?.token === wipers.token)
  ok("בטקסט ללקוח אין מחיר (המחיר בדף האישור)", !/\d{2,}/.test(f1.customer_text ?? ""), f1.customer_text)
  ok("הכרטיס עובר ל'מחכה ללקוח'", (await job(b)).status === "waiting_approval")

  const twice = await (await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("wipers").id }, mechanic)).json()
  ok("לחיצה שנייה על אותו כפתור לא פותחת ממצא שני", twice?.sent === false && twice?.why === "exists" && twice?.finding_id === wipers.finding_id)

  const pads = await (await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("brakes-front-pads").id }, mechanic)).json()
  ok("רפידות (מחיר לפי דגם): טיוטה אצל דניאל", pads?.sent === false && pads?.why === "price_by_model", JSON.stringify(pads))
  const [f2] = await (await admin(`/rest/v1/findings?id=eq.${pads.finding_id}&select=status,direct`)).json()
  ok("הטיוטה לא ישירה ולא נשלחה", f2.status === "draft" && f2.direct === false)

  const claimMine = await rpc("claim_quote_notice", { p_finding_id: wipers.finding_id }, mechanic)
  ok("המכונאי ששלח מהמחירון מבקש את הוואטסאפ ללקוח", claimMine.ok, `status ${claimMine.status}`)
  const claimOther = await rpc("claim_quote_notice", { p_finding_id: wipers.finding_id }, otherMechanic)
  ok("מכונאי אחר לא", !claimOther.ok, `status ${claimOther.status}`)
  const claimDraft = await rpc("claim_quote_notice", { p_finding_id: pads.finding_id }, mechanic)
  ok("ולא על ממצא שלא יצא ישר", !claimDraft.ok, `status ${claimDraft.status}`)

  const c = await newJob({ lift: 2, status: "in_progress", updates_consent_at: null, whatsapp_consent: false })
  const noConsent = await (await rpc("add_price_list_finding", { p_job_id: c, p_price_list_id: item("wipers").id }, mechanic)).json()
  ok("לקוח בלי הסכמה לעדכונים: לדניאל, לא ישר (ס' 132(ב))", noConsent?.sent === false && noConsent?.why === "no_consent")

  // ---------------------------------------------------------------- תזכורת ללקוח
  const badNudge = await rpc("claim_due_nudges", { p_secret: "wrong" })
  ok("תזכורות: טוקן שגוי נדחה", !badNudge.ok, `status ${badNudge.status}`)

  if (!botToken) {
    console.log("SKIP  תזכורת אחרי 30 דקות — חסר GARAGE_BOT_TOKEN (להוסיף --env-file של .env.wiring.local)")
  } else {
    // השעון של המסד לא תלוי בשעה שבה הבדיקה רצה: שואלים "מה היה קורה ב-10:00"
    // וב-22:00 של היום, והקישור של המגבים "נשלח" 40 דקות לפני 10:00.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date())
    const off = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" })
      .formatToParts(new Date()).find((x) => x.type === "timeZoneName").value.replace("GMT", "")
    const [, sign, hours] = off.match(/([+-])(\d+)/)
    const at = (hh) => new Date(`${day}T${hh}:00:00${sign}${hours.padStart(2, "0")}:00`).toISOString()
    const ten = at("10")
    await admin(`/rest/v1/approvals?finding_id=eq.${wipers.finding_id}`, {
      method: "PATCH",
      body: JSON.stringify({ sent_at: new Date(new Date(ten).getTime() - 40 * 60 * 1000).toISOString() }),
    })

    const night = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: at("22") })).json()
    ok("ב-22:00 אין תזכורות", Array.isArray(night) && night.length === 0)

    const early = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: new Date(new Date(ten).getTime() - 20 * 60 * 1000).toISOString() })).json()
    ok("20 דקות אחרי השליחה: עוד לא", Array.isArray(early) && !early.some((x) => x.token === wipers.token))

    const claims = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: ten })).json()
    const [ap] = await (await admin(`/rest/v1/approvals?finding_id=eq.${wipers.finding_id}&select=nudged_at`)).json()
    const notices = await (await admin(`/rest/v1/customer_notices?job_card_id=eq.${b}&kind=eq.nudge&select=status,reason`)).json()
    ok("40 דקות בלי תשובה, ב-10:00: הקישור נתפס לתזכורת", Boolean(ap.nudged_at) && notices.length === 1, JSON.stringify({ ap, notices }))
    ok("בלי הסכמה לוואטסאפ: לא נשלח, ונרשם למה", notices[0]?.status === "skipped" && notices[0]?.reason === "no_consent", JSON.stringify(notices))
    ok("ולא נכנס לרשימת השליחה לבוט", Array.isArray(claims) && !claims.some((x) => x.token === wipers.token))
    const again = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: ten })).json()
    ok("תזכורת אחת לכל קישור", Array.isArray(again) && !again.some((x) => x.token === wipers.token))
  }
} finally {
  for (const id of jobs) {
    const fs = await (await admin(`/rest/v1/findings?job_card_id=eq.${id}&select=id`)).json()
    for (const f of fs) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    await admin(`/rest/v1/findings?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/customer_notices?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  const left = await (await admin(`/rest/v1/job_cards?plate=eq.${PLATE}&select=id`)).json()
  ok("נוקה: לא נשאר כרטיס בדיקה", left.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
