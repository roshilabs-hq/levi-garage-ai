// בודק את "הליפט לא מחכה" (018) מול המסד האמיתי: אישור בקבלה, תור וחניה,
// מי רשאי להחזיר לתור, מסלול המחירון, התזכורת ללקוח, ורישום התזוזות.
//
// הרצה:
//   node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local \
//        --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-4-app/test/lot-queue.mjs
//
// למה זה קיים: הכללים "דניאל מחזיר לתור, לא המכונאי" ו"רק דניאל שולח ללקוח, הודעה
// אחת עם כל הממצאים" (027) הם כללים של כסף ושל הבטחות ללקוח. אם הם נאכפים רק בכפתור, מספיק
// מכונאי אחד עם כלי פיתוח כדי לעקוף אותם. כאן בודקים שהמסד עצמו אוכף.
//
// כל מה שנוצר כאן נמחק בסוף, גם אם בדיקה נכשלה.

import { passwordFor, readable } from "./_auth.mjs"

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
  fetch(`${url}${readable(path, token)}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
// 051 (ביקורת אבטחה חיצונית, 7.10): מכונאי פועל רק על הרכב שעל הליפט שהוא עובד עליו. כמו
// באפליקציה (כניסה לעמדה, ו"למשוך לליפט" שמעלה לליפט של המכונאי), לפני כל פעולה של מכונאי
// הוא "עומד" ליד הליפט של הרכב, או ליד הליפט שאליו הוא מעלה אותו.
// מ-057 הליפט שייך לכניסה בעמדה: המכונאי "עומד" ליד ליפט כשהוא נרשם בעמדה שלו, כמו מכשיר אמיתי.
// עמדות הבדיקה נוצרות פעם אחת לכל ליפט, ונמחקות בסוף.
const mechanics = new Map()
const STATION_LABEL = "עמדת בדיקה אוטומטית (lot-queue)"
const stationTokens = {}
const jobLift = async (id) => (await (await admin(`/rest/v1/job_cards?id=eq.${id}&select=lift`)).json())[0]?.lift ?? null
const standAt = async (token, lift) => {
  if (!mechanics.has(token) || lift == null) return
  stationTokens[lift] ??= await (await call(`/rest/v1/rpc/create_station`, { method: "POST", body: JSON.stringify({ p_label: STATION_LABEL, p_lift: lift }), token: manager })).json()
  await call(`/rest/v1/rpc/bind_station_session`, { method: "POST", body: JSON.stringify({ p_token: stationTokens[lift] }), token })
}
const rpc = async (fn, body, token) => {
  if (body?.p_job_id) await standAt(token, await jobLift(body.p_job_id))
  return call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
}
const patchJob = async (id, body, token) => {
  await standAt(token, "lift" in body && body.lift !== null ? body.lift : await jobLift(id))
  return call(`/rest/v1/job_cards?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body), token })
}

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
const otherMechanic = await signIn("test2@test.com")
const screen = await signIn("screen2@test.com")
const idOf = async (token) => (await (await call(`/auth/v1/user`, { token })).json()).id
mechanics.set(mechanic, await idOf(mechanic))
mechanics.set(otherMechanic, await idOf(otherMechanic))
const liftsBefore = await (await admin(`/rest/v1/staff?id=in.(${[...mechanics.values()].join(",")})&select=id,lift`)).json()

const items = await (await admin(`/rest/v1/price_list?select=id,code,fixed_price,price_original`)).json()
const item = (code) => items.find((i) => i.code === code)

const PLATE = "9990018"
const jobs = []

