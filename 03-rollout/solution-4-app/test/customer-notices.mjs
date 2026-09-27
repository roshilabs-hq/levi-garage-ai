// בודק את "הרכב מוכן" בצד המסד: מי יכול לשלוח, מתי, וכמה פעמים.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/customer-notices.mjs
//
// שום הודעה לא נשלחת כאן. הבדיקה מדברת רק עם המסד: תופסת הודעות, רושמת
// תוצאות, וקוראת את השורות בחזרה — לא מסתפקת בקוד תשובה.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
const password = process.env.STAFF_DEMO_PASSWORD
if (!password) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")

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

const call = (path, { token = anonKey, ...init } = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })

const service = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) },
  })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

const rpc = async (name, args, token) => {
  const res = await call(`/rest/v1/rpc/${name}`, { method: "POST", token, body: JSON.stringify(args) })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const created = []
async function job(fields) {
  const [row] = await (
    await service(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ plate: "9999998", notes: "בדיקת הודעות יזומות", ...fields }),
    })
  ).json()
  created.push(row.id)
  return row
}

const noticeOf = async (jobId) =>
  (await (await service(`/rest/v1/customer_notices?job_card_id=eq.${jobId}&select=*`)).json())[0] ?? null

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test2@test.com")
const wall = await signIn("screen2@test.com")

// מספר בדוי מפורש. שום דבר כאן לא שולח, אבל גם בטעות — לא מספר של אדם.
const PHONE = "050-0000000"

