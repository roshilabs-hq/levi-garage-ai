// בודק את "החיבור ההפוך" של עמדה (032) מול המסד האמיתי.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/station-request.mjs
//
// למה זה קיים: כל אחד באינטרנט יכול לפתוח את מסך העמדה וללחוץ "לבקש מדניאל לחבר".
// זה בטוח רק אם: רק מנהל מאשר (ובוחר ליפט), הסוד של הבקשה לא נשמר במסד כמו שהוא,
// אף אחד לא קורא את הטבלה ישירות, הטוקן של העמדה יוצא פעם אחת, בקשה פגה תוך
// רבע שעה, ואי אפשר להציף את הלוח של דניאל. ומי שבכל זאת קיבל עמדה — עדיין צריך
// שם וקוד של מכונאי.
//
// כל מה שנוצר כאן נמחק בסוף.

import { createHash, createHmac } from "node:crypto"

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
// 044: ארבע הפונקציות של החיבור ההפוך דורשות מפתח שרק השרת יודע. הבדיקה מוסיפה
// אותו כמו שהשרת מוסיף (lib/staff/station.ts, stationRpcKey).
const GATED = new Set(["request_station", "station_request_status", "station_request_approvers", "approve_station_request_with_pin"])
const STATION_KEY = createHmac("sha256", process.env.STATION_SECRET ?? "").update("station-rpc").digest("hex")
const rawRpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
const rpc = (fn, body, token) => rawRpc(fn, GATED.has(fn) ? { ...body, p_key: STATION_KEY } : body, token)
const rpcJson = async (fn, body, token) => (await rpc(fn, body, token)).json()

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

// כל בקשה שהבדיקה פותחת נרשמת כאן, ונמצאת במסד לפי ה-hash של הסוד.
const made = []
const hashOf = (secret) => createHash("sha256").update(secret).digest("hex")
const ask = async () => {
  const r = await rpcJson("request_station", {})
  if (r?.secret) made.push(r.secret)
  return r
}
const idOf = async (secret) => (await (await admin(`/rest/v1/station_requests?secret_hash=eq.${hashOf(secret)}&select=id`)).json())[0]?.id
const shift = (secret, patch) =>
  admin(`/rest/v1/station_requests?secret_hash=eq.${hashOf(secret)}`, { method: "PATCH", body: JSON.stringify(patch) })

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")

