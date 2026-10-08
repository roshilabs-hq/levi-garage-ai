// בודק את 061: הניקוי החודשי. רק השרת מריץ אותו (סוד שנגזר מ-STATION_SECRET), הוא מוחק נתונים
// טכניים בלבד, ומחזיר דוח שנרשם ביומן האבטחה. אבי ודניאל רואים מתי רץ.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/housekeeping.mjs
//
// שימו לב: הבדיקה מריצה את הניקוי באמת. הוא מוחק רק רישומי כניסה מעל 30 יום, מוני קצב מעל יומיים,
// בקשות חיבור וקודי צימוד שפגו, ואירועי אבטחה מעל שנה. נתוני לקוחות רק נספרים.

import { createHmac } from "node:crypto"

import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!process.env.STATION_SECRET) throw new Error("חסר STATION_SECRET (levi-garage/.env.staff.local)")
const secret = createHmac("sha256", process.env.STATION_SECRET).update("housekeeping-v1").digest("base64url")

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
const rpc = (fn, body, token = anonKey) =>
  fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

ok("בלי סוד: נחסם", !(await rpc("housekeeping", { p_secret: null })).ok)
ok("סוד שגוי: נחסם", !(await rpc("housekeeping", { p_secret: "x".repeat(43) })).ok)
// הסוד של הגבלת הקצב (052) לא פותח את הניקוי: לכל אחד סוד משלו
const rateSecret = createHmac("sha256", process.env.STATION_SECRET).update("rate-limit-v1").digest("base64url")
ok("הסוד של הגבלת הקצב לא פותח את הניקוי", !(await rpc("housekeeping", { p_secret: rateSecret })).ok)

const res = await rpc("housekeeping", { p_secret: secret })
const report = res.ok ? await res.json() : null
ok("עם הסוד של השרת: רץ ומחזיר דוח", Boolean(report?.deleted) && Boolean(report?.due_for_manual_deletion), JSON.stringify(report))
ok("הדוח סופר, לא מוחק, נתוני לקוחות", ["job_cards_over_3_years", "bookings_over_3_years", "shared_photos_of_closed_links"].every((k) => Number.isInteger(report?.due_for_manual_deletion?.[k])))
console.log("  הדוח:", JSON.stringify(report))

const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email: "test1@test.com", password: passwordFor("test1@test.com") }),
})
const manager = (await login.json()).access_token
const alerts = await (await rpc("security_alerts", {}, manager)).json()
ok("מנהל רואה מתי הניקוי רץ", Boolean(alerts?.last_housekeeping?.at), JSON.stringify(alerts?.last_housekeeping))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
