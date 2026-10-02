// בודק את האישור הדיגיטלי של הצעת הקבלה (036) מול המסד האמיתי.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/intake-approval.mjs
//
// למה זה קיים: עד 2.10 ה-V "הלקוח אישר" בקבלה היה הצהרה של דניאל בלבד, על הסכום
// הגדול. עכשיו האישור מגיע מהלקוח (קישור, או חתימה על עותק מודפס), ובלעדיו הרכב
// לא עולה לליפט. זה כלל של כסף ושל הבטחה ללקוח, ולכן נבדק במסד ולא רק בכפתור:
// מי שולח, מי רואה מה, אישור פעם אחת, דחייה, חתימה, והשער לליפט.
//
// כל מה שנוצר כאן נמחק בסוף, גם אם בדיקה נכשלה.

import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY
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
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
const rpcJson = async (fn, body, token) => (await rpc(fn, body, token)).json()

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")

const made = []
// רכב כמו שדניאל פותח בקבלה: בלי אישור, עם שורת הצעה אחת.
async function newCar({ consent = true, plate = "7360101" } = {}) {
  const [job] = await (
    await admin(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        plate,
        vehicle_make: "מאזדה",
        vehicle_model: "3",
        customer_name: "לקוחת בדיקה",
        customer_phone: "0500000000",
        status: "open",
        whatsapp_consent: consent,
        updates_consent_at: consent ? new Date().toISOString() : null,
        notes: "רשומת בדיקה אוטומטית (intake-approval)",
      }),
    })
  ).json()
  made.push(job.id)
  await admin(`/rest/v1/quote_items`, {
    method: "POST",
    body: JSON.stringify({
      job_card_id: job.id,
      title: "טיפול 15,000",
      labor_hours: 1.5,
      price_original: 650,
      price_aftermarket: 480,
      warranty_original: "12 חודשים",
      warranty_aftermarket: "6 חודשים",
      part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.",
      part_choice: "aftermarket",
    }),
  })
  return job.id
}
const jobRow = async (id) => (await (await admin(`/rest/v1/job_cards?id=eq.${id}&select=work_approved_at,work_approved_via,lift`)).json())[0]

