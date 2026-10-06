// הכרעה של לקוח חלה רק על הממצאים של הבקשה שלו (050, בדיקת האבטחה המסכמת 6.10, H-1).
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/request-scope.mjs
//
// מה נבדק:
//   1. לקוח A שולח בקישור שלו גם ממצא של רכב B: נדחה, ושום דבר לא משתנה, לא אצל A ולא אצל B.
//   2. אצל B הממצא עדיין "נשלח", וההכרעה שלו ריקה.
//   3. לקוח A מכריע רק על הממצא שלו: עובר כרגיל.
//   4. לקוח B עדיין יכול להכריע בקישור שלו.
// כל הרשומות נמחקות בסוף, גם אם משהו נכשל.

import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
if (!process.env.STAFF_DEMO_PASSWORD) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")

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
  fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } })
const service = (path, init = {}) => call(path, { ...init, token: secret, key: secret })
async function rpc(fn, body, token = anonKey) {
  const res = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
  const text = await res.text()
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }
}
async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}
async function insert(table, row) {
  const res = await service(`/rest/v1/${table}`, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row) })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return (await res.json())[0]
}
const get = async (path) => (await service(`/rest/v1/${path}`)).json()

const jobs = []
try {
  const manager = await signIn("test1@test.com")
  const now = new Date().toISOString()
  const car = async (plate) => {
    const job = await insert("job_cards", {
      plate, vehicle_make: "סקודה", vehicle_model: "FABIA", vehicle_year: 2012, customer_name: "לקוח בדיקה", customer_phone: "0500000000",
      lift: null, status: "in_progress", work_approved_at: now, work_approved_via: "link", whatsapp_consent: true, updates_consent_at: now,
      inspected_at: now, notes: "רשומת בדיקה אוטומטית · 050",
    })
    jobs.push(job.id)
    const f = await insert("findings", {
      job_card_id: job.id, source: "voice", status: "draft", title: "החלפת רפידות בלם קדמיות", summary: "רפידות שחוקות.",
      customer_text: "רפידות הבלם הקדמיות כמעט גמורות.", price_original: 780, price_aftermarket: 520, labor_hours: 1,
      warranty_original: "12 חודשים", warranty_aftermarket: "6 חודשים", part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.",
      eta: "היום עד 15:00", model: "gemini-2.5-pro",
    })
    const sent = await rpc("send_quote_request", { p_job_id: job.id, p_finding_ids: [f.id] }, manager)
    if (!sent.ok) throw new Error(`send_quote_request: ${sent.status} ${JSON.stringify(sent.data)}`)
    return { job, finding: f, token: sent.data }
  }
  const A = await car("1111050")
  const B = await car("2222050")
  const pick = (f) => ({ finding_id: f.id, decision: "approved", part_choice: "original" })

  // 1-2: הקישור של A עם הממצא של B
  const attack = await rpc("request_decide", { p_token: A.token, p_decisions: [pick(A.finding), pick(B.finding)] })
  ok("ממצא של רכב אחר בקישור נדחה", !attack.ok, `status ${attack.status} ${JSON.stringify(attack.data)}`)
  const [fb] = await get(`findings?id=eq.${B.finding.id}&select=status`)
  const [ab] = await get(`approvals?finding_id=eq.${B.finding.id}&select=decision`)
  ok("אצל B הממצא עדיין 'נשלח'", fb?.status === "sent", fb?.status)
  ok("אצל B ההכרעה עדיין ריקה", ab && ab.decision === null, JSON.stringify(ab))
  const [fa] = await get(`findings?id=eq.${A.finding.id}&select=status`)
  ok("גם אצל A שום דבר לא השתנה (הכול או כלום)", fa?.status === "sent", fa?.status)

  // 3: A מכריע רק על שלו
  const legit = await rpc("request_decide", { p_token: A.token, p_decisions: [pick(A.finding)] })
  ok("A מכריע על הממצא שלו: עובר", legit.ok && legit.data === "done", `${legit.status} ${JSON.stringify(legit.data)}`)
  const [fa2] = await get(`findings?id=eq.${A.finding.id}&select=status`)
  ok("אצל A הממצא 'אושר'", fa2?.status === "approved", fa2?.status)

  // 4: B עדיין יכול להכריע בעצמו
  const bOwn = await rpc("request_decide", { p_token: B.token, p_decisions: [{ finding_id: B.finding.id, decision: "declined" }] })
  ok("B מכריע בקישור שלו: עובר", bOwn.ok && bOwn.data === "done", `${bOwn.status} ${JSON.stringify(bOwn.data)}`)
} catch (e) {
  fail++
  console.log("FAIL  שגיאה:", e.message)
} finally {
  for (const id of jobs) await service(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  const left = jobs.length ? await get(`job_cards?id=in.(${jobs.join(",")})&select=id`) : []
  console.log(`\n${pass} passed, ${fail} failed · נוקה: ${left.length === 0 ? "כן" : `נשארו ${left.length}`}`)
  process.exit(fail ? 1 : 0)
}
