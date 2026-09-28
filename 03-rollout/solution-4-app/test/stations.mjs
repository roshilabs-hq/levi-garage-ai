// בודק את העמדות הקבועות (016, 017) מול המסד האמיתי: צימוד, שם וקוד, נעילה,
// ומה שאסור לכל אחד לעשות.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/stations.mjs
//
// למה זה קיים: קוד של 6 ספרות הוא מיליון אפשרויות. הוא בטוח רק אם שלושה דברים
// מחזיקים יחד: הוא עובד רק ממכשיר מצומד, 5 טעויות נועלות, וה-hash שלו לא יוצא
// מהמסד. אם אחד מהם נשבר, זו הבדיקה שתיפול — לא מכונאי שמישהו נכנס בשמו.
//
// העמדה שנוצרת כאן מבוטלת בסוף, והקוד של נועם חוזר לקוד ההדגמה.

import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const demoPin = process.env.STATION_DEMO_PIN
if (!demoPin) throw new Error("חסר STATION_DEMO_PIN. להריץ עם --env-file=levi-garage/.env.staff.local")
const wrongPin = demoPin === "000000" ? "111111" : "000000"

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

const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })

async function signIn(email, password = passwordFor(email)) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password }) })
  if (!res.ok) return null
  return (await res.json()).access_token
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
if (!manager || !mechanic) throw new Error("הכניסה של משתמשי הבדיקה נכשלה")

// --- צימוד ---
const anonCreate = await rpc("create_station", { p_label: "בדיקה", p_lift: 3 })
ok("אורח לא יכול לצמד עמדה", !anonCreate.ok, `status ${anonCreate.status}`)
const mechCreate = await rpc("create_station", { p_label: "בדיקה", p_lift: 3 }, mechanic)
ok("מכונאי לא יכול לצמד עמדה", !mechCreate.ok, `status ${mechCreate.status}`)
const badLift = await rpc("create_station", { p_label: "בדיקה", p_lift: 9 }, manager)
ok("ליפט 9 לא קיים", !badLift.ok, `status ${badLift.status}`)

const created = await rpc("create_station", { p_label: "ליפט 3 (בדיקה אוטומטית)", p_lift: 3 }, manager)
const token = created.ok ? await created.json() : null
ok("מנהל מצמד עמדה ומקבל טוקן של 48 תווים", typeof token === "string" && /^[0-9a-f]{48}$/.test(token), `status ${created.status}`)
if (!token) process.exit(1)