try {
  // 044: בלי המפתח של השרת, אף אחד מבחוץ לא פותח בקשה ולא מנחש קוד.
  ok("בלי מפתח השרת: אי אפשר לפתוח בקשה", !(await rawRpc("request_station", {})).ok && !(await rawRpc("request_station", { p_key: "x".repeat(64) })).ok)
  ok("בלי מפתח השרת: אי אפשר לנחש קוד", !(await rawRpc("approve_station_request_with_pin", { p_secret: "x", p_staff_id: "00000000-0000-0000-0000-000000000000", p_pin: "123456", p_lift: 1 })).ok)
  // --- הטאבלט מבקש
  const req = await ask()
  ok("אורח (טאבלט בלי משתמש) מבקש, ומקבל סוד ומספר", req?.ok === true && /^[0-9a-f]{32}$/.test(req?.secret ?? "") && /^\d{4}$/.test(req?.code ?? ""), JSON.stringify(req))
  const st = await rpcJson("station_request_status", { p_secret: req.secret })
  ok("הטאבלט רואה: ממתין, עם אותו מספר", st?.status === "pending" && st?.code === req.code)

  // --- מי רואה ומי מאשר
  const anonList = await rpc("open_station_requests", {})
  ok("אורח לא רואה את רשימת הבקשות", !anonList.ok, `status ${anonList.status}`)
  const mechList = await rpcJson("open_station_requests", {}, mechanic)
  ok("מכונאי מקבל רשימה ריקה", Array.isArray(mechList) && mechList.length === 0)
  const list = await rpcJson("open_station_requests", {}, manager)
  const mine = (list ?? []).find((r) => r.code === req.code)
  ok("דניאל רואה את הבקשה עם המספר שעל הטאבלט", Boolean(mine), JSON.stringify(list))
  ok("ברשימה של דניאל אין סוד ואין hash", mine && !("secret_hash" in mine) && !("secret" in mine))

  const read = await call(`/rest/v1/station_requests?select=*`, { token: manager })
  const rows = read.ok ? await read.json() : []
  ok("אף אחד לא קורא את הטבלה ישירות, גם לא מנהל", !read.ok || rows.length === 0, `status ${read.status}`)

  const anonApprove = await rpc("approve_station_request", { p_id: mine?.id, p_lift: 3 })
  ok("אורח לא מאשר", !anonApprove.ok, `status ${anonApprove.status}`)
  const mechApprove = await rpc("approve_station_request", { p_id: mine?.id, p_lift: 3 }, mechanic)
  ok("מכונאי לא מאשר", !mechApprove.ok, `status ${mechApprove.status}`)
  const badLift = await rpc("approve_station_request", { p_id: mine?.id, p_lift: 7 }, manager)
  ok("ליפט 7 לא קיים", !badLift.ok)
  ok("אחרי הניסיונות האלה הבקשה עדיין ממתינה", (await rpcJson("station_request_status", { p_secret: req.secret }))?.status === "pending")

  // --- דניאל מאשר, הטאבלט מתחבר
  const approve = await rpcJson("approve_station_request", { p_id: mine.id, p_lift: 3 }, manager)
  ok("דניאל מאשר: ליפט 3", approve === "ok", JSON.stringify(approve))
  const twice = await rpcJson("approve_station_request", { p_id: mine.id, p_lift: 1 }, manager)
  ok("אישור שני לאותה בקשה: כבר לא קיימת", twice === "gone")
  ok("בקשה שאושרה יוצאת מהרשימה של דניאל", !((await rpcJson("open_station_requests", {}, manager)) ?? []).some((r) => r.id === mine.id))

  const got = await rpcJson("station_request_status", { p_secret: req.secret })
  ok("הטאבלט מקבל טוקן של עמדה, ליפט 3", got?.status === "approved" && /^[0-9a-f]{48}$/.test(got?.token ?? "") && got?.label === "ליפט 3", JSON.stringify({ ...got, token: got?.token ? "…" : null }))
  const station = await rpcJson("station_info", { p_token: got.token })
  ok("העמדה החדשה עובדת: ליפט 3, עם רשימת המכונאים", station?.lift === 3 && (station?.mechanics ?? []).length >= 4)
  const again = await rpcJson("station_request_status", { p_secret: req.secret })
  ok("הטוקן יוצא פעם אחת בלבד", again?.status === "used" && !again?.token)

  // --- קלט זבל
  ok("סוד שלא קיים: נדחה", (await rpcJson("station_request_status", { p_secret: "0".repeat(32) }))?.status === "bad")
  ok("קלט זבל: נדחה לפני שמגיע לחיפוש", (await rpcJson("station_request_status", { p_secret: "' or 1=1 --" }))?.status === "bad")

  // --- תוקף: "עברו 16 דקות"
  const old = await ask()
  await shift(old.secret, { expires_at: new Date(Date.now() - 60 * 1000).toISOString() })
  ok("בקשה בת רבע שעה: פגה", (await rpcJson("station_request_status", { p_secret: old.secret }))?.status === "expired")
  ok("ולא מופיעה אצל דניאל", !((await rpcJson("open_station_requests", {}, manager)) ?? []).some((r) => r.code === old.code))
  ok("ואי אפשר לאשר אותה", (await rpcJson("approve_station_request", { p_id: await idOf(old.secret), p_lift: 2 }, manager)) === "gone")

  // אושרה, אבל אף טאבלט לא אסף אותה רבע שעה: לא נותנים עמדה באיחור.
  const stale = await ask()
  await rpcJson("approve_station_request", { p_id: await idOf(stale.secret), p_lift: 2 }, manager)
  await shift(stale.secret, { approved_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
  const staleSt = await rpcJson("station_request_status", { p_secret: stale.secret })
  ok("אישור שלא נאסף רבע שעה: פג, בלי טוקן", staleSt?.status === "expired" && !staleSt?.token)

  // --- "לא לאשר" (034): הבקשה יורדת מהלוח מיד, והטאבלט יודע שנדחתה
  const nope = await ask()
  const nopeId = await idOf(nope.secret)
  ok("אורח לא דוחה", !(await rpc("decline_station_request", { p_id: nopeId })).ok)
  ok("מכונאי לא דוחה", !(await rpc("decline_station_request", { p_id: nopeId }, mechanic)).ok)
  ok("דניאל דוחה", (await rpcJson("decline_station_request", { p_id: nopeId }, manager)) === "ok")
  ok("בקשה שנדחתה יוצאת מהלוח מיד", !((await rpcJson("open_station_requests", {}, manager)) ?? []).some((r) => r.id === nopeId))
  ok("הטאבלט רואה: נדחתה", (await rpcJson("station_request_status", { p_secret: nope.secret }))?.status === "declined")
  ok("ואי אפשר לאשר אותה אחרי הדחייה", (await rpcJson("approve_station_request", { p_id: nopeId, p_lift: 2 }, manager)) === "gone")

  // --- דניאל מאשר על הטאבלט עצמו, בקוד שלו (033)
  const pin = process.env.STATION_DEMO_PIN
  const here = await ask()
  const approvers = await rpcJson("station_request_approvers", { p_secret: here.secret })
  const daniel = (approvers ?? []).find((a) => a.full_name?.startsWith("דניאל"))
  ok("טאבלט עם בקשה פתוחה רואה מי יכול לאשר: דניאל ואבי, בלי מכונאים", Boolean(daniel) && approvers.length === 2, JSON.stringify(approvers?.map((a) => a.full_name)))
  ok("ורק שמות, בלי שום פרט אחר", daniel && Object.keys(daniel).sort().join(",") === "full_name,id")
  ok("בלי בקשה פתוחה: אין רשימה", ((await rpcJson("station_request_approvers", { p_secret: "0".repeat(32) })) ?? []).length === 0)
  const wrong = await rpcJson("approve_station_request_with_pin", { p_secret: here.secret, p_staff_id: daniel?.id, p_pin: pin === "000000" ? "111111" : "000000", p_lift: 4 })
  ok("קוד שגוי: לא מאושר, ואומר כמה ניסיונות נשארו", wrong?.ok === false && wrong?.reason === "pin" && wrong?.left >= 1, JSON.stringify(wrong))
  ok("אחרי קוד שגוי הבקשה עדיין ממתינה", (await rpcJson("station_request_status", { p_secret: here.secret }))?.status === "pending")
  const mech = (await (await admin(`/rest/v1/staff?select=id&role=eq.mechanic&limit=1`)).json())[0]
  const asMech = await rpcJson("approve_station_request_with_pin", { p_secret: here.secret, p_staff_id: mech?.id, p_pin: pin, p_lift: 4 })
  ok("מכונאי לא מאשר עמדה גם עם הקוד שלו", asMech?.ok === false && asMech?.reason === "who")
  const good = await rpcJson("approve_station_request_with_pin", { p_secret: here.secret, p_staff_id: daniel?.id, p_pin: pin, p_lift: 4 })
  ok("דניאל עם הקוד שלו: מאושר, ליפט 4", good?.ok === true, JSON.stringify(good))
  const hereSt = await rpcJson("station_request_status", { p_secret: here.secret })
  ok("הטאבלט מקבל מיד טוקן של ליפט 4", hereSt?.status === "approved" && hereSt?.label === "ליפט 4" && /^[0-9a-f]{48}$/.test(hereSt?.token ?? ""))
  const stolen = await rpcJson("approve_station_request_with_pin", { p_secret: "f".repeat(32), p_staff_id: daniel?.id, p_pin: pin, p_lift: 1 })
  ok("קוד נכון בלי הסוד של הטאבלט: לא קורה כלום", stolen?.ok === false && stolen?.reason === "gone")

  // --- הצפה: לא יותר מ-10 בקשות פתוחות
  let busy = null
  for (let i = 0; i < 12 && !busy; i++) {
    const r = await ask()
    if (r?.ok === false) busy = r
  }
  ok("אחרי 10 בקשות פתוחות: 'עמוס', והלוח של דניאל לא מוצף", busy?.reason === "busy")
  const open = (await rpcJson("open_station_requests", {}, manager)) ?? []
  ok("אצל דניאל לכל היותר 10 בקשות", open.length <= 10, `${open.length}`)
} finally {
  const hashes = made.map(hashOf).join(",")
  const rows = made.length ? await (await admin(`/rest/v1/station_requests?secret_hash=in.(${hashes})&select=id,station_id`)).json() : []
  ok("הבדיקה מוצאת את כל הבקשות שפתחה", rows.length === made.length, `${rows.length}/${made.length}`)
  const stationIds = rows.map((r) => r.station_id).filter(Boolean)
  if (made.length) await admin(`/rest/v1/station_requests?secret_hash=in.(${hashes})`, { method: "DELETE" })
  for (const id of stationIds) await admin(`/rest/v1/stations?id=eq.${id}`, { method: "DELETE" })
  const left = made.length ? await (await admin(`/rest/v1/station_requests?secret_hash=in.(${hashes})&select=id`)).json() : []
  ok("נוקה: לא נשארו בקשות ועמדות של הבדיקה", left.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
