// בודק שהקישור בין הקלטה לטיוטה באמת נשמר.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/media-link.mjs
//
// למה זה קיים: העמודה media.finding_id הייתה מעודכנת בקוד מהיום הראשון,
// אבל לטבלה היו רק מדיניות SELECT ו-INSERT. PostgREST מחזיר 204 גם כשלא
// עודכנה אף שורה, ולכן הכישלון היה שקט לחלוטין — ואף מסך לא הציג את הקישור,
// אז אף אחד לא ידע. הבדיקה הזאת קוראת את השורה בחזרה, ולא מסתפקת בקוד תשובה.

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

// ---------- מכינים כרטיס, ממצא והקלטה, בתור המערכת ----------
const [job] = await (
  await service(`/rest/v1/job_cards`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ plate: "9999999", status: "in_progress", notes: "בדיקת קישור מדיה" }),
  })
).json()

const [finding] = await (
  await service(`/rest/v1/findings`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ job_card_id: job.id, source: "voice", summary: "בדיקה", status: "draft" }),
  })
).json()

const [media] = await (
  await service(`/rest/v1/media`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ job_card_id: job.id, kind: "audio", storage_path: `job-${job.id}/test.webm`, mime: "audio/webm" }),
  })
).json()

ok("נוצרה הקלטה בלי טיוטה", media?.finding_id === null)

// ---------- מכונאי מקשר אותה לטיוטה ----------
const mechanic = await signIn("test2@test.com")
const patch = await call(`/rest/v1/media?id=eq.${media.id}`, {
  method: "PATCH",
  token: mechanic,
  body: JSON.stringify({ finding_id: finding.id }),
})

// **הבדיקה האמיתית**: לא קוד התשובה, אלא מה שורה בטבלה אומרת אחריה.
const after = (await (await service(`/rest/v1/media?id=eq.${media.id}&select=finding_id`)).json())[0]
ok("הקישור נשמר בפועל, ולא רק החזיר 204", after?.finding_id === finding.id, `HTTP ${patch.status}, בטבלה: ${after?.finding_id}`)

// ---------- מסך תלוי לא מקשר כלום ----------
const screen = await signIn("screen2@test.com")
await call(`/rest/v1/media?id=eq.${media.id}`, {
  method: "PATCH",
  token: screen,
  body: JSON.stringify({ finding_id: null }),
})
const afterScreen = (await (await service(`/rest/v1/media?id=eq.${media.id}&select=finding_id`)).json())[0]
ok("מסך תלוי לא מצליח לנתק את הקישור", afterScreen?.finding_id === finding.id)

// ---------- ניקוי ----------
if (!process.env.KEEP_TEST_ROWS) {
  await service(`/rest/v1/job_cards?id=eq.${job.id}`, { method: "DELETE" })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
