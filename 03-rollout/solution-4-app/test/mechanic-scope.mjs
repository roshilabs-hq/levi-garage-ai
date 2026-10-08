// בודק את 051 (ביקורת אבטחה חיצונית, 7.10, ממצא 1): מכונאי פועל רק על רכב פעיל שעל הליפט שלו,
// או על רכב שעוד לא על ליפט. ממצא ותמונה חייבים להיות של אותו רכב. מנהל לא מושפע.
// הכול דרך PostgREST, בשם המשתמשים, בלי המסכים.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-4-app/test/mechanic-scope.mjs
//
// כל מה שנוצר כאן נמחק בסוף, והליפטים של המכונאים חוזרים למה שהיו, גם אם בדיקה נכשלה.

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
// כמה שורות השתנו בפועל: כש-RLS מסנן, PostgREST מחזיר 200 עם רשימה ריקה
const patched = async (table, id, body, token) => {
  const res = await call(`/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body), token, headers: { prefer: "return=representation" } })
  if (!res.ok) return 0
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows.length : 0
}
const inserted = async (table, body, token) => {
  const res = await call(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(body), token, headers: { prefer: "return=representation" } })
  if (!res.ok) return null
  const [r] = await res.json()
  return r
}
const hint = async (res) => (res.ok ? "ok" : ((await res.json().catch(() => ({}))).hint ?? `status ${res.status}`))

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  const j = await res.json()
  return { token: j.access_token, id: j.user.id }
}

const manager = await signIn("test1@test.com")
const mechA = await signIn("test5@test.com")
const mechB = await signIn("test6@test.com")
const NOTE = "רשומת בדיקה אוטומטית (mechanic-scope)"
const jobs = []
const before = await (await admin(`/rest/v1/staff?id=in.(${mechA.id},${mechB.id})&select=id,lift`)).json()
const STATION_LABEL = "עמדת בדיקה אוטומטית (mechanic-scope)"
const stationTokens = {}

try {
  // שני ליפטים שאין עליהם עכשיו רכב פעיל, כדי לא להתנגש ברכבי ההדגמה
  const busy = new Set(
    (await (await admin(`/rest/v1/job_cards?select=lift&lift=not.is.null&status=in.(open,in_progress,waiting_quote,waiting_approval)`)).json()).map((r) => r.lift),
  )
  const free = [1, 2, 3, 4].filter((l) => !busy.has(l))
  if (free.length < 2) throw new Error(`צריך שני ליפטים פנויים, יש ${free.length}`)
  const [L1, L2] = free

  const newJob = async (over = {}) => {
    const [j] = await (
      await admin(`/rest/v1/job_cards`, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          plate: "7360451", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "בדיקת הרשאות מכונאי", customer_phone: "0500000451",
          status: "in_progress", work_approved_at: new Date().toISOString(), work_approved_via: "link", notes: NOTE, ...over,
        }),
      })
    ).json()
    if (!j?.id) throw new Error(`יצירת כרטיס נכשלה: ${JSON.stringify(j)}`)
    jobs.push(j.id)
    return j
  }
  const newFinding = async (jobId) => {
    const [f] = await (
      await admin(`/rest/v1/findings`, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ job_card_id: jobId, source: "manual", title: "בדיקה", summary: "בדיקה", urgency: "yellow", status: "draft" }),
      })
    ).json()
    return f
  }

  // המכונאי A עובד על L1, B על L2: כל אחד נרשם בעמדת בדיקה של הליפט שלו, כמו מכשיר אמיתי
  // (bind_station_session, 057). מ-059 כניסה של מכונאי בלי עמדה לא עובדת על אף ליפט.
  const ownLift = async (token) => (await (await rpc("my_lift", {}, token)).json())
  ok("A, לפני שנרשם בעמדה: אין לו ליפט (059)", (await ownLift(mechA.token)) === null)
  for (const lift of [L1, L2]) {
    const res = await rpc("create_station", { p_label: STATION_LABEL, p_lift: lift }, manager.token)
    stationTokens[lift] = await res.json()
  }
  ok("A נרשם בעמדה של L1", (await rpc("bind_station_session", { p_token: stationTokens[L1] }, mechA.token)).ok)
  ok("B נרשם בעמדה של L2", (await rpc("bind_station_session", { p_token: stationTokens[L2] }, mechB.token)).ok)

  // 054 (ביקורת חוזרת, 8.10, ממצא 1): מכונאי לא מעביר את עצמו לליפט אחר
  ok("A: לא בוחר לעצמו ליפט אחר (set_my_lift)", (await hint(await rpc("set_my_lift", { p_lift: L2 }, mechA.token))) === "lift-from-station")
  ok("A: נשאר על הליפט שלו אחרי הניסיון", (await ownLift(mechA.token)) === L1)
  ok("A: לא משנה ליפט ישירות בטבלה", (await patched("staff", mechA.id, { lift: L2 }, mechA.token)) === 0 && (await ownLift(mechA.token)) === L1)

  const onMine = await newJob({ lift: L1 })
  const onOther = await newJob({ lift: L2 })
  const queued = await newJob({ status: "open" })
  const closed = await newJob({ status: "ready" })
  const otherFinding = await newFinding(onOther.id)
  const myFinding = await newFinding(onMine.id)
  const [priceItem] = await (await admin(`/rest/v1/price_list?active=eq.true&select=id&limit=1`)).json()

  // 1. כרטיסים
  ok("A: מעדכן את הרכב שעל הליפט שלו", (await patched("job_cards", onMine.id, { inspected_at: new Date().toISOString() }, mechA.token)) === 1)
  ok("A: לא מעדכן רכב שעל ליפט אחר", (await patched("job_cards", onOther.id, { inspected_at: new Date().toISOString() }, mechA.token)) === 0)
  ok("A: מעדכן רכב בתור (בלי ליפט)", (await patched("job_cards", queued.id, { status: "in_progress" }, mechA.token)) === 1)
  ok("A: לא מעלה רכב מהתור לליפט של מישהו אחר", (await patched("job_cards", queued.id, { lift: L2 }, mechA.token)) === 0)
  ok("A: לא נוגע בכרטיס שכבר מוכן", (await patched("job_cards", closed.id, { inspected_at: new Date().toISOString() }, mechA.token)) === 0)
  ok("A: מוריד את הרכב שלו לחניה", (await patched("job_cards", onMine.id, { lift: null, parked_at: new Date().toISOString() }, mechA.token)) === 1)
  // מחזירים אותו לליפט (כמנהל) להמשך הבדיקה
  ok("מנהל: מחזיר את הרכב לליפט של A", (await patched("job_cards", onMine.id, { lift: L1, parked_at: null }, manager.token)) === 1)

  // 2. set_inspection_item
  ok("A: מסמן פריט בבדיקה של הרכב שלו", (await rpc("set_inspection_item", { p_job_id: onMine.id, p_key: "brakes", p_light: "yellow" }, mechA.token)).ok)
  ok("A: לא מסמן בבדיקה של רכב על ליפט אחר", (await hint(await rpc("set_inspection_item", { p_job_id: onOther.id, p_key: "brakes", p_light: "yellow" }, mechA.token))) === "not-your-car")
  ok("A: לא מקשר ממצא של רכב אחר", (await hint(await rpc("set_inspection_item", { p_job_id: onMine.id, p_key: "tires", p_light: "red", p_finding_id: otherFinding.id }, mechA.token))) === "finding-job")
  ok("A: מקשר ממצא של הרכב שלו", (await rpc("set_inspection_item", { p_job_id: onMine.id, p_key: "tires", p_light: "red", p_finding_id: myFinding.id }, mechA.token)).ok)
  ok("A: לא מסמן בבדיקה של כרטיס מוכן", (await hint(await rpc("set_inspection_item", { p_job_id: closed.id, p_key: "brakes", p_light: "green" }, mechA.token))) === "not-your-car")
  ok("A: לא כותב ישירות לטבלת הבדיקות של רכב אחר", !(await call(`/rest/v1/inspections`, { method: "POST", token: mechA.token, body: JSON.stringify({ job_card_id: onOther.id, items: {} }) })).ok)

  // 3. ממצאים
  const base = { source: "voice", title: "בדיקה", summary: "בדיקה", urgency: "yellow", status: "draft" }
  ok("A: מוסיף ממצא לרכב שלו", Boolean(await inserted("findings", { ...base, job_card_id: onMine.id }, mechA.token)))
  ok("A: לא מוסיף ממצא לרכב על ליפט אחר", !(await inserted("findings", { ...base, job_card_id: onOther.id }, mechA.token)))
  ok("A: לא משנה ממצא של רכב על ליפט אחר", (await patched("findings", otherFinding.id, { summary: "שונה" }, mechA.token)) === 0)
  if (priceItem) {
    ok("A: עבודה מהמחירון לרכב שלו", (await rpc("add_price_list_finding", { p_job_id: onMine.id, p_price_list_id: priceItem.id }, mechA.token)).ok)
    ok("A: לא עבודה מהמחירון לרכב על ליפט אחר", (await hint(await rpc("add_price_list_finding", { p_job_id: onOther.id, p_price_list_id: priceItem.id }, mechA.token))) === "not-your-car")
  }

  // 4. מדיה
  const media = (jobId, findingId = null) => ({ job_card_id: jobId, finding_id: findingId, kind: "photo", storage_path: `test/scope-${jobId}-${Date.now()}.jpg`, mime: "image/jpeg", bytes: 1, created_by: mechA.id })
  ok("A: מוסיף תמונה לרכב שלו", Boolean(await inserted("media", media(onMine.id, myFinding.id), mechA.token)))
  ok("A: לא מוסיף תמונה לרכב על ליפט אחר", !(await inserted("media", media(onOther.id), mechA.token)))
  ok("A: לא מצמיד לרכב שלו ממצא של רכב אחר", !(await inserted("media", media(onMine.id, otherFinding.id), mechA.token)))

  // 5. B על הליפט שלו, ומנהל בלי שינוי
  ok("B: מעדכן את הרכב שעל הליפט שלו", (await patched("job_cards", onOther.id, { inspected_at: new Date().toISOString() }, mechB.token)) === 1)
  ok("מנהל: מעדכן רכב על כל ליפט", (await patched("job_cards", onOther.id, { inspected_at: new Date().toISOString() }, manager.token)) === 1)
  ok("מנהל: מסמן בבדיקה של כל רכב", (await rpc("set_inspection_item", { p_job_id: onOther.id, p_key: "brakes", p_light: "green" }, manager.token)).ok)
  ok("מנהל: מעדכן כרטיס מוכן", (await patched("job_cards", closed.id, { inspected_at: new Date().toISOString() }, manager.token)) === 1)
} finally {
  for (const id of jobs) {
    const fs = await (await admin(`/rest/v1/findings?job_card_id=eq.${id}&select=id`)).json()
    for (const f of Array.isArray(fs) ? fs : []) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    for (const t of ["media", "quote_requests", "quote_items", "quote_versions", "customer_notices", "help_calls", "findings", "job_moves", "inspections"]) {
      await admin(`/rest/v1/${t}?job_card_id=eq.${id}`, { method: "DELETE" })
    }
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  // עמדות הבדיקה, ואיתן רישומי הכניסה (on delete cascade)
  await admin(`/rest/v1/stations?label=eq.${encodeURIComponent(STATION_LABEL)}`, { method: "DELETE" })
  for (const s of Array.isArray(before) ? before : []) {
    await admin(`/rest/v1/staff?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ lift: s.lift }) })
  }
  const left = await (await admin(`/rest/v1/job_cards?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()
  ok("ניקוי: לא נשארו רשומות בדיקה", Array.isArray(left) && left.length === 0, JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