try {
  // ---------- רק כרטיס מוכן ----------
  const a = await job({ status: "in_progress", whatsapp_consent: true, customer_phone: PHONE, customer_name: "דנה כהן" })
  let r = await rpc("claim_ready_notice", { p_job_id: a.id }, manager)
  ok("כרטיס שעוד בעבודה: אין מה לשלוח", r.status === 200 && r.body === null)
  ok("…ולא נרשמה שורה", (await noticeOf(a.id)) === null)

  await service(`/rest/v1/job_cards?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ status: "ready" }) })
  r = await rpc("claim_ready_notice", { p_job_id: a.id }, manager)
  ok("כרטיס מוכן עם הסכמה: יש מה לשלוח", r.body?.send === true && r.body?.phone === PHONE && r.body?.name === "דנה כהן")
  ok("…והשורה בשליחה", (await noticeOf(a.id))?.status === "pending")

  // ---------- פעם אחת בלבד ----------
  r = await rpc("claim_ready_notice", { p_job_id: a.id }, mechanic)
  ok("לחיצה שנייה, גם של אדם אחר: לא נשלח שוב", r.status === 200 && r.body === null)

  r = await rpc("finish_notice", { p_id: (await noticeOf(a.id)).id, p_status: "sent" }, manager)
  let n = await noticeOf(a.id)
  ok("נרשם שנשלח, עם שעה", n?.status === "sent" && n?.sent_at !== null)

  r = await rpc("claim_ready_notice", { p_job_id: a.id }, manager)
  ok("אחרי שנשלח: לא נשלח שוב", r.body === null)

  await rpc("finish_notice", { p_id: n.id, p_status: "failed", p_reason: "late" }, manager)
  ok("תוצאה מאוחרת לא דורסת הודעה שכבר נשלחה", (await noticeOf(a.id))?.status === "sent")

  // ---------- בלי הסכמה, בלי טלפון ----------
  const b = await job({ status: "ready", whatsapp_consent: false, customer_phone: PHONE })
  r = await rpc("claim_ready_notice", { p_job_id: b.id }, manager)
  n = await noticeOf(b.id)
  ok("בלי הסכמה לוואטסאפ: לא נשלח", r.body?.send === false && r.body?.phone === undefined)
  ok("…והצוות רואה למה", n?.status === "skipped" && n?.reason === "no_consent")

  const c = await job({ status: "ready", whatsapp_consent: true, customer_phone: "  " })
  r = await rpc("claim_ready_notice", { p_job_id: c.id }, manager)
  n = await noticeOf(c.id)
  ok("בלי טלפון: לא נשלח, ונרשם למה", r.body?.send === false && n?.reason === "no_phone")

  // ---------- כישלון מאפשר ניסיון חוזר ----------
  const d = await job({ status: "ready", whatsapp_consent: true, customer_phone: PHONE })
  r = await rpc("claim_ready_notice", { p_job_id: d.id }, mechanic)
  ok("מכונאי יכול לסמן מוכן ולשלוח", r.body?.send === true)
  await rpc("finish_notice", { p_id: r.body.id, p_status: "failed", p_reason: "unreachable" }, mechanic)
  ok("כישלון נרשם עם הסיבה", (await noticeOf(d.id))?.reason === "unreachable")
  r = await rpc("claim_ready_notice", { p_job_id: d.id }, manager)
  ok("הודעה שנכשלה נתפסת שוב", r.body?.send === true && (await noticeOf(d.id))?.status === "pending")

  r = await rpc("finish_notice", { p_id: r.body.id, p_status: "delivered" }, manager)
  ok("סטטוס לא מוכר נדחה", r.status >= 400)

  // ---------- מי בכלל יכול ----------
  const e = await job({ status: "ready", whatsapp_consent: true, customer_phone: PHONE })
  r = await rpc("claim_ready_notice", { p_job_id: e.id }, wall)
  ok("מסך הסדנה לא יכול לשלוח ללקוח", r.status >= 400 && (await noticeOf(e.id)) === null)

  r = await rpc("claim_ready_notice", { p_job_id: e.id }, anonKey)
  ok("מבחוץ, בלי התחברות: אי אפשר", r.status >= 400 && (await noticeOf(e.id)) === null)

  // ---------- מי קורא את היומן ----------
  const read = async (token) => (await (await call(`/rest/v1/customer_notices?select=job_card_id,status`, { token })).json())
  ok("מנהל עבודה רואה את היומן", (await read(manager)).some((x) => x.job_card_id === a.id))
  ok("מכונאי רואה את היומן", (await read(mechanic)).some((x) => x.job_card_id === a.id))
  const onWall = await read(wall)
  ok("מסך הסדנה לא רואה אותו", Array.isArray(onWall) && onWall.length === 0)
  const outside = await read(anonKey)
  ok("מבחוץ לא רואים אותו", !Array.isArray(outside) || outside.length === 0)

  const write = await call(`/rest/v1/customer_notices?job_card_id=eq.${d.id}`, {
    method: "PATCH",
    token: manager,
    body: JSON.stringify({ status: "sent" }),
  })
  ok("אי אפשר לסמן 'נשלח' ישירות, בלי לעבור דרך הפונקציה", (await noticeOf(d.id))?.status === "pending", `HTTP ${write.status}`)

  // ---------- הקישור לאישור (011) ----------
  const quotesOf = async (jobId) =>
    await (await service(`/rest/v1/customer_notices?job_card_id=eq.${jobId}&kind=eq.quote&select=*&order=id`)).json()
  const finding = async (jobId) => {
    const [row] = await (
      await service(`/rest/v1/findings`, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ job_card_id: jobId, source: "manual", summary: "בדיקה", customer_text: "צריך להחליף רפידות", status: "draft" }),
      })
    ).json()
    return row
  }
  const tokenOf = async (findingId) =>
    (await (await service(`/rest/v1/approvals?finding_id=eq.${findingId}&select=token`)).json())[0]?.token

  const q = await job({ status: "in_progress", whatsapp_consent: true, customer_phone: PHONE, customer_name: "יוסי" })
  const qf = await finding(q.id)

  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, manager)
  ok("קישור לאישור: ממצא שעוד לא נשלח — אין מה לשלוח", r.status === 200 && r.body === null)

  await rpc("send_finding", { p_finding_id: qf.id, p_message: "צריך להחליף רפידות", p_channel: "link" }, manager)
  const token1 = await tokenOf(qf.id)
  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, manager)
  ok("אחרי שליחה: יש מה לשלוח, עם הטוקן של הקישור", r.body?.send === true && r.body?.token === token1 && /^[0-9a-f]{36}$/.test(token1 ?? ""))
  const firstId = r.body?.id

  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, manager)
  ok("לחיצה שנייה על אותו קישור: לא נשלח שוב", r.body === null)

  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, mechanic)
  ok("מכונאי לא שולח מחיר ללקוח, גם לא דרך כאן", r.status >= 400)
  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, wall)
  ok("מסך הסדנה לא שולח מחיר ללקוח", r.status >= 400)

  await rpc("finish_notice", { p_id: firstId, p_status: "sent" }, manager)
  await rpc("send_finding", { p_finding_id: qf.id, p_message: "צריך להחליף רפידות ודיסקים", p_channel: "link" }, manager)
  const token2 = await tokenOf(qf.id)
  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, manager)
  const qs = await quotesOf(q.id)
  ok("נשלח שוב עם נוסח אחר: קישור חדש, ולכן גם הודעה חדשה", token2 !== token1 && r.body?.token === token2 && qs.length === 2)
  ok("…וההודעה על הקישור הקודם נשארת ביומן כמו שהייתה", qs.find((n) => n.ref === token1)?.status === "sent")

  await rpc("finish_notice", { p_id: r.body.id, p_status: "failed", p_reason: "unreachable" }, manager)
  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, manager)
  ok("קישור שההודעה עליו נכשלה: נתפס שוב", r.body?.send === true && r.body?.token === token2)

  await service(`/rest/v1/approvals?finding_id=eq.${qf.id}`, { method: "PATCH", body: JSON.stringify({ decision: "approved", decided_at: new Date().toISOString() }) })
  await rpc("finish_notice", { p_id: r.body.id, p_status: "failed", p_reason: "unreachable" }, manager)
  r = await rpc("claim_quote_notice", { p_finding_id: qf.id }, manager)
  ok("הלקוח כבר ענה: לא שולחים לו את הקישור שוב", r.body === null)

  const x = await job({ status: "in_progress", whatsapp_consent: true, customer_phone: PHONE })
  const xf = await finding(x.id)
  await rpc("send_finding", { p_finding_id: xf.id, p_message: "בדיקה", p_channel: "link" }, manager)
  await service(`/rest/v1/approvals?finding_id=eq.${xf.id}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }) })
  r = await rpc("claim_quote_notice", { p_finding_id: xf.id }, manager)
  ok("קישור שפג תוקפו: לא נשלח", r.body === null)

  const y = await job({ status: "in_progress", whatsapp_consent: false, customer_phone: PHONE })
  const yf = await finding(y.id)
  await rpc("send_finding", { p_finding_id: yf.id, p_message: "בדיקה", p_channel: "link" }, manager)
  r = await rpc("claim_quote_notice", { p_finding_id: yf.id }, manager)
  ok("בלי הסכמה לוואטסאפ: הקישור לא יוצא, ונרשם למה", r.body?.send === false && (await quotesOf(y.id))[0]?.reason === "no_consent")

  await service(`/rest/v1/job_cards?id=eq.${q.id}`, { method: "PATCH", body: JSON.stringify({ status: "ready" }) })
  r = await rpc("claim_ready_notice", { p_job_id: q.id }, manager)
  ok("באותו כרטיס, 'הרכב מוכן' לא נחסם בגלל הודעות הקישור", r.body?.send === true)
} finally {
  // ---------- ניקוי: מחיקת הכרטיס מוחקת גם את השורות ----------
  if (!process.env.KEEP_TEST_ROWS) {
    for (const id of created) await service(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
