// בודק את 052 (ביקורת אבטחה חיצונית, 7.10, ממצא 4): מי שיש לו רק את המפתח הציבורי של האתר
// לא סופר יותר במונים של הגבלת הקצב. רק השרת, עם הסוד שנגזר מ-STATION_SECRET (lib/site/rate.ts).
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/rate-gate.mjs

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
import { createHmac } from "node:crypto"
if (!process.env.STATION_SECRET) throw new Error("חסר STATION_SECRET (levi-garage/.env.staff.local)")
const secret = createHmac("sha256", process.env.STATION_SECRET).update("rate-limit-v1").digest("base64url")

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
const rpc = (body) =>
  fetch(`${url}/rest/v1/rpc/rate_hit`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const key = `test:rate-gate:${Date.now()}`
ok("הישנה, בלי סוד: נחסמת", !(await rpc({ p_key: key, p_window_seconds: 60, p_max: 5 })).ok)
ok("החדשה, בלי סוד: נחסמת", !(await rpc({ p_key: key, p_window_seconds: 60, p_max: 5, p_secret: null })).ok)
ok("החדשה, עם סוד שגוי: נחסמת", !(await rpc({ p_key: key, p_window_seconds: 60, p_max: 5, p_secret: "x".repeat(43) })).ok)
const good = await rpc({ p_key: key, p_window_seconds: 60, p_max: 2, p_secret: secret })
ok("עם הסוד של השרת: נספר ומותר", good.ok && (await good.json()) === true)
await rpc({ p_key: key, p_window_seconds: 60, p_max: 2, p_secret: secret })
const third = await rpc({ p_key: key, p_window_seconds: 60, p_max: 2, p_secret: secret })
ok("עם הסוד של השרת: הפעם השלישית מעל 2 נחסמת", third.ok && (await third.json()) === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
