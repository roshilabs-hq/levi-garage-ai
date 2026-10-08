// בודק את 043 (בדיקת OWASP, 4.10): מה מכונאי ומנהל יכולים לכתוב ישירות במסד,
// דרך PostgREST, בלי המסכים. כל ניסיון אסור צריך להיחסם, וכל פעולה רגילה של
// מכונאי (ליפט, חניה, סיימתי, אבחון) צריכה לעבוד.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-4-app/test/access-guards.mjs
//
// כל מה שנוצר כאן נמחק בסוף, גם אם בדיקה נכשלה.

import crypto from "node:crypto"
import { passwordFor, readable } from "./_auth.mjs"

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
  fetch(`${url}${readable(path, token)}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
// PATCH ישיר בשם המשתמש, ומה המסד ענה (hint או ok)
const patch = async (table, id, body, token) => {
  const res = await call(`/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body), token, headers: { prefer: "return=representation" } })
  if (res.ok) return "ok"
  const j = await res.json().catch(() => ({}))
  return j.hint || `status ${res.status}`
}

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
const NOTE = "רשומת בדיקה אוטומטית (access-guards)"
const jobs = []
const bookings = []
const row = async (table, id) => (await (await admin(`/rest/v1/${table}?id=eq.${id}&select=*`)).json())[0]

