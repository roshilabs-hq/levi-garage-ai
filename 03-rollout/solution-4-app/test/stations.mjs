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
let noamId = null
let noamLiftBefore = null
let token2 = null
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

  const liftOfNoam = async () => (await (await call(`/rest/v1/staff?id=eq.${noam.id}&select=lift`, { token: manager })).json())[0]?.lift
  noamLiftBefore = await liftOfNoam()
  const good = await (await rpc("station_login", { p_token: token, p_staff_id: noam.id, p_pin: demoPin })).json()
  ok("קוד נכון מעמדה מצומדת: נכנס, לליפט של העמדה", good?.ok === true && good?.email === "test6@test.com" && good?.lift === 3, JSON.stringify(good))
  ok("הכניסה רושמת במסד שהוא עובד על הליפט של העמדה (054)", (await liftOfNoam()) === 3)
  noamId = noam.id
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
  // 060: הנעילה נרשמת ביומן האבטחה, ואבי ודניאל רואים אותה
  const alerts = await (await rpc("security_alerts", {}, manager)).json()
  ok("הנעילה נרשמה ביומן האבטחה (מנהל רואה)", Number(alerts?.day?.pin_locked) >= 1, JSON.stringify(alerts?.day))
  ok("מכונאי לא רואה את יומן האבטחה", !(await rpc("security_alerts", {}, mechanic)).ok)
  ok("אורח לא רואה את יומן האבטחה", !(await rpc("security_alerts", {})).ok)
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

  // --- 057 (ביקורת שלישית, 8.10, ממצאים 1 ו-2): הליפט שייך לכניסה, וביטול עמדה מנתק ---
  // כמו stationLogin באפליקציה: קוד בעמדה, כניסה בשם המכונאי, ורישום הכניסה עם הטוקן של העמדה.
  const atStation = async (stationToken) => {
    const r = await (await rpc("station_login", { p_token: stationToken, p_staff_id: noam.id, p_pin: demoPin })).json()
    if (!r?.ok) return null
    const session = await signIn("test6@test.com")
    const bound = await rpc("bind_station_session", { p_token: stationToken }, session)
    return bound.ok ? { session, lift: await bound.json() } : null
  }
  const json = async (res) => (res.ok ? res.json() : null)
  const first = await atStation(token)
  ok("כניסה בעמדה של ליפט 3: הכניסה רשומה על ליפט 3", first?.lift === 3 && (await json(await rpc("my_lift", {}, first.session))) === 3)

  const created2 = await rpc("create_station", { p_label: "ליפט 2 (בדיקה אוטומטית)", p_lift: 2 }, manager)
  token2 = created2.ok ? await created2.json() : null
  const second = token2 ? await atStation(token2) : null
  // 068 (ביקורת שישית, ממצא 2): כניסה נרשמת פעם אחת. אי אפשר לחדש אותה (להאריך את 12 השעות) או להעביר לעמדה אחרת.
  const before = (await (await call(`/rest/v1/rpc/my_station_session`, { method: "POST", body: "{}", token: first?.session })).json())
  ok("רישום חוזר של אותה כניסה לאותה עמדה לא נכשל", (await rpc("bind_station_session", { p_token: token }, first?.session)).ok)
  ok("אבל גם לא מעביר אותה לעמדה אחרת", !(await rpc("bind_station_session", { p_token: token2 }, first?.session)).ok)
  ok("הכניסה נשארת על הליפט שלה", (await (await rpc("my_lift", {}, first?.session)).json()) === 3 && before?.bound === true)
  ok("אותו מכונאי נכנס בעמדה של ליפט 2", second?.lift === 2 && (await json(await rpc("my_lift", {}, second.session))) === 2)
  ok("והכניסה הפתוחה בליפט 3 נשארת על ליפט 3", (await json(await rpc("my_lift", {}, first?.session))) === 3)

  ok("בלי עמדה תקפה אין רישום", !(await rpc("bind_station_session", { p_token: "c".repeat(48) }, second?.session)).ok)
  ok("מנהל לא נרשם כעמדה", !(await rpc("bind_station_session", { p_token: token2 }, manager)).ok)
  ok("אורח לא נרשם כעמדה", !(await rpc("bind_station_session", { p_token: token2 })).ok)

  // ביטול העמדה של ליפט 3, כשהמכונאי עוד מחובר בה
  await call(`/rest/v1/stations?id=eq.${stationId}`, { method: "PATCH", token: manager, body: JSON.stringify({ revoked_at: new Date().toISOString() }) })
  // 064: כל בקשה מכניסה שהעמדה שלה בוטלה נדחית (401), לפני שהיא מגיעה לטבלה או לפונקציה
  const r1 = await rpc("my_role", {}, first?.session)
  ok("אחרי ביטול העמדה: כל בקשה מהכניסה בה נדחית (401)", r1.status === 401, `status ${r1.status}`)
  const cards1 = await call(`/rest/v1/price_list?select=id&limit=1`, { token: first?.session })
  ok("גם קריאה של המחירון", cards1.status === 401, `status ${cards1.status}`)
  const wall1 = await rpc("wall_board", {}, first?.session)
  ok("וגם מסך הסדנה (wall_board)", wall1.status === 401, `status ${wall1.status}`)
  ok("הכניסה בעמדה האחרת ממשיכה לעבוד", (await json(await rpc("my_role", {}, second?.session))) === "mechanic")
  const cards2 = await json(await call(`/rest/v1/price_list?select=id&limit=1`, { token: second?.session }))
  ok("וקוראת כרגיל", Array.isArray(cards2) && cards2.length === 1)
  ok("כניסה בסיסמה, בלי עמדה, לא מושפעת", (await json(await rpc("my_role", {}, mechanic))) === "mechanic")

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
  // העמדה השנייה (057): מבטלים ומוחקים (רישומי הכניסה נמחקים איתה)
  const key = process.env.SUPABASE_SECRET_KEY
  if (token2 && key) {
    const h = { apikey: key, authorization: `Bearer ${key}` }
    const rows2 = await (await fetch(`${url}/rest/v1/stations?label=eq.${encodeURIComponent("ליפט 2 (בדיקה אוטומטית)")}&select=id`, { headers: h })).json()
    for (const r of Array.isArray(rows2) ? rows2 : []) await fetch(`${url}/rest/v1/stations?id=eq.${r.id}`, { method: "DELETE", headers: h })
  }
  // הכניסה העבירה את נועם לליפט 3 (054). מחזירים אותו לאן שהיה.
  if (noamId && key) {
    await fetch(`${url}/rest/v1/staff?id=eq.${noamId}`, {
      method: "PATCH",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ lift: noamLiftBefore ?? null }),
    })
  }
}

console.log(`\n${pass} עברו, ${fail} נכשלו`)
process.exit(fail ? 1 : 0)
