// איך בדיקה מתחברת כאיש צוות.
//
// מכונאי לא נכנס בסיסמת ההדגמה: מ-016 הוא נכנס רק מעמדה מצומדת, והסיסמה שלו
// נגזרת מ-STATION_SECRET (כמו ב-levi-garage/lib/staff/station.ts). כל השאר —
// מנהל, בעלים, מסכים — בסיסמת ההדגמה.

import { createHmac } from "node:crypto"

const MECHANICS = new Set(["test2@test.com", "test4@test.com", "test5@test.com", "test6@test.com"])

export function passwordFor(email) {
  if (!MECHANICS.has(email)) {
    const p = process.env.STAFF_DEMO_PASSWORD
    if (!p) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")
    return p
  }
  const secret = process.env.STATION_SECRET
  if (!secret) throw new Error("חסר STATION_SECRET. להריץ עם --env-file=levi-garage/.env.staff.local")
  return createHmac("sha256", secret).update(`mechanic:${email.trim().toLowerCase()}`).digest("base64url")
}