let stationId = null
try {
  // --- מה המכשיר רואה ---
  const info = await (await rpc("station_info", { p_token: token })).json()
  ok("העמדה מציגה את השם ואת הליפט", info?.label === "ליפט 3 (בדיקה אוטומטית)" && info?.lift === 3)
  const names = (info?.mechanics ?? []).map((m) => m.name)
  ok("ברשימת השמות רק מכונאים", names.length === 4 && !names.includes("דניאל לוי") && !names.includes("אבי לוי"), names.join(", "))
  ok("ברשימת השמות אין hash ואין מייל", !JSON.stringify(info).includes("pin_hash") && !JSON.stringify(info).includes("@"))
  const noam = (info?.mechanics ?? []).find((m) => m.name === "נועם")
  if (!noam) throw new Error("נועם לא ברשימה")

  const fake = await (await rpc("station_info", { p_token: "a".repeat(48) })).json()
  ok("טוקן שלא קיים לא מחזיר כלום", fake === null)

  const { data: rows } = { data: await (await call(`/rest/v1/stations?select=id,token_hash&label=eq.${encodeURIComponent("ליפט 3 (בדיקה אוטומטית)")}&revoked_at=is.null`, { token: manager })).json() }
  stationId = rows?.[0]?.id ?? null
  ok("במסד נשמר רק ה-hash, לא הטוקן", rows?.[0]?.token_hash && rows[0].token_hash !== token)

  // --- כניסה ---
  const noStation = await (await rpc("station_login", { p_token: "b".repeat(48), p_staff_id: noam.id, p_pin: demoPin })).json()
  ok("קוד נכון ממכשיר לא מצומד: נדחה", noStation?.ok === false && noStation?.reason === "station")

  const good = await (await rpc("station_login", { p_token: token, p_staff_id: noam.id, p_pin: demoPin })).json()
  ok("קוד נכון מעמדה מצומדת: נכנס, לליפט של העמדה", good?.ok === true && good?.email === "test6@test.com" && good?.lift === 3, JSON.stringify(good))
  ok("הכניסה מחזירה מייל בלבד, לא סשן", good && !("access_token" in good) && !("password" in good))

  const notMech = await (await rpc("station_login", { p_token: token, p_staff_id: "00000000-0000-0000-0000-000000000000", p_pin: demoPin })).json()
  ok("מזהה שאינו מכונאי: נדחה", notMech?.ok === false && notMech?.reason === "who")

  // --- נעילה ---
  const lefts = []
  for (let i = 0; i < 4; i++) {
    const r = await (await rpc("station_login", { p_token: token, p_staff_id: noam.id, p_pin: wrongPin })).json()
    lefts.push(`${r?.reason}:${r?.left}`)
  }
  ok("4 טעויות: 'נשארו' יורד מ-4 ל-1", lefts.join(",") === "pin:4,pin:3,pin:2,pin:1", lefts.join(","))
  const fifth = await (await rpc("station_login", { p_token: token, p_staff_id: noam.id, p_pin: wrongPin })).json()
  ok("טעות חמישית: נעול", fifth?.reason === "locked", JSON.stringify(fifth))
  const afterLock = await (await rpc("station_login", { p_token: token, p_staff_id: noam.id, p_pin: demoPin })).json()
  ok("בזמן נעילה גם הקוד הנכון לא נכנס", afterLock?.ok === false && afterLock?.reason === "locked")

  const status = await (await rpc("staff_pin_status", {}, manager)).json()
  ok("דניאל רואה שנועם נעול", Boolean(status?.find?.((s) => s.id === noam.id)?.locked_until))

  const reset = await rpc("set_staff_pin", { p_staff_id: noam.id, p_pin: demoPin }, manager)
  ok("דניאל קובע קוד מחדש", reset.ok, `status ${reset.status}`)
  const afterReset = await (await rpc("station_login", { p_token: token, p_staff_id: noam.id, p_pin: demoPin })).json()
  ok("קביעה מחדש משחררת את הנעילה", afterReset?.ok === true)

  // --- מה שאסור ---
  const mechPin = await rpc("set_staff_pin", { p_staff_id: noam.id, p_pin: "123456" }, mechanic)
  ok("מכונאי לא קובע קוד לאחר", !mechPin.ok, `status ${mechPin.status}`)
  const mechStatus = await rpc("staff_pin_status", {}, mechanic)
  ok("מכונאי לא רואה מצב קודים", !mechStatus.ok, `status ${mechStatus.status}`)
  const shortPin = await rpc("set_staff_pin", { p_staff_id: noam.id, p_pin: "123" }, manager)
  ok("קוד של 3 ספרות נדחה", !shortPin.ok)

  const hashMech = await call(`/rest/v1/staff?select=pin_hash`, { token: mechanic })
  ok("מכונאי לא קורא pin_hash", !hashMech.ok, `status ${hashMech.status}`)
  const hashMgr = await call(`/rest/v1/staff?select=pin_hash`, { token: manager })
  ok("גם מנהל לא קורא pin_hash", !hashMgr.ok, `status ${hashMgr.status}`)
  const plain = await call(`/rest/v1/staff?select=id,full_name,role`, { token: mechanic })
  ok("העמודות הרגילות של staff עדיין נקראות", plain.ok, `status ${plain.status}`)
  const mechStations = await (await call(`/rest/v1/stations?select=id`, { token: mechanic })).json()
  ok("מכונאי לא רואה את רשימת העמדות", Array.isArray(mechStations) && mechStations.length === 0)

  const demoForMech = await signIn("test5@test.com", process.env.STAFF_DEMO_PASSWORD)
  ok("מכונאי לא נכנס בסיסמת ההדגמה", demoForMech === null)

  if (stationId) {
    const swap = await call(`/rest/v1/stations?id=eq.${stationId}`, {
      method: "PATCH",
      token: manager,
      body: JSON.stringify({ token_hash: "0".repeat(64) }),
    })
    ok("מנהל לא משנה hash של עמדה (017)", !swap.ok, `status ${swap.status}`)
  }
} finally {
  // ביטול העמדה: גם בדיקה של "ביטול" וגם ניקוי.
  if (stationId) {
    const revoke = await call(`/rest/v1/stations?id=eq.${stationId}`, {
      method: "PATCH",
      token: manager,
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    })
    ok("מנהל מבטל עמדה", revoke.ok, `status ${revoke.status}`)
    const dead = await (await rpc("station_info", { p_token: token })).json()
    ok("עמדה שבוטלה לא מחזירה כלום", dead === null)
    // ביטול משאיר שורה (זה מה שקורה במוסך: רואים שהייתה עמדה). בבדיקה מוחקים.
    const key = process.env.SUPABASE_SECRET_KEY
    if (key) await fetch(`${url}/rest/v1/stations?id=eq.${stationId}`, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } })
  }
}

console.log(`\n${pass} עברו, ${fail} נכשלו`)
process.exit(fail ? 1 : 0)
