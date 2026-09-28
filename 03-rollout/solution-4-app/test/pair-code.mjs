// בודק את הצימוד בקוד QR (022) מול המסד האמיתי.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/pair-code.mjs
//
// למה זה קיים: קוד QR על מסך הוא משהו שכל מי שעומד ליד יכול לצלם. הוא בטוח רק
// אם הוא נוצר רק בידי מנהל, עובד פעם אחת, פג אחרי 10 דקות, ולא נשמר במסד כמו
// שהוא. ואם מישהו כן מימש אותו, הוא קיבל עמדה — עדיין בלי שם וקוד של מכונאי.
//
// כל מה שנוצר כאן נמחק בסוף.

import { createHash } from "node:crypto"

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
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

// כל קוד שהבדיקה יוצרת נרשם כאן, ונמצא במסד לפי ה-hash שלו — לא לפי שעה,
// כי השעון של המחשב והשעון של המסד לא זהים.
const made = []
const hashOf = (code) => createHash("sha256").update(code).digest("hex")
const mint = async (lift, token) => {
  const res = await rpc("create_pair_code", { p_lift: lift }, token)
  const code = res.ok ? await res.json() : null
  if (typeof code === "string") made.push(code)
  return code
}
const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")

try {
  const anonCode = await rpc("create_pair_code", { p_lift: 2 })
  ok("אורח לא יוצר קוד", !anonCode.ok, `status ${anonCode.status}`)
  const mechCode = await rpc("create_pair_code", { p_lift: 2 }, mechanic)
  ok("מכונאי לא יוצר קוד", !mechCode.ok, `status ${mechCode.status}`)
  const badLift = await rpc("create_pair_code", { p_lift: 7 }, manager)
  ok("ליפט 7 לא קיים", !badLift.ok)

  const code = await mint(2, manager)
  ok("מנהל יוצר קוד של 32 תווים", typeof code === "string" && /^[0-9a-f]{32}$/.test(code), JSON.stringify(code))

  const info = await (await rpc("pair_code_info", { p_code: code })).json()
  ok("הטלפון רואה לאיזו עמדה הקוד, בלי לממש אותו", info?.ok === true && info?.label === "ליפט 2")
  const stillInfo = await (await rpc("pair_code_info", { p_code: code })).json()
  ok("הצצה לא שורפת את הקוד", stillInfo?.ok === true)

  const read = await call(`/rest/v1/station_pair_codes?select=*`, { token: manager })
  const readRows = read.ok ? await read.json() : []
  ok("אף אחד לא קורא את טבלת הקודים, גם לא מנהל", !read.ok || readRows.length === 0, `status ${read.status}`)

  const redeem = await (await rpc("redeem_pair_code", { p_code: code })).json()
  ok("הטלפון (בלי משתמש) מממש ומקבל טוקן של עמדה", redeem?.ok === true && /^[0-9a-f]{48}$/.test(redeem?.token ?? "") && redeem?.label === "ליפט 2")

  const station = await (await rpc("station_info", { p_token: redeem.token })).json()
  ok("העמדה החדשה עובדת: ליפט 2, עם רשימת המכונאים", station?.lift === 2 && (station?.mechanics ?? []).length >= 4)

  const again = await (await rpc("redeem_pair_code", { p_code: code })).json()
  ok("אותו קוד פעם שנייה: נדחה", again?.ok === false && again?.reason === "used")

  const garbage = await (await rpc("redeem_pair_code", { p_code: "0".repeat(32) })).json()
  ok("קוד שלא קיים: נדחה", garbage?.ok === false && garbage?.reason === "bad")
  const inject = await (await rpc("redeem_pair_code", { p_code: "' or 1=1 --" })).json()
  ok("קלט זבל: נדחה לפני שמגיע לחיפוש", inject?.ok === false && inject?.reason === "bad")

  const first = await mint(3, manager)
  const second = await mint(3, manager)
  const oldOne = await (await rpc("pair_code_info", { p_code: first })).json()
  ok("קוד חדש לאותו ליפט מבטל את הקודם", oldOne?.ok === false && oldOne?.reason === "expired")
  ok("והחדש תקף", (await (await rpc("pair_code_info", { p_code: second })).json())?.ok === true)

  // "עברו 11 דקות": מקדמים את השעון של הקוד במסד.
  await admin(`/rest/v1/station_pair_codes?code_hash=eq.${hashOf(second)}`, {
    method: "PATCH",
    body: JSON.stringify({ expires_at: new Date(Date.now() - 60 * 1000).toISOString() }),
  })
  const late = await (await rpc("redeem_pair_code", { p_code: second })).json()
  ok("אחרי 10 דקות הקוד פג", late?.ok === false && late?.reason === "expired")
} finally {
  const hashes = made.map(hashOf).join(",")
  const codes = made.length ? await (await admin(`/rest/v1/station_pair_codes?code_hash=in.(${hashes})&select=id,station_id`)).json() : []
  ok("הבדיקה מוצאת את כל הקודים שיצרה", codes.length === made.length, `${codes.length}/${made.length}`)
  const stationIds = codes.map((c) => c.station_id).filter(Boolean)
  if (made.length) await admin(`/rest/v1/station_pair_codes?code_hash=in.(${hashes})`, { method: "DELETE" })
  for (const id of stationIds) await admin(`/rest/v1/stations?id=eq.${id}`, { method: "DELETE" })
  const left = made.length ? await (await admin(`/rest/v1/station_pair_codes?code_hash=in.(${hashes})&select=id`)).json() : []
  ok("נוקה: לא נשארו קודים ועמדות של הבדיקה", left.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