// הכרטיס נוצר כמאושר. מ-043 אף עובד לא כותב אישור ישירות (רק הלקוח בקישור,
// או "חתם"), ולכן ההכנה נעשית במפתח השירות, כמו קבלה שהלקוח כבר אישר.
async function newJob(extra = {}) {
  const res = await call(`/rest/v1/job_cards`, {
    method: "POST",
    token: serviceKey,
    key: serviceKey,
    headers: { prefer: "return=representation" },
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

  // 063: מכונאי מוריד מליפט רק דרך lower_car, עם "סגור וכשיר לנסיעה"
  await standAt(mechanic, await jobLift(a))
  const lowered = await call(`/rest/v1/rpc/lower_car`, { method: "POST", body: JSON.stringify({ p_job_id: a, p_fit: true }), token: mechanic })
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
  // מ-054 "מוכן" רק אחרי אבחון, גם במסד
  await admin(`/rest/v1/job_cards?id=eq.${a}`, { method: "PATCH", body: JSON.stringify({ inspected_at: new Date().toISOString() }) })
  const readyRes = await patchJob(a, { status: "ready" }, manager)
  if (!readyRes.ok) console.log("  'מוכן' נדחה:", (await readyRes.json().catch(() => ({}))).hint)
  const doneCard = await job(a)
  ok("רכב מוכן יוצא מכל תור", doneCard.outside_at === null && doneCard.parked_at === null && doneCard.priority_at === null)
  ok("כל תזוזה נרשמה", (await moves(a)).join(",") === "lot,lift,parked,lot,lift,outside,done", (await moves(a)).join(","))

  const mechMoves = await (await call(`/rest/v1/job_moves?job_card_id=eq.${a}&select=place`, { token: mechanic })).json()
  ok("מכונאי קורא את התזוזות", Array.isArray(mechMoves) && mechMoves.length === 7)
  const screenMoves = await (await call(`/rest/v1/job_moves?job_card_id=eq.${a}&select=place`, { token: screen })).json()
  ok("מסך תלוי לא קורא את התזוזות", Array.isArray(screenMoves) && screenMoves.length === 0)
  const forge = await call(`/rest/v1/job_moves`, { method: "POST", token: manager, body: JSON.stringify({ job_card_id: a, place: "lift", status: "open" }) })
  ok("אי אפשר לזייף תזוזה", !forge.ok, `status ${forge.status}`)

  // ---------------------------------------------------------------- מסלול המחירון (027)
  // מ-30.9: שום דבר לא יוצא ללקוח מהעמדה. הממצא נכנס לדניאל מתומחר, והוא שולח
  // הודעה אחת עם כל הממצאים (רועי: "ממש לא. הודעה אחת מרוכזת, על ידי דניאל").
  const b = await newJob({ lift: 1, status: "in_progress" })
  ok("המגבים במחיר קבוע, והרפידות לא", item("wipers").fixed_price === true && item("brakes-front-pads").fixed_price === false)

  const anonPick = await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("wipers").id })
  ok("אורח לא מוסיף ממצא", !anonPick.ok, `status ${anonPick.status}`)

  const wipers = await (await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("wipers").id }, mechanic)).json()
  ok("מגבים מהעמדה: לא יוצא ללקוח, עובר לדניאל", wipers?.sent === false && wipers?.why === "daniel" && !wipers?.token, JSON.stringify(wipers))
  const [f1] = await (await admin(`/rest/v1/findings?id=eq.${wipers.finding_id}&select=*`)).json()
  ok("הממצא שלם לפי החוק: מחיר, שעות, אחריות, חלופה", f1.price_original === 180 && Number(f1.labor_hours) > 0 && f1.warranty_original && f1.price_aftermarket && f1.part_diff, JSON.stringify({ p: f1.price_original, h: f1.labor_hours }))
  ok("טיוטה מהמחירון, לא ישירה", f1.source === "pricelist" && f1.direct === false && f1.status === "draft")
  ok("בטקסט ללקוח אין מחיר (המחיר בדף האישור)", !/\d{2,}/.test(f1.customer_text ?? ""), f1.customer_text)
  ok("הכרטיס עובר ל'מחכה לשליחה'", (await job(b)).status === "waiting_quote")

  const twice = await (await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("wipers").id }, mechanic)).json()
  ok("לחיצה שנייה על אותו כפתור לא פותחת ממצא שני", twice?.sent === false && twice?.why === "exists" && twice?.finding_id === wipers.finding_id)

  const pads = await (await rpc("add_price_list_finding", { p_job_id: b, p_price_list_id: item("brakes-front-pads").id }, mechanic)).json()
  ok("רפידות: גם טיוטה אצל דניאל", pads?.sent === false && pads?.why === "daniel", JSON.stringify(pads))

  // ---------------------------------------------------------------- הודעה אחת ללקוח (027)
  const mechSend = await rpc("send_quote_request", { p_job_id: b, p_finding_ids: [wipers.finding_id, pads.finding_id] }, mechanic)
  ok("מכונאי לא שולח ללקוח", !mechSend.ok, `status ${mechSend.status}`)
  const mechClaim = await rpc("claim_quote_notice", { p_finding_id: wipers.finding_id }, mechanic)
  ok("וגם לא מבקש וואטסאפ ללקוח", !mechClaim.ok, `status ${mechClaim.status}`)

  const sendRes = await rpc("send_quote_request", { p_job_id: b, p_finding_ids: [wipers.finding_id, pads.finding_id] }, manager)
  const reqToken = await sendRes.json()
  ok("דניאל שולח את שני הממצאים בבקשה אחת", sendRes.ok && /^[0-9a-f]{36}$/.test(reqToken), JSON.stringify(reqToken))
  const reqs = await (await admin(`/rest/v1/quote_requests?job_card_id=eq.${b}&select=id,token`)).json()
  const aps = await (await admin(`/rest/v1/approvals?finding_id=in.(${wipers.finding_id},${pads.finding_id})&select=request_id,token`)).json()
  ok("קישור אחד לשניהם", reqs.length === 1 && aps.length === 2 && aps.every((x) => x.request_id === reqs[0].id), JSON.stringify({ reqs, aps }))
  ok("הכרטיס עובר ל'מחכה ללקוח'", (await job(b)).status === "waiting_approval")

  const resend = await rpc("send_quote_request", { p_job_id: b, p_finding_ids: [wipers.finding_id] }, manager)
  ok("ממצא שכבר נשלח לא נשלח שוב", !resend.ok, `status ${resend.status}`)

  const view = await (await rpc("request_view", { p_token: reqToken })).json()
  ok("הלקוח, בלי התחברות, רואה את שני הממצאים בקישור", Array.isArray(view) && view.length === 2, JSON.stringify(view).slice(0, 120))
  const badView = await (await rpc("request_view", { p_token: "0".repeat(36) })).json()
  ok("קישור מומצא לא מראה כלום", Array.isArray(badView) && badView.length === 0)

  const claimReq = await rpc("claim_request_notice", { p_request_id: reqs[0].id }, manager)
  const claimBody = await claimReq.json()
  ok("וואטסאפ אחד לבקשה (כאן: בלי הסכמה לוואטסאפ, ונרשם למה)", claimReq.ok && claimBody?.send === false, JSON.stringify(claimBody))
  const quoteNotices = await (await admin(`/rest/v1/customer_notices?job_card_id=eq.${b}&kind=eq.quote&select=ref,status,reason`)).json()
  ok("הודעה אחת בלבד, על הקישור של הבקשה", quoteNotices.length === 1 && quoteNotices[0].ref === reqToken, JSON.stringify(quoteNotices))

  const partial = await rpc("request_decide", { p_token: reqToken, p_decisions: [{ finding_id: wipers.finding_id, decision: "approved", part_choice: "original" }] })
  ok("הלקוח צריך להכריע על כל הממצאים יחד", !partial.ok, `status ${partial.status}`)
  const decided = await (await rpc("request_decide", {
    p_token: reqToken,
    p_decisions: [
      { finding_id: wipers.finding_id, decision: "approved", part_choice: "aftermarket" },
      { finding_id: pads.finding_id, decision: "declined", part_choice: null },
    ],
  })).json()
  const [w2] = await (await admin(`/rest/v1/findings?id=eq.${wipers.finding_id}&select=status,approvals(part_choice,price_chosen)`)).json()
  const [p2] = await (await admin(`/rest/v1/findings?id=eq.${pads.finding_id}&select=status`)).json()
  const wa = Array.isArray(w2.approvals) ? w2.approvals[0] : w2.approvals
  ok("אישר מגבים (חלופי), דחה רפידות", decided === "done" && w2.status === "approved" && wa?.part_choice === "aftermarket" && Number(wa?.price_chosen) === 110 && p2.status === "declined", JSON.stringify({ decided, w2, p2 }))
  ok("אחרי התשובה הרכב חוזר לעבודה", (await job(b)).status === "in_progress")
  const again = await (await rpc("request_decide", { p_token: reqToken, p_decisions: [{ finding_id: wipers.finding_id, decision: "declined" }] })).json()
  ok("אי אפשר לשנות תשובה אחרי שנשלחה", again === "unavailable", JSON.stringify(again))

  const c = await newJob({ lift: 2, status: "in_progress", updates_consent_at: null, whatsapp_consent: false })
  const cw = await (await rpc("add_price_list_finding", { p_job_id: c, p_price_list_id: item("wipers").id }, mechanic)).json()
  const noConsent = await rpc("send_quote_request", { p_job_id: c, p_finding_ids: [cw.finding_id] }, manager)
  const ncBody = await noConsent.json()
  ok("לקוח בלי הסכמה לעדכונים: המסד לא שולח (ס' 132(ב))", !noConsent.ok && ncBody?.hint === "law-132b", JSON.stringify(ncBody))

  // ---------------------------------------------------------------- אבחון בלי דריסות (027)
  const d = await newJob({ lift: 3, status: "in_progress" })
  const voiceFinding = await (await call(`/rest/v1/findings`, {
    method: "POST",
    token: manager,
    body: JSON.stringify({ job_card_id: d, source: "intake", title: "בדיקה: נוזל", customer_text: "טקסט", urgency: "yellow", status: "draft" }),
  })).json()
  const vf = voiceFinding[0]?.id
  await rpc("set_inspection_item", { p_job_id: d, p_key: "fluids", p_light: "yellow", p_finding_id: vf }, mechanic)
  await rpc("set_inspection_item", { p_job_id: d, p_key: "tires", p_light: "red" }, mechanic)
  let [ins] = await (await admin(`/rest/v1/inspections?job_card_id=eq.${d}&select=items`)).json()
  ok("לחיצה על פריט אחר לא דורסת את הממצא של הנוזלים", ins?.items?.fluids?.finding_id === vf && ins?.items?.tires?.light === "red", JSON.stringify(ins?.items))
  await rpc("set_inspection_item", { p_job_id: d, p_key: "fluids", p_light: "red" }, mechanic)
  ;[ins] = await (await admin(`/rest/v1/inspections?job_card_id=eq.${d}&select=items`)).json()
  const [vf1] = await (await admin(`/rest/v1/findings?id=eq.${vf}&select=status,urgency`)).json()
  ok("צהוב לאדום: הממצא נשאר, והדחיפות עולה", ins?.items?.fluids?.finding_id === vf && vf1.urgency === "red" && vf1.status === "draft")
  await rpc("set_inspection_item", { p_job_id: d, p_key: "fluids", p_light: "green" }, mechanic)
  ;[ins] = await (await admin(`/rest/v1/inspections?job_card_id=eq.${d}&select=items`)).json()
  const [vf2] = await (await admin(`/rest/v1/findings?id=eq.${vf}&select=status`)).json()
  ok("שינוי לירוק מבטל את הטיוטה של הפריט (בלי שאריות)", !ins?.items?.fluids?.finding_id && vf2.status === "cancelled", JSON.stringify({ i: ins?.items?.fluids, vf2 }))
  const screenIns = await rpc("set_inspection_item", { p_job_id: d, p_key: "fluids", p_light: "red" }, screen)
  ok("מסך תלוי לא מסמן פריטים", !screenIns.ok, `status ${screenIns.status}`)

  // ---------------------------------------------------------------- תשובה כשבינתיים נמצא עוד משהו (028)
  // סבב 2.10, ממצא 9: הלקוח עונה, אבל בזמן שחיכו לו המכונאי מצא ממצא נוסף שדניאל
  // עוד לא שלח. הכרטיס צריך להישאר "מחכה לשליחה", לא "בעבודה" — אחרת הלוח מציג
  // "הלקוח אישר: להחזיר לתור" על רכב שיש לדניאל מה לשלוח עליו.
  {
    const g = await newJob({ lift: 2, status: "in_progress" })
    const g1 = await (await rpc("add_price_list_finding", { p_job_id: g, p_price_list_id: item("wipers").id }, mechanic)).json()
    const gToken = await (await rpc("send_quote_request", { p_job_id: g, p_finding_ids: [g1.finding_id] }, manager)).json()
    ok("028: אחרי שליחה, הכרטיס מחכה ללקוח", (await job(g)).status === "waiting_approval")
    const g2 = await (await rpc("add_price_list_finding", { p_job_id: g, p_price_list_id: item("bulb-head").id }, mechanic)).json()
    ok("028: ממצא חדש בזמן ההמתנה לא משנה את המצב", Boolean(g2.finding_id) && (await job(g)).status === "waiting_approval")
    await rpc("request_decide", { p_token: gToken, p_decisions: [{ finding_id: g1.finding_id, decision: "approved", part_choice: "original" }] })
    ok("028: הלקוח ענה ויש טיוטה שלא נשלחה — 'מחכה לשליחה', לא 'בעבודה'", (await job(g)).status === "waiting_quote", (await job(g)).status)

    const h = await newJob({ lift: 3, status: "in_progress" })
    const h1 = await (await rpc("add_price_list_finding", { p_job_id: h, p_price_list_id: item("wipers").id }, mechanic)).json()
    const hToken = await (await rpc("send_quote_request", { p_job_id: h, p_finding_ids: [h1.finding_id] }, manager)).json()
    await rpc("request_decide", { p_token: hToken, p_decisions: [{ finding_id: h1.finding_id, decision: "approved", part_choice: "original" }] })
    ok("028: בלי טיוטה, אחרי התשובה — 'בעבודה' כמו קודם", (await job(h)).status === "in_progress", (await job(h)).status)

    // 029: מה כבר אושר, לדף של הלקוח. ההודעה הנוכחית לא נכללת, וטוקן לא תקין לא מחזיר כלום.
    const hAgreed = await (await rpc("request_agreed", { p_token: hToken })).json()
    ok("029: הממצאים של אותה הודעה לא נספרים כ'כבר אושר'", Array.isArray(hAgreed?.approved) && hAgreed.approved.length === 0, JSON.stringify(hAgreed))
    const gToken2 = await (await rpc("send_quote_request", { p_job_id: g, p_finding_ids: [g2.finding_id] }, manager)).json()
    const gAgreed = await (await rpc("request_agreed", { p_token: gToken2 })).json()
    ok("029: בהודעה השנייה, מה שאושר בראשונה מופיע עם הסכום", gAgreed?.approved?.length === 1 && Number(gAgreed.approved[0].price) > 0, JSON.stringify(gAgreed))
    const junk = await (await rpc("request_agreed", { p_token: "x".repeat(36) })).json()
    ok("029: טוקן לא תקין — כלום", junk === null, JSON.stringify(junk))
  }

  // ---------------------------------------------------------------- תזכורת ללקוח: אחת לבקשה
  const badNudge = await rpc("claim_due_nudges", { p_secret: "wrong" })
  ok("תזכורות: טוקן שגוי נדחה", !badNudge.ok, `status ${badNudge.status}`)

  if (!botToken) {
    console.log("SKIP  תזכורת אחרי 30 דקות — חסר GARAGE_BOT_TOKEN (להוסיף --env-file של .env.wiring.local)")
  } else {
    const e = await newJob({ lift: 4, status: "in_progress" })
    const e1 = await (await rpc("add_price_list_finding", { p_job_id: e, p_price_list_id: item("wipers").id }, mechanic)).json()
    const e2 = await (await rpc("add_price_list_finding", { p_job_id: e, p_price_list_id: item("bulb-head").id }, mechanic)).json()
    const eToken = await (await rpc("send_quote_request", { p_job_id: e, p_finding_ids: [e1.finding_id, e2.finding_id] }, manager)).json()

    // השעון של המסד לא תלוי בשעה שבה הבדיקה רצה: שואלים "מה היה קורה ב-10:00"
    // וב-22:00 של היום, והבקשה "נשלחה" 40 דקות לפני 10:00.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date())
    const off = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" })
      .formatToParts(new Date()).find((x) => x.type === "timeZoneName").value.replace("GMT", "")
    const [, sign, hours] = off.match(/([+-])(\d+)/)
    const at = (hh) => new Date(`${day}T${hh}:00:00${sign}${hours.padStart(2, "0")}:00`).toISOString()
    const ten = at("10")
    await admin(`/rest/v1/quote_requests?token=eq.${eToken}`, {
      method: "PATCH",
      body: JSON.stringify({ sent_at: new Date(new Date(ten).getTime() - 40 * 60 * 1000).toISOString() }),
    })

    const night = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: at("22") })).json()
    ok("ב-22:00 אין תזכורות", Array.isArray(night) && night.length === 0)

    const early = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: new Date(new Date(ten).getTime() - 20 * 60 * 1000).toISOString() })).json()
    ok("20 דקות אחרי השליחה: עוד לא", Array.isArray(early) && !early.some((x) => x.token === eToken))

    const claims = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: ten })).json()
    const [rq] = await (await admin(`/rest/v1/quote_requests?token=eq.${eToken}&select=nudged_at`)).json()
    const notices = await (await admin(`/rest/v1/customer_notices?job_card_id=eq.${e}&kind=eq.nudge&select=status,reason,ref`)).json()
    ok("40 דקות בלי תשובה, ב-10:00: תזכורת אחת לבקשה, לא אחת לממצא", Boolean(rq?.nudged_at) && notices.length === 1 && notices[0].ref === eToken, JSON.stringify({ rq, notices }))
    ok("בלי הסכמה לוואטסאפ: לא נשלח, ונרשם למה", notices[0]?.status === "skipped" && notices[0]?.reason === "no_consent", JSON.stringify(notices))
    ok("ולא נכנס לרשימת השליחה לבוט", Array.isArray(claims) && !claims.some((x) => x.token === eToken))
    const againNudge = await (await rpc("claim_due_nudges", { p_secret: botToken, p_at: ten })).json()
    ok("תזכורת אחת לכל בקשה", Array.isArray(againNudge) && !againNudge.some((x) => x.token === eToken))
  }
} finally {
  await admin(`/rest/v1/stations?label=eq.${encodeURIComponent(STATION_LABEL)}`, { method: "DELETE" })
  for (const s of Array.isArray(liftsBefore) ? liftsBefore : []) {
    await admin(`/rest/v1/staff?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ lift: s.lift }) })
  }
  for (const id of jobs) {
    const fs = await (await admin(`/rest/v1/findings?job_card_id=eq.${id}&select=id`)).json()
    for (const f of fs) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    await admin(`/rest/v1/quote_requests?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/inspections?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/findings?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/customer_notices?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }

  const left = await (await admin(`/rest/v1/job_cards?plate=eq.${PLATE}&select=id`)).json()
  ok("נוקה: לא נשאר כרטיס בדיקה", left.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
