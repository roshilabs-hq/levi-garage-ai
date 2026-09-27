// בודק את מסלול האישור מול מסד הנתונים האמיתי, עם ההרשאות האמיתיות.
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/approval-flow.mjs
//
// מה נבדק:
//   1. מכונאי לא יכול לשלוח מחיר ללקוח. רק מנהל עבודה או בעלים.
//   2. מנהל עבודה שולח, ונוצר טוקן. הכרטיס עובר ל"ממתין לאישור".
//   3. דף הלקוח קורא לפי טוקן בלבד, בלי התחברות, ורואה רק את מה שנשלח לו.
//   4. טוקן שגוי מחזיר כלום. לא שגיאה שמסגירה שהוא קיים.
//   5. הלקוח מאשר פעם אחת. ניסיון שני נחסם.
//   6. האישור נשמר בכתב: מה נשלח, מה נבחר, כמה, ומתי.

import { passwordFor } from "./_auth.mjs"

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
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, {
    method: "POST",
    body: JSON.stringify({ email, password: passwordFor(email) }),
  })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

const service = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) },
  })

// ---------- מכינים כרטיס וממצא, בתור המערכת ----------
const jobRes = await service(`/rest/v1/job_cards`, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    plate: "8215376",
    vehicle_make: "סקודה צ'כיה",
    vehicle_model: "FABIA",
    vehicle_year: 2012,
    engine_code: "CBZ",
    customer_name: "לקוח בדיקה",
    customer_phone: "0500000000",
    lift: 2,
    status: "in_progress",
    whatsapp_consent: true,
    updates_consent_at: new Date().toISOString(),
    notes: "רשומת בדיקה אוטומטית",
  }),
})
const [job] = await jobRes.json()

const findRes = await service(`/rest/v1/findings`, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    job_card_id: job.id,
    source: "voice",
    transcript: "בטוסון יש נזילה במשאבת המים, מקורי 800 וחלופי 500",
    summary: "נזילה ממשאבת המים. נדרשת החלפה.",
    customer_text: "מצאנו נזילה ממשאבת המים. מקורי 800 ש\"ח, חלופי 500 ש\"ח. אם מאשרים עכשיו, הרכב מוכן היום ב-15:00.",
    price_original: 800,
    price_aftermarket: 500,
    // מה שהחוק דורש בהצעה (ס' 131–132, נאכף ב-014): שעות, אחריות לכל סוג, וההבדל.
    labor_hours: 3,
    warranty_original: "12 חודשים",
    warranty_aftermarket: "6 חודשים",
    part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.",
    eta: "היום ב-15:00",
    model: "gemini-2.5-pro",
  }),
})
const [finding] = await findRes.json()

// ---------- 1. מכונאי לא שולח מחירים ----------
const mechanic = await signIn("test2@test.com")
let res = await call(`/rest/v1/rpc/send_finding`, {
  token: mechanic,
  method: "POST",
  body: JSON.stringify({ p_finding_id: finding.id, p_message: "נסיון של מכונאי" }),
})
const mechanicBody = await res.text()
ok("מכונאי לא יכול לשלוח מחיר ללקוח", res.status === 403 || /42501|only a manager/.test(mechanicBody), `status ${res.status}`)

// ---------- 2. מנהל עבודה שולח ----------
const manager = await signIn("test1@test.com")
const message = "מצאנו נזילה ממשאבת המים. מקורי 800 ש\"ח, חלופי 500 ש\"ח, כולל מע\"מ. אם מאשרים עכשיו, הרכב מוכן היום ב-15:00."
res = await call(`/rest/v1/rpc/send_finding`, {
  token: manager,
  method: "POST",
  body: JSON.stringify({ p_finding_id: finding.id, p_message: message }),
})
const tokenValue = await res.json()
ok("מנהל עבודה שולח, ומתקבל טוקן", res.ok && typeof tokenValue === "string" && tokenValue.length === 36, `got ${JSON.stringify(tokenValue).slice(0, 40)}`)

const jobAfterSend = await (await service(`/rest/v1/job_cards?id=eq.${job.id}&select=status`)).json()
ok("הכרטיס עבר ל'ממתין לאישור'", jobAfterSend[0]?.status === "waiting_approval", jobAfterSend[0]?.status)

// ---------- 3. דף הלקוח, בלי התחברות ----------
res = await call(`/rest/v1/rpc/approval_view`, {
  method: "POST",
  body: JSON.stringify({ p_token: tokenValue }),
})
const view = (await res.json())[0]
ok("הלקוח רואה את ההודעה שנשלחה לו", view?.message_text === message)
ok("ואת שני המחירים", Number(view?.price_original) === 800 && Number(view?.price_aftermarket) === 500)
ok("רק שלוש ספרות מהרישוי, לא המספר המלא", view?.plate_last3 === "376" && !JSON.stringify(view).includes("8215376"))
ok("ובלי טלפון או שם של הלקוח", !JSON.stringify(view).includes("0500000000") && !JSON.stringify(view).includes("לקוח בדיקה"))

// ---------- 4. טוקן שגוי ----------
res = await call(`/rest/v1/rpc/approval_view`, {
  method: "POST",
  body: JSON.stringify({ p_token: "0".repeat(36) }),
})
const empty = await res.json()
ok("טוקן שגוי מחזיר כלום", Array.isArray(empty) && empty.length === 0)

// ---------- 5. הכרעה, פעם אחת ----------
res = await call(`/rest/v1/rpc/approval_decide`, {
  method: "POST",
  body: JSON.stringify({ p_token: tokenValue, p_decision: "approved", p_part_choice: "aftermarket" }),
})
ok("הלקוח מאשר", (await res.json()) === "approved")

res = await call(`/rest/v1/rpc/approval_decide`, {
  method: "POST",
  body: JSON.stringify({ p_token: tokenValue, p_decision: "declined" }),
})
ok("ניסיון שני נחסם", (await res.json()) === "unavailable")

// ---------- 6. מה נשמר בכתב ----------
const saved = (await (await service(`/rest/v1/approvals?finding_id=eq.${finding.id}&select=*`)).json())[0]
ok("נשמר הנוסח המדויק שנשלח", saved?.message_text === message)
ok("נשמרה הבחירה: חלק חלופי", saved?.part_choice === "aftermarket")
ok("נשמר המחיר שאושר", Number(saved?.price_chosen) === 500)
ok("נשמר מתי הוכרע", Boolean(saved?.decided_at))

const findingAfter = (await (await service(`/rest/v1/findings?id=eq.${finding.id}&select=status`)).json())[0]
ok("הממצא מסומן כמאושר", findingAfter?.status === "approved")
const jobAfter = (await (await service(`/rest/v1/job_cards?id=eq.${job.id}&select=status`)).json())[0]
ok("והרכב חזר לעבודה", jobAfter?.status === "in_progress")

// ---------- ניקוי ----------
if (!process.env.KEEP_TEST_ROWS) {
  await service(`/rest/v1/job_cards?id=eq.${job.id}`, { method: "DELETE" })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
