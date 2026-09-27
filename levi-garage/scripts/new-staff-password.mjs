// יוצר סיסמה חדשה לכל משתמשי הצוות של ההדגמה, ושומר אותה רק בקובץ מקומי.
//
//   node scripts/new-staff-password.mjs          (מתוך levi-garage/)
//
// הקובץ .env.staff.local לא נכנס לגיט (.env*.local ב-.gitignore). הסקריפט לא
// מדפיס את הסיסמה: פותחים את הקובץ כדי להעתיק אותה למסמך ההגשה.
// קובץ שכבר קיים לא נדרס, כדי לא לאבד בטעות סיסמה שכבר נמסרה לבוחנים.
//
// אחרי זה: node --env-file=.env.local --env-file=.env.staff.local scripts/seed-staff.mjs
// מחליף את הסיסמה בפועל לכל המשתמשים.

import { existsSync, writeFileSync } from "node:fs"
import { randomInt } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.staff.local")
if (existsSync(file)) {
  console.log(`הקובץ כבר קיים, לא נגעתי בו: ${file}`)
  process.exit(0)
}

// נוחה להקלדה מול קהל: אותיות קטנות וספרות בלי תווים שמתבלבלים (0/o, 1/l),
// בשלוש קבוצות. 12 תווים מתוך 32 = 60 ביט, הרבה מעבר למה שניחוש מקוון יגיע אליו.
const ABC = "abcdefghijkmnpqrstuvwxyz23456789"
const group = () => Array.from({ length: 4 }, () => ABC[randomInt(ABC.length)]).join("")
const password = `${group()}-${group()}-${group()}`

writeFileSync(file, `# סיסמת הצוות להדגמה. לא לגיט, לא לצ'אט. נמסרת לבוחנים רק במסמך ההגשה.\nSTAFF_DEMO_PASSWORD=${password}\n`, { flag: "wx" })
console.log(`✓ נוצרה סיסמה חדשה ונשמרה ב-${file} (לא הודפסה)`)
