// הקמת הכניסה בעמדות (016): סוד לגזירת סיסמאות, סיסמאות המכונאים, וקוד הדגמה.
//
//   node --env-file=.env.local --env-file=.env.staff.local scripts/station-setup.mjs   (מתוך levi-garage/)
//
// 1. אם אין STATION_SECRET או STATION_DEMO_PIN ב-.env.staff.local — נוצרים ונכתבים לשם
//    (לא מודפסים). אחרי יצירה צריך להריץ שוב, כדי שייטענו לסביבה.
// 2. הסיסמה של כל מכונאי ב-Supabase מוחלפת לנגזרת מ-STATION_SECRET. אחרי זה
//    מכונאי נכנס רק מעמדה מצומדת, בשם וקוד.
// 3. קוד ההדגמה נקבע לכל המכונאים (דרך set_staff_pin, בזהות של מנהל העבודה).
//    בוחנים מקבלים אותו במסמך ההגשה. במוסך אמיתי דניאל קובע קוד לכל אחד.

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { createHmac, randomBytes, randomInt } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.staff.local")
const current = existsSync(file) ? readFileSync(file, "utf8") : ""
const add = []
if (!/^STATION_SECRET=/m.test(current)) add.push(`STATION_SECRET=${randomBytes(32).toString("base64url")}`)
if (!/^STATION_DEMO_PIN=/m.test(current)) add.push(`STATION_DEMO_PIN=${String(randomInt(0, 1_000_000)).padStart(6, "0")}`)
if (add.length) {
  appendFileSync(file, `${current.endsWith("\n") || !current ? "" : "\n"}# עמדות קבועות (016). לא לגיט, לא לצ'אט.\n${add.join("\n")}\n`)
  console.log(`✓ נוספו ${add.length} ערכים ל-.env.staff.local (לא הודפסו). להריץ שוב את הסקריפט.`)
  process.exit(0)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const stationSecret = process.env.STATION_SECRET
const pin = process.env.STATION_DEMO_PIN
const managerPassword = process.env.STAFF_DEMO_PASSWORD
if (!url || !secret || !stationSecret || !pin || !managerPassword) {
  console.error("✗ חסרים משתנים. להריץ עם --env-file=.env.local --env-file=.env.staff.local")
  process.exit(1)
}

const derive = (email) => createHmac("sha256", stationSecret).update(`mechanic:${email.trim().toLowerCase()}`).digest("base64url")
const admin = (path, init = {}) =>
  fetch(`${url}${path}`, { ...init, headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) } })

const mechanics = await (await admin(`/rest/v1/staff?role=eq.mechanic&active=eq.true&select=id,full_name`)).json()
const { users } = await (await admin(`/auth/v1/admin/users?per_page=200`)).json()

for (const m of mechanics) {
  const email = users.find((u) => u.id === m.id)?.email
  if (!email) continue
  const res = await admin(`/auth/v1/admin/users/${m.id}`, { method: "PUT", body: JSON.stringify({ password: derive(email) }) })
  console.log(res.ok ? `✓ ${m.full_name}: סיסמה נגזרת` : `✗ ${m.full_name}: ${res.status}`)
}

const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "content-type": "application/json" },
  body: JSON.stringify({ email: "test1@test.com", password: managerPassword }),
})
const token = (await login.json()).access_token
for (const m of mechanics) {
  const res = await fetch(`${url}/rest/v1/rpc/set_staff_pin`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ p_staff_id: m.id, p_pin: pin }),
  })
  console.log(res.ok ? `✓ ${m.full_name}: קוד הדגמה נקבע` : `✗ ${m.full_name}: ${res.status} ${await res.text()}`)
}
console.log("\nהקוד והסוד: בקובץ .env.staff.local (לא מודפסים).")
