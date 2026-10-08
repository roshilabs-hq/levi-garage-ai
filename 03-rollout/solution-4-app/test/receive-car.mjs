// בודק את 070 (ביקורת שביעית, 8.10, ממצאים 1 ו-5): קבלת רכב היא פעולה אחת במסד, או שהכול נרשם או
// שכלום; וניסיון תמלול חוזר נתפס פעם אחת.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/receive-car.mjs
//
// כל מה שנוצר כאן נמחק בסוף.

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
const rpc = async (fn, body, token) => {
  const res = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
  const j = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data: j, hint: j?.hint }
}

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, {
    method: "POST",
    body: JSON.stringify({ email, password: passwordFor(email) }),
  })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
const NOTE = "רשומת בדיקה אוטומטית (receive-car)"
const stamp = Date.now()
const bookings = []
const jobs = []

const newBooking = async (extra = {}) => {
  const [b] = await (
    await admin(`/rest/v1/bookings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        cal_uid: `test-receive-${stamp}-${bookings.length}`,
        source: "walkin",
        status: "booked",
        plate: "7360470",
        customer_name: "בדיקת קבלה",
        customer_phone: "0500000470",
        vehicle_make: "מאזדה",
        vehicle_model: "3",
        drop_off_at: new Date().toISOString(),
        whatsapp_consent: true,
        notes: NOTE,
        ...extra,
      }),
    })
  ).json()
  if (!b?.id) throw new Error(`bookings insert failed: ${JSON.stringify(b)}`)
  bookings.push(b.id)
  return b.id
}
const jobsOf = async (bookingId) => (await (await admin(`/rest/v1/job_cards?booking_id=eq.${bookingId}&select=id,status`)).json()) ?? []
const itemsOf = async (jobId) => (await (await admin(`/rest/v1/quote_items?job_card_id=eq.${jobId}&select=id`)).json()) ?? []
const price = await (await admin(`/rest/v1/price_list?select=id&active=eq.true&limit=2`)).json()
const [p1, p2] = price.map((p) => p.id)

try {
  // 1. פריט לא קיים באמצע: שום דבר לא נרשם, גם לא הכרטיס
  const b1 = await newBooking()
  const bad = await rpc("receive_car", { p_booking_id: b1, p_lines: [{ id: p1, choice: "original" }, { id: 999999999, choice: "original" }], p_email: null, p_odometer: 1000, p_consent: true, p_on_paper: false }, manager)
  ok("פריט לא קיים: הקריאה נכשלת עם רמז missing", !bad.ok && bad.hint === "missing", JSON.stringify(bad.data).slice(0, 120))
  ok("ולא נוצר כרטיס", (await jobsOf(b1)).length === 0)
  const stillBooked = (await (await admin(`/rest/v1/bookings?id=eq.${b1}&select=status`)).json())[0]?.status
  ok("והתור נשאר כמו שהיה", stillBooked === "booked", stillBooked)

  // 2. קבלה תקינה: כרטיס, שני פריטים, התור "הגיע", וקישור לאישור
  const good = await rpc("receive_car", { p_booking_id: b1, p_lines: [{ id: p1, choice: "original" }, { id: p2, choice: "aftermarket" }, { id: p1, choice: "original" }], p_email: null, p_odometer: 1000, p_consent: true, p_on_paper: false }, manager)
  ok("קבלה תקינה מצליחה", good.ok && good.data?.job_id > 0 && typeof good.data?.token === "string", JSON.stringify(good.data).slice(0, 120))
  const jobId = good.data?.job_id
  if (jobId) jobs.push(jobId)
  ok("נוצר כרטיס אחד", (await jobsOf(b1)).length === 1)
  ok("שני פריטי הצעה (הכפילות סוננה)", jobId ? (await itemsOf(jobId)).length === 2 : false)
  ok("התור סומן 'הגיע'", (await (await admin(`/rest/v1/bookings?id=eq.${b1}&select=status`)).json())[0]?.status === "arrived")
  const again = await rpc("receive_car", { p_booking_id: b1, p_lines: [{ id: p1 }], p_email: null, p_odometer: null, p_consent: true, p_on_paper: false }, manager)
  ok("קבלה שנייה של אותו תור נדחית (arrived)", !again.ok && again.hint === "arrived")

  // 3. בלי הסכמה ובלי נייר: נדחה לפני שנרשם משהו
  const b2 = await newBooking({ whatsapp_consent: false })
  const noConsent = await rpc("receive_car", { p_booking_id: b2, p_lines: [{ id: p1 }], p_email: null, p_odometer: null, p_consent: false, p_on_paper: false }, manager)
  ok("בלי הסכמה ובלי נייר: רמז paper", !noConsent.ok && noConsent.hint === "paper")
  ok("ולא נוצר כרטיס", (await jobsOf(b2)).length === 0)
  const paper = await rpc("receive_car", { p_booking_id: b2, p_lines: [{ id: p1 }], p_email: null, p_odometer: null, p_consent: false, p_on_paper: true }, manager)
  ok("על נייר: מצליח בלי קישור", paper.ok && paper.data?.job_id > 0 && paper.data?.token === null, JSON.stringify(paper.data).slice(0, 120))
  if (paper.data?.job_id) jobs.push(paper.data.job_id)

  // 4. מכונאי ואורח לא מקבלים רכב
  const b3 = await newBooking()
  ok("מכונאי לא מקבל רכב", !(await rpc("receive_car", { p_booking_id: b3, p_lines: [{ id: p1 }], p_email: null, p_odometer: null, p_consent: true, p_on_paper: false }, mechanic)).ok)
  ok("אורח לא מקבל רכב", !(await rpc("receive_car", { p_booking_id: b3, p_lines: [{ id: p1 }], p_email: null, p_odometer: null, p_consent: true, p_on_paper: false }, anonKey)).ok)
  ok("ולא נוצר כרטיס", (await jobsOf(b3)).length === 0)

  // 5. תפיסת ניסיון חוזר: פעם אחת
  const [media] = await (
    await admin(`/rest/v1/media`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ job_card_id: jobId, kind: "audio", storage_path: `job-${jobId}/test-${stamp}.webm`, mime: "audio/webm", bytes: 10 }),
    })
  ).json()
  const first = await rpc("claim_media_retry", { p_media_id: media.id }, manager)
  const second = await rpc("claim_media_retry", { p_media_id: media.id }, manager)
  ok("תפיסה ראשונה מצליחה", first.ok && first.data === true)
  ok("תפיסה שנייה בתוך שתי דקות נדחית", second.ok && second.data === false)
  const [photo] = await (
    await admin(`/rest/v1/media`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ job_card_id: jobId, kind: "photo", storage_path: `job-${jobId}/test-${stamp}.jpg`, mime: "image/jpeg", bytes: 10 }),
    })
  ).json()
  ok("תמונה לא נתפסת לתמלול", (await rpc("claim_media_retry", { p_media_id: photo.id }, manager)).data === false)
  ok("אורח לא תופס", !(await rpc("claim_media_retry", { p_media_id: media.id }, anonKey)).ok || (await rpc("claim_media_retry", { p_media_id: media.id }, anonKey)).data === false)
} finally {
  for (const id of jobs) {
    await admin(`/rest/v1/media?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/quote_requests?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/quote_items?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  for (const id of bookings) await admin(`/rest/v1/bookings?id=eq.${id}`, { method: "DELETE" })
  const leftJobs = (await (await admin(`/rest/v1/job_cards?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()) ?? []
  const leftBookings = (await (await admin(`/rest/v1/bookings?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()) ?? []
  ok("ניקוי: לא נשארו רשומות", leftJobs.length === 0 && leftBookings.length === 0, `${leftJobs.length} כרטיסים, ${leftBookings.length} תורים`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
