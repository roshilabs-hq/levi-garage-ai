// יוצר את משתמשי הצוות להדגמה, ואת שורות ה-staff שלהם.
// הרצה: node --env-file=.env.local --env-file=.env.staff.local scripts/seed-staff.mjs
//
// אידמפוטנטי: אפשר להריץ שוב ושוב. משתמש שכבר קיים לא נוצר מחדש, והשורה שלו מתעדכנת.
// הסיסמה להדגמה מגיעה מ-STAFF_DEMO_PASSWORD בקובץ המקומי .env.staff.local (לא בגיט),
// שנוצר ב-scripts/new-staff-password.mjs. אין ברירת מחדל בקוד: עד 27.9 הייתה כאן
// סיסמה קבועה, והריפו ציבורי — כלומר כל מי שקרא אותו יכל להיכנס כמנהל העבודה.

import { createHmac } from "node:crypto"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) {
  console.error("חסר NEXT_PUBLIC_SUPABASE_URL או SUPABASE_SECRET_KEY")
  process.exit(1)
}

const password = process.env.STAFF_DEMO_PASSWORD
// מכונאי נכנס רק מעמדה (016): הסיסמה שלו נגזרת מ-STATION_SECRET, כמו ב-lib/staff/station.ts.
// בלי השורה הזו, הרצה חוזרת של הסקריפט הייתה מחזירה אותו לסיסמה המשותפת.
const passwordOf = (person) =>
  person.role === "mechanic" && process.env.STATION_SECRET
    ? createHmac("sha256", process.env.STATION_SECRET).update(`mechanic:${person.email.trim().toLowerCase()}`).digest("base64url")
    : password
if (!password || password.length < 12) {
  console.error("חסר STAFF_DEMO_PASSWORD (12 תווים לפחות). ליצור: node scripts/new-staff-password.mjs")
  process.exit(1)
}

const TEAM = [
  { email: "test1@test.com", full_name: "דניאל לוי", role: "manager", lift: null, lang: "he" },
  { email: "test2@test.com", full_name: "סאמר", role: "mechanic", lift: 2, lang: "ar" },
  { email: "test3@test.com", full_name: "אבי לוי", role: "owner", lift: null, lang: "he" },
  { email: "test4@test.com", full_name: "אלכס", role: "mechanic", lift: null, lang: "ru" },  // חשמל ומיזוג, בעמדת האבחון
  { email: "test5@test.com", full_name: "מוטי", role: "mechanic", lift: 1, lang: "he" },
  { email: "test6@test.com", full_name: "נועם", role: "mechanic", lift: null, lang: "he" },   // שוליה, עובר בין ליפטים

  // שני המסכים התלויים. אלה לא אנשים: זו זהות שיודעת לפתוח מסך אחד ותו לא.
  // המסך בחדר ההמתנה נשאר מחובר כל היום בחדר ציבורי, ולכן הוא לא מקבל את
  // המשתמש של דניאל — מי שייגע בו היה מגיע לשמות, לטלפונים ולמחירים.
  { email: "screen1@test.com", full_name: "מסך חדר ההמתנה", role: "display", lift: null, lang: "he", screen: "lobby" },
  { email: "screen2@test.com", full_name: "מסך הסדנה", role: "display", lift: null, lang: "he", screen: "wall" },
]

// המשתמשים הישנים, מלפני שעברנו לכתובות הקצרות. נמחקים בהרצה הראשונה.
const RETIRED = ["daniel@levi-garage.demo", "avi@levi-garage.demo", "samer@levi-garage.demo", "alex@levi-garage.demo"]

const admin = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  })

async function findUser(email) {
  const res = await admin(`/auth/v1/admin/users?per_page=200`)
  if (!res.ok) throw new Error(`list users: ${res.status} ${await res.text()}`)
  const { users } = await res.json()
  return users.find((u) => u.email === email) || null
}

async function upsertUser(person) {
  const existing = await findUser(person.email)
  if (existing) {
    // מיישר את הסיסמה, כדי שההדגמה תמיד תעבוד עם מה שכתוב ב-README.
    const res = await admin(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: passwordOf(person), email_confirm: true }),
    })
    if (!res.ok) throw new Error(`update ${person.email}: ${res.status} ${await res.text()}`)
    return existing.id
  }
  const res = await admin(`/auth/v1/admin/users`, {
    method: "POST",
    body: JSON.stringify({ email: person.email, password: passwordOf(person), email_confirm: true }),
  })
  if (!res.ok) throw new Error(`create ${person.email}: ${res.status} ${await res.text()}`)
  return (await res.json()).id
}

async function upsertStaffRow(id, person) {
  const res = await admin(`/rest/v1/staff?on_conflict=id`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id,
      full_name: person.full_name,
      role: person.role,
      lift: person.lift,
      screen: person.screen ?? null,
      lang: person.lang,
      active: true,
    }),
  })
  if (!res.ok) throw new Error(`staff row ${person.email}: ${res.status} ${await res.text()}`)
}

for (const email of RETIRED) {
  const old = await findUser(email)
  if (!old) continue
  const res = await admin(`/auth/v1/admin/users/${old.id}`, { method: "DELETE" })
  // בלי הבדיקה הזו מחיקה שנכשלת נראית כמו הצלחה, ומשתמש ישן ממשיך לעבוד.
  console.log(res.ok ? `· הוסר משתמש ישן: ${email}` : `✗ לא הצלחתי להסיר את ${email}: ${res.status} ${await res.text()}`)
}

for (const person of TEAM) {
  const id = await upsertUser(person)
  await upsertStaffRow(id, person)
  console.log(`✓ ${person.full_name} (${person.role}${person.lift ? `, ליפט ${person.lift}` : ""}${person.screen ? `, ${person.screen}` : ""}) - ${person.email}`)
}

// הסיסמה לא מודפסת: היא בקובץ .env.staff.local, ומשם למסמך ההגשה.
console.log("")
console.log("הסיסמה לכולם: בקובץ .env.staff.local (לא מודפסת)")