try {
  const newJob = async (over = {}) => {
    const [j] = await (
      await admin(`/rest/v1/job_cards`, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          plate: "7360433", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "בדיקת הרשאות", customer_phone: "0500000433",
          status: "in_progress", whatsapp_consent: true, updates_consent_at: new Date().toISOString(),
          work_approved_at: new Date().toISOString(), work_approved_via: "link", notes: NOTE, ...over,
        }),
      })
    ).json()
    jobs.push(j.id)
    return j
  }

  // 1. מכונאי: מה מותר
  const j1 = await newJob({ status: "open" })
  ok("מכונאי: open → in_progress מותר", (await patch("job_cards", j1.id, { status: "in_progress" }, mechanic)) === "ok")
  ok("מכונאי: מחכה לשליחה מותר", (await patch("job_cards", j1.id, { status: "waiting_quote" }, mechanic)) === "ok")
  ok("מכונאי: 'סיימתי' (לחניה, גמור) מותר", (await patch("job_cards", j1.id, { parked_at: new Date().toISOString(), work_done_at: new Date().toISOString() }, mechanic)) === "ok")
  ok("מכונאי: סיום אבחון מותר", (await patch("job_cards", j1.id, { inspected_at: new Date().toISOString() }, mechanic)) === "ok")

  // 2. מכונאי: מה אסור
  const j2 = await newJob()
  ok("מכונאי: לסמן 'מוכן' נחסם", (await patch("job_cards", j2.id, { status: "ready" }, mechanic)) === "mechanic-locked")
  ok("מכונאי: לסמן 'נמסר' נחסם", (await patch("job_cards", j2.id, { status: "delivered" }, mechanic)) === "mechanic-locked")
  ok("מכונאי: לשנות טלפון נחסם", (await patch("job_cards", j2.id, { customer_phone: "0509999999" }, mechanic)) === "mechanic-locked")
  ok("מכונאי: לשנות הסכמה לוואטסאפ נחסם", (await patch("job_cards", j2.id, { whatsapp_consent: false }, mechanic)) === "mechanic-locked")
  ok("מכונאי: לפתוח כרטיס נחסם", (await (await call(`/rest/v1/job_cards`, { method: "POST", token: mechanic, body: JSON.stringify({ plate: "7360434", notes: NOTE, status: "open" }) })).json().catch(() => ({}))).hint === "mechanic-locked")
  ok("מכונאי: claim_ready_notice נחסם", !(await rpc("claim_ready_notice", { p_job_id: j2.id }, mechanic)).ok)

  // 3. כל עובד: אישור הלקוח לא נכתב ישירות
  const j3 = await newJob({ status: "open", work_approved_at: null, work_approved_via: null })
  ok("מכונאי: לסמן שהלקוח אישר נחסם", (await patch("job_cards", j3.id, { work_approved_at: new Date().toISOString() }, mechanic)) === "approval-locked")
  ok("מנהל: לסמן שהלקוח אישר נחסם (רק בקישור או 'חתם')", (await patch("job_cards", j3.id, { work_approved_at: new Date().toISOString() }, manager)) === "approval-locked")
  ok("מנהל: 'חתם על העותק' (הפונקציה) עדיין עובד", (await rpc("mark_intake_signed", { p_job_id: j3.id }, manager)).ok && Boolean((await row("job_cards", j3.id)).work_approved_at))
  // 054 (ביקורת חוזרת, 8.10, ממצא 4): "מוכן" נאכף במסד, לא רק בכפתור
  ok("מנהל: 'מוכן' בלי אבחון נחסם", (await patch("job_cards", j2.id, { status: "ready" }, manager)) === "ready-inspect")
  await admin(`/rest/v1/job_cards?id=eq.${j2.id}`, { method: "PATCH", body: JSON.stringify({ inspected_at: new Date().toISOString() }) })
  const [waiting] = await (
    await admin(`/rest/v1/findings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ job_card_id: j2.id, source: "manual", title: "בדיקה", summary: "בדיקה", urgency: "yellow", status: "draft" }),
    })
  ).json()
  ok("מנהל: 'מוכן' עם ממצא שמחכה לשליחה נחסם", (await patch("job_cards", j2.id, { status: "ready" }, manager)) === "ready-open")
  await admin(`/rest/v1/findings?id=eq.${waiting.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }) })
  ok("מנהל: 'מוכן' עם ממצא שמחכה ללקוח נחסם", (await patch("job_cards", j2.id, { status: "ready" }, manager)) === "ready-open")
  await admin(`/rest/v1/findings?id=eq.${waiting.id}`, { method: "PATCH", body: JSON.stringify({ status: "declined" }) })
  ok("מנהל: אחרי אבחון ובלי ממצא פתוח, 'מוכן' מותר", (await patch("job_cards", j2.id, { status: "ready" }, manager)) === "ok")
  // 056 (ביקורת שלישית, 8.10, ממצא 3): ו"מוכן" נשאר נכון גם אחרי זה
  ok("מנהל: למחוק אבחון לרכב מוכן נחסם", (await patch("job_cards", j2.id, { inspected_at: null }, manager)) === "ready-inspect")
  ok("מנהל: להחזיר ממצא של רכב מוכן לטיוטה נחסם", (await patch("findings", waiting.id, { status: "draft" }, manager)) === "job-ready")
  const lateAdd = await call(`/rest/v1/findings`, {
    method: "POST",
    token: manager,
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ job_card_id: j2.id, source: "manual", title: "מאוחר", summary: "מאוחר", urgency: "yellow", status: "draft" }),
  })
  ok("מנהל: להוסיף ממצא פתוח לרכב מוכן נחסם", (await lateAdd.json().catch(() => ({}))).hint === "job-ready")
  ok("מנהל: עדכון אחר לרכב מוכן עדיין מותר", (await patch("job_cards", j2.id, { odometer_km: 123456 }, manager)) === "ok")

  // 4. ממצא
  const [it] = await (await admin(`/rest/v1/price_list?code=eq.brakes-front-pads&select=id`)).json()
  const add = await (await rpc("add_price_list_finding", { p_job_id: j1.id, p_price_list_id: it.id }, mechanic)).json()
  ok("מכונאי: ממצא מהמחירון (הפונקציה) עדיין עובד", Number(add?.finding_id) > 0, JSON.stringify(add))
  const fid = add.finding_id
  ok("מכונאי: לערוך ממצא ישירות נחסם", (await patch("findings", fid, { title: "שונה" }, mechanic)) === "mechanic-locked")
  ok("מנהל: לערוך טיוטה מותר", (await patch("findings", fid, { customer_text: "נוסח מעודכן" }, manager)) === "ok")
  await admin(`/rest/v1/findings?id=eq.${fid}`, { method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }) })
  ok("מנהל: לשנות מחיר אחרי שנשלח נחסם", (await patch("findings", fid, { list_price_original: 1 }, manager)) === "discount-sent")
  ok("מנהל: לסמן 'דווח' על ממצא שנשלח עדיין מותר", (await patch("findings", fid, { safety_reported_at: new Date().toISOString() }, manager)) === "ok")

  // 5. ממצא שמחכה לאבי לא יוצא ללקוח, גם לא בעדכון ישיר
  const j5 = await newJob()
  const add2 = await (await rpc("add_price_list_finding", { p_job_id: j5.id, p_price_list_id: it.id }, manager)).json()
  await rpc("request_discount", { p_finding_id: add2.finding_id, p_pct: 20, p_reason: "בדיקה" }, manager)
  ok("ממצא שמחכה לאבי: שליחה ישירה נחסמת", (await patch("findings", add2.finding_id, { status: "sent" }, manager)) === "discount-pending")

  // 6. רכב בלי תור: אישור בלי תקנון נחסם במסד
  const [b] = await (
    await admin(`/rest/v1/bookings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ cal_uid: "walkin-" + crypto.randomBytes(12).toString("hex"), source: "walkin", status: "arrived", drop_off_at: new Date().toISOString(), customer_name: "בדיקת הרשאות", customer_phone: "0500000433", whatsapp_consent: true, plate: "7360433", notes: NOTE }),
    })
  ).json()
  bookings.push(b.id)
  const j4 = await newJob({ booking_id: b.id, status: "open", work_approved_at: null, work_approved_via: null })
  await admin(`/rest/v1/quote_items`, { method: "POST", body: JSON.stringify({ job_card_id: j4.id, title: "בדיקה", labor_hours: 1, price_original: 100, warranty_original: "ללא", single_reason: "עבודה בלבד.", part_choice: "original" }) })
  const token = await (await rpc("send_intake_request", { p_job_id: j4.id }, manager)).json()
  ok("רכב בלי תור: אישור בלי תקנון מחזיר 'terms'", (await (await rpc("intake_decide", { p_token: token, p_decision: "approved" })).json()) === "terms")
  ok("רכב בלי תור: אחרי התקנון, האישור עובר", (await (await rpc("intake_accept_terms", { p_token: token })).json()) === "done" && (await (await rpc("intake_decide", { p_token: token, p_decision: "approved" })).json()) === "done")

  // 7. מכונאי לא נוגע בתורים
  ok("מכונאי: לשנות תור נחסם", (await patch("bookings", b.id, { customer_phone: "0509999999" }, mechanic)) === "mechanic-locked")

  // 8. הטוקן של הלקוח (045): רק דניאל ואבי, ורק דרך הפונקציה
  const direct = await call(`/rest/v1/quote_requests?job_card_id=eq.${j4.id}&select=token`, { token: manager })
  ok("גם מנהל לא קורא את הטוקן ישירות מהטבלה", !direct.ok)
  const viaFn = await (await rpc("staff_job_tokens", { p_job_id: j4.id }, manager)).json()
  ok("מנהל מקבל את הטוקן דרך staff_job_tokens", Array.isArray(viaFn) && viaFn.some((t) => t.kind === "request" && t.token === token))
  ok("מכונאי לא מקבל טוקן", !(await rpc("staff_job_tokens", { p_job_id: j4.id }, mechanic)).ok)
  ok("מכונאי עדיין קורא את סוג החלק שאושר (מסך הליפט)", (await call(`/rest/v1/approvals?select=part_choice&limit=1`, { token: mechanic })).ok)

  // 9. הפונקציה הישנה סגורה
  ok("send_finding הישנה סגורה", !(await rpc("send_finding", { p_finding_id: fid, p_message: "x", p_token: "x" }, manager)).ok)
} finally {
  for (const id of jobs) {
    const fs = await (await admin(`/rest/v1/findings?job_card_id=eq.${id}&select=id`)).json()
    for (const f of Array.isArray(fs) ? fs : []) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    for (const t of ["quote_requests", "quote_items", "quote_versions", "customer_notices", "help_calls", "findings", "job_moves", "inspections"]) {
      await admin(`/rest/v1/${t}?job_card_id=eq.${id}`, { method: "DELETE" })
    }
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  for (const id of bookings) await admin(`/rest/v1/bookings?id=eq.${id}`, { method: "DELETE" })
  const left = await (await admin(`/rest/v1/job_cards?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()
  ok("ניקוי: לא נשארו רשומות בדיקה", Array.isArray(left) && left.length === 0, JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