try {
  // --- מי שולח
  const a = await newCar()
  ok("אורח לא שולח הצעה לאישור", !(await rpc("send_intake_request", { p_job_id: a })).ok)
  ok("מכונאי לא שולח הצעה לאישור", !(await rpc("send_intake_request", { p_job_id: a }, mechanic)).ok)
  const token = await rpcJson("send_intake_request", { p_job_id: a }, manager)
  ok("דניאל שולח, ונוצר קישור", typeof token === "string" && /^[0-9a-f]{36}$/.test(token), JSON.stringify(token))
  ok("שליחה חוזרת מחזירה את אותו קישור, בלי לפתוח חדש", (await rpcJson("send_intake_request", { p_job_id: a }, manager)) === token)

  const b = await newCar({ consent: false, plate: "7360102" })
  const noConsent = await rpc("send_intake_request", { p_job_id: b }, manager)
  const noConsentBody = await noConsent.json()
  ok("בלי הסכמה לעדכונים אין קישור: חתימה על נייר", !noConsent.ok && noConsentBody?.hint === "law-132b", JSON.stringify(noConsentBody))

  // --- מה הלקוח רואה
  const view = await rpcJson("intake_view", { p_token: token })
  ok("הלקוח, בלי התחברות, רואה את ההצעה: פתוחה, עם השורה והמחיר שנבחר", view?.status === "open" && view?.lines?.length === 1 && Number(view.lines[0].price) === 480, JSON.stringify(view))
  ok("בדף אין טלפון, לוחית מלאה או שם משפחה", !JSON.stringify(view).includes("0500000000") && !JSON.stringify(view).includes("7360101") && view?.customer === "לקוחת")
  ok("קישור שלא קיים: כלום, לא שגיאה", (await rpcJson("intake_view", { p_token: "0".repeat(36) })) === null)
  ok("קישור של קבלה לא נפתח כדף ממצאים", ((await rpcJson("request_view", { p_token: token })) ?? []).length === 0)
  ok("והכרעה של ממצאים עליו לא עושה כלום", (await rpcJson("request_decide", { p_token: token, p_decisions: [] })) === "unavailable")

  // --- השער לליפט
  const early = await call(`/rest/v1/job_cards?id=eq.${a}`, { token: manager, method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ lift: 4 }) })
  ok("לפני האישור הרכב לא עולה לליפט, גם לא בידי דניאל", !early.ok, `HTTP ${early.status}`)
  ok("ונשאר בחניה", (await jobRow(a))?.lift === null)

  // --- הלקוח מאשר
  ok("הכרעה לא חוקית נדחית", (await rpcJson("intake_decide", { p_token: token, p_decision: "maybe" })) === "unavailable")
  ok("הלקוח מאשר בקישור", (await rpcJson("intake_decide", { p_token: token, p_decision: "approved" })) === "done")
  const approvedRow = await jobRow(a)
  ok("נרשם בכתב: מתי, ושזה היה בקישור", Boolean(approvedRow?.work_approved_at) && approvedRow?.work_approved_via === "link", JSON.stringify(approvedRow))
  ok("אישור שני על אותו קישור: נחסם", (await rpcJson("intake_decide", { p_token: token, p_decision: "declined" })) === "unavailable")
  ok("הדף מראה: אושר", (await rpcJson("intake_view", { p_token: token }))?.status === "approved")
  const up = await call(`/rest/v1/job_cards?id=eq.${a}`, { token: manager, method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ lift: 4, status: "in_progress" }) })
  ok("אחרי האישור הרכב עולה לליפט", up.ok && (await jobRow(a))?.lift === 4, `HTTP ${up.status}`)
  ok("ואחרי שאושר, אין מה לשלוח שוב", !(await rpc("send_intake_request", { p_job_id: a }, manager)).ok)

  // --- הלקוח לא מאשר
  const c = await newCar({ plate: "7360103" })
  const t2 = await rpcJson("send_intake_request", { p_job_id: c }, manager)
  ok("הלקוח לא מאשר", (await rpcJson("intake_decide", { p_token: t2, p_decision: "declined" })) === "done")
  ok("הרכב נשאר בלי אישור", (await jobRow(c))?.work_approved_at === null)
  ok("הדף מראה: לא אושר", (await rpcJson("intake_view", { p_token: t2 }))?.status === "declined")
  ok("ודניאל יכול לשלוח קישור חדש אחרי שיחה", /^[0-9a-f]{36}$/.test((await rpcJson("send_intake_request", { p_job_id: c }, manager)) ?? ""))

  // --- חתימה על נייר
  const d = await newCar({ plate: "7360104" })
  const t3 = await rpcJson("send_intake_request", { p_job_id: d }, manager)
  ok("מכונאי לא רושם חתימה", !(await rpc("mark_intake_signed", { p_job_id: d }, mechanic)).ok)
  ok("דניאל רושם: הלקוח חתם על העותק המודפס", (await rpcJson("mark_intake_signed", { p_job_id: d }, manager)) === "ok")
  ok("נרשם כחתימה על נייר", (await jobRow(d))?.work_approved_via === "print")
  ok("הקישור שנשלח קודם נסגר", (await rpcJson("intake_decide", { p_token: t3, p_decision: "declined" })) === "unavailable")
  ok("והדף שלו מראה שזה אושר בחתימה", (await rpcJson("intake_view", { p_token: t3 }))?.status === "signed")
  ok("חתימה פעמיים: כבר רשום", (await rpcJson("mark_intake_signed", { p_job_id: d }, manager)) === "already")

  // --- תוקף
  const e = await newCar({ plate: "7360105" })
  const t4 = await rpcJson("send_intake_request", { p_job_id: e }, manager)
  await admin(`/rest/v1/quote_requests?token=eq.${t4}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }) })
  ok("קישור בן שבוע: פג, ולא מאשר", (await rpcJson("intake_decide", { p_token: t4, p_decision: "approved" })) === "unavailable" && (await jobRow(e))?.work_approved_at === null)
  ok("הדף מראה: פג", (await rpcJson("intake_view", { p_token: t4 }))?.status === "expired")
  const t5 = await rpcJson("send_intake_request", { p_job_id: e }, manager)
  ok("שליחה אחרי שפג: קישור חדש", typeof t5 === "string" && t5 !== t4)
} finally {
  for (const id of made) await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  const left = made.length ? await (await admin(`/rest/v1/job_cards?id=in.(${made.join(",")})&select=id`)).json() : []
  ok("נוקה: לא נשארו כרטיסים של הבדיקה", left.length === 0, JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
