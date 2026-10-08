// בודק את 069 (סקירת OWASP, 8.10, A01): קובצי האחסון של job-media נקראים ונכתבים לפי אותה הרשאה
// כמו שורות המדיה. מכונאי רואה ומעלה רק לתיקייה של רכב שמותר לו; רכב שנמסר לפני ימים נעלם לו גם
// מהאחסון, לא רק מהטבלה. מנהל רואה הכול. אורח לא רואה כלום.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/storage-scope.mjs
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

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])
// העלאה בשם משתמש; ההכנה מעלה בשם השירות, ואז גם כותרת apikey היא מפתח השירות
const upload = (path, token, key = anonKey) =>
  call(`/storage/v1/object/job-media/${path}`, { method: "POST", token, key, headers: { "content-type": "image/jpeg" }, body: JPEG })
const download = async (path, token) => (await call(`/storage/v1/object/authenticated/job-media/${path}`, { token })).status
// רשימת הקבצים בתיקייה, כמו שהמסכים מבקשים. RLS מסנן: מה שלא מותר פשוט לא ברשימה.
const list = async (prefix, token) => {
  const res = await call(`/storage/v1/object/list/job-media`, {
    method: "POST",
    token,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 100 }),
  })
  const j = await res.json().catch(() => [])
  return Array.isArray(j) ? j.map((o) => o.name) : []
}
const exists = async (path) => (await admin(`/storage/v1/object/info/job-media/${path}`)).ok

const mechanic = await signIn("test5@test.com")
const manager = await signIn("test1@test.com")
const NOTE = "רשומת בדיקה אוטומטית (storage-scope)"
const stamp = Date.now()
const made = []
const jobs = []

const newJob = async (body) => {
  const [job] = await (
    await admin(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({ plate: "7360469", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "בדיקת אחסון", customer_phone: "0500000469", notes: NOTE, ...body }),
    })
  ).json()
  if (!job?.id) throw new Error("job_cards insert failed")
  jobs.push(job.id)
  return job.id
}

try {
  // רכב פעיל בלי ליפט (מכונאי בסיסמה רשאי לגעת בו), ורכב שנמסר לפני שלושה ימים (מחוץ לטווח של 062)
  const active = await newJob({ status: "in_progress" })
  const old = await newJob({ status: "delivered", delivered_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString() })
  const pActive = `job-${active}/scope-${stamp}.jpg`
  const pOld = `job-${old}/scope-${stamp}.jpg`
  const pLoose = `test/scope-${stamp}.jpg`
  for (const p of [pActive, pOld, pLoose]) {
    ok(`הכנה: קובץ ${p.split("/")[0]}`, (await upload(p, serviceKey, serviceKey)).ok)
    made.push(p)
  }

  // קריאה
  ok("מכונאי רואה את התיקייה של רכב פעיל", (await list(`job-${active}`, mechanic)).length === 1)
  ok("מכונאי מוריד תמונה של רכב פעיל", (await download(pActive, mechanic)) === 200)
  ok("מכונאי לא רואה את התיקייה של רכב שנמסר לפני 3 ימים", (await list(`job-${old}`, mechanic)).length === 0)
  ok("מכונאי לא מוריד תמונה של רכב שנמסר לפני 3 ימים", (await download(pOld, mechanic)) !== 200)
  ok("ברשימת התיקיות של המכונאי אין את הרכב הישן", !(await list("", mechanic)).includes(`job-${old}`))
  ok("מכונאי לא מוריד קובץ מחוץ לתיקיית רכב", (await download(pLoose, mechanic)) !== 200)
  ok("מנהל רואה את התיקייה של הרכב הישן", (await list(`job-${old}`, manager)).length === 1)
  ok("מנהל מוריד תמונה של הרכב הישן", (await download(pOld, manager)) === 200)
  ok("אורח לא מוריד כלום", (await download(pActive, anonKey)) !== 200)

  // כתיבה
  const mActive = `job-${active}/scope-${stamp}-m.jpg`
  const mOld = `job-${old}/scope-${stamp}-m.jpg`
  const mLoose = `test/scope-${stamp}-m.jpg`
  const gLoose = `test/scope-${stamp}-g.jpg`
  made.push(mActive, mOld, mLoose, gLoose)
  ok("מכונאי מעלה לתיקייה של רכב פעיל", (await upload(mActive, mechanic)).ok)
  ok("מכונאי לא מעלה לתיקייה של רכב שנמסר", !(await upload(mOld, mechanic)).ok && !(await exists(mOld)))
  ok("מכונאי לא מעלה מחוץ לתיקיית רכב", !(await upload(mLoose, mechanic)).ok && !(await exists(mLoose)))
  ok("מנהל מעלה גם מחוץ לתיקיית רכב", (await upload(gLoose, manager)).ok)
  ok("אורח לא מעלה", !(await upload(`job-${active}/scope-${stamp}-anon.jpg`, anonKey)).ok)
} finally {
  await admin(`/storage/v1/object/job-media`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: made }) })
  for (const id of jobs) {
    await admin(`/rest/v1/media?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  const left = await Promise.all(made.map(exists))
  ok("ניקוי: לא נשארו קבצים", left.every((x) => !x), JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
