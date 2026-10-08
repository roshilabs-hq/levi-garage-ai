// בודק את 056 (ביקורת שלישית, 8.10, ממצא 6): קובץ שעלה לאחסון בלי שורה ב-media נמחק בשם מי
// שהעלה אותו. המדיניות צרה: רק הקובץ שלך, רק בעשר הדקות האחרונות, ורק אם אין לו שורה.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/orphan-media.mjs
//
// כל מה שנוצר כאן נמחק בסוף.

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
  fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${token}`, ...(init.headers || {}) } })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: passwordFor(email) }),
  })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

// JPEG זעיר: מספיק לאחסון, שבודק רק את סוג התוכן שהוצהר
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])
const upload = (path, token) =>
  call(`/storage/v1/object/job-media/${path}`, { method: "POST", token, headers: { "content-type": "image/jpeg" }, body: JPEG })
// כמה קבצים באמת נמחקו: כש-RLS לא מרשה, האחסון מחזיר רשימה ריקה
const removed = async (path, token) => {
  const res = await call(`/storage/v1/object/job-media`, {
    method: "DELETE",
    token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  })
  const j = await res.json().catch(() => [])
  return Array.isArray(j) ? j.length : 0
}
const exists = async (path) => (await admin(`/storage/v1/object/info/job-media/${path}`)).ok

const mechanic = await signIn("test5@test.com")
const manager = await signIn("test1@test.com")
const NOTE = "רשומת בדיקה אוטומטית (orphan-media)"
const stamp = Date.now()
// הקבצים בתיקייה של הרכב, כמו בייצור: מ-069 מכונאי כותב רק לתיקייה של רכב שמותר לו לגעת בו
const paths = []
let jobId = null

try {
  const [job] = await (
    await admin(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({ plate: "7360456", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "בדיקת קובץ יתום", customer_phone: "0500000456", status: "in_progress", notes: NOTE }),
    })
  ).json()
  jobId = job.id
  paths.push(`job-${jobId}/orphan-${stamp}-a.jpg`, `job-${jobId}/orphan-${stamp}-b.jpg`, `job-${jobId}/orphan-${stamp}-c.jpg`)

  // 1. קובץ יתום שלי: נמחק
  ok("מכונאי מעלה קובץ", (await upload(paths[0], mechanic)).ok)
  ok("מכונאי מוחק את הקובץ היתום שלו", (await removed(paths[0], mechanic)) === 1 && !(await exists(paths[0])))

  // 2. קובץ שיש לו שורה ב-media: לא נמחק
  ok("מכונאי מעלה קובץ נוסף", (await upload(paths[1], mechanic)).ok)
  await admin(`/rest/v1/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job_card_id: jobId, kind: "photo", storage_path: paths[1], mime: "image/jpeg", bytes: JPEG.length }),
  })
  ok("קובץ שרשום ב-media לא נמחק", (await removed(paths[1], mechanic)) === 0 && (await exists(paths[1])))

  // 3. קובץ של מישהו אחר: לא נמחק
  ok("מנהל מעלה קובץ", (await upload(paths[2], manager)).ok)
  ok("מכונאי לא מוחק קובץ יתום של מישהו אחר", (await removed(paths[2], mechanic)) === 0 && (await exists(paths[2])))

  // 4. אורח: לא מוחק כלום
  ok("אורח לא מוחק", (await removed(paths[2], anonKey)) === 0 && (await exists(paths[2])))
} finally {
  if (jobId) {
    await admin(`/rest/v1/media?job_card_id=eq.${jobId}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${jobId}`, { method: "DELETE" })
  }
  await admin(`/storage/v1/object/job-media`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) })
  const left = await Promise.all(paths.map(exists))
  ok("ניקוי: לא נשארו קבצים", left.every((x) => !x), JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
