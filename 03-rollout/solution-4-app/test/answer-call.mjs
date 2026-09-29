// בודק את "הגעתי" על מסך העמדה (026) מול המסד האמיתי.
//
// הרצה: node --env-file=levi-garage/.env.local 03-rollout/solution-4-app/test/answer-call.mjs
//
// למה זה קיים: הכפתור נמצא על המכשיר של המכונאי. אם המכונאי יכול לסגור את הקריאה
// בלי הקוד של דניאל, לוח היום מראה שדניאל הגיע כשהוא לא הגיע. לכן: רק עם קוד של
// מנהל או בעלים, קוד שגוי נספר וננעל אחרי 5, ומי שנרשם כמי שהגיע הוא בעל הקוד.
//
// הבדיקה יוצרת לעצמה מנהל ומכונאי זמניים, ומוחקת הכול בסוף.

import { randomBytes } from "node:crypto"

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
const rpc = async (fn, body, token) => {
  const res = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const password = randomBytes(18).toString("base64url")
const people = {
  mgr: { email: "answer-test-mgr@test.local", full_name: "בדיקה: מנהל", role: "manager" },
  mech: { email: "answer-test-mech@test.local", full_name: "בדיקה: מכונאי", role: "mechanic" },
}

async function makeUser(p) {
  const res = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: p.email, password, email_confirm: true }),
  })
  const u = await res.json()
  if (!u.id) throw new Error(`create ${p.email}: ${res.status}`)
  p.id = u.id
  const s = await admin("/rest/v1/staff", {
    method: "POST",
    body: JSON.stringify({ id: u.id, full_name: p.full_name, role: p.role, lift: null, lang: "he", active: true }),
  })
  if (!s.ok) throw new Error(`staff ${p.email}: ${s.status}`)
  const t = await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: p.email, password }) })
  p.token = (await t.json()).access_token
}

const PIN = "482915"
let callId = null

try {
  await makeUser(people.mgr)
  await makeUser(people.mech)
  const { mgr, mech } = people

  // קוד למנהל: המנהל קובע לעצמו. מכונאי לא יכול לקבוע קוד לאף אחד.
  const byMech = await rpc("set_staff_pin", { p_staff_id: mgr.id, p_pin: "111111" }, mech.token)
  ok("מכונאי לא קובע קוד", byMech.status >= 400)
  const set = await rpc("set_staff_pin", { p_staff_id: mgr.id, p_pin: PIN }, mgr.token)
  ok("מנהל קובע לעצמו קוד", set.status < 300, JSON.stringify(set.body))

  // הרשימה במסך העמדות כוללת גם את המנהל, עם התפקיד.
  const status = await rpc("staff_pin_status", {}, mgr.token)
  const row = (status.body ?? []).find((r) => r.id === mgr.id)
  ok("מסך העמדות: המנהל ברשימת הקודים", row?.has_pin === true && row?.role === "manager")

  // המכונאי רואה מי יכול לאשר, בשמות בלבד.
  const who = await rpc("call_answerers", {}, mech.token)
  const me = (who.body ?? []).find((r) => r.id === mgr.id)
  ok("העמדה רואה את המנהל כמי שיכול לאשר", Boolean(me))
  ok("…רק שם ומזהה", me && Object.keys(me).sort().join(",") === "full_name,id")
  const anon = await rpc("call_answerers", {})
  ok("בלי התחברות: אין רשימה", anon.status >= 400 || (Array.isArray(anon.body) && anon.body.length === 0))

  // המכונאי קורא לדניאל.
  const ins = await admin("/rest/v1/help_calls", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ requested_by: mech.id, kind: "help", lift: 1 }),
  })
  callId = (await ins.json())[0]?.id
  ok("נפתחה קריאה", Boolean(callId))

  // בלי הקוד הנכון, הקריאה לא נסגרת.
  const wrong = await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mgr.id, p_pin: "000000" }, mech.token)
  ok("קוד שגוי: לא נסגר", wrong.body?.ok === false && wrong.body?.reason === "pin", JSON.stringify(wrong.body))
  ok("…ומספר הניסיונות יורד", wrong.body?.left === 4)
  const asMech = await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mech.id, p_pin: PIN }, mech.token)
  ok("מכונאי לא יכול לאשר בשם עצמו", asMech.body?.ok === false && asMech.body?.reason === "who")
  const noLogin = await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mgr.id, p_pin: PIN })
  ok("בלי התחברות: לא נסגר", noLogin.status >= 400 || noLogin.body?.ok === false)

  let open = await (await admin(`/rest/v1/help_calls?id=eq.${callId}&select=resolved_at,resolved_by`)).json()
  ok("הקריאה עדיין פתוחה", open[0]?.resolved_at === null)

  // הקוד הנכון: נסגר, ונרשם שהמנהל הגיע.
  const right = await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mgr.id, p_pin: PIN }, mech.token)
  ok("קוד נכון: נסגר", right.body?.ok === true, JSON.stringify(right.body))
  open = await (await admin(`/rest/v1/help_calls?id=eq.${callId}&select=resolved_at,resolved_by`)).json()
  ok("…ונרשם שהמנהל הגיע, לא המכונאי", open[0]?.resolved_at !== null && open[0]?.resolved_by === mgr.id)

  // נעילה: 5 טעויות ברצף, ואז גם הקוד הנכון לא עובד.
  for (let i = 0; i < 5; i++) await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mgr.id, p_pin: "000000" }, mech.token)
  const locked = await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mgr.id, p_pin: PIN }, mech.token)
  ok("אחרי 5 טעויות: נעול, גם עם הקוד הנכון", locked.body?.reason === "locked", JSON.stringify(locked.body))
  // קביעה מחדש משחררת.
  await rpc("set_staff_pin", { p_staff_id: mgr.id, p_pin: PIN }, mgr.token)
  const again = await rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: mgr.id, p_pin: PIN }, mech.token)
  ok("קוד חדש משחרר את הנעילה", again.body?.ok === true)

  // קוד של מנהל לא פותח כניסה לעמדה: הכניסה בעמדה היא רק למכונאים.
  const login = await rpc("station_login", { p_token: "0".repeat(48), p_staff_id: mgr.id, p_pin: PIN })
  ok("קוד של מנהל לא מכניס לעמדה", login.body?.ok !== true)
} finally {
  if (callId) await admin(`/rest/v1/help_calls?id=eq.${callId}`, { method: "DELETE" })
  for (const p of Object.values(people)) {
    if (!p.id) continue
    await admin(`/rest/v1/staff?id=eq.${p.id}`, { method: "DELETE" })
    await admin(`/auth/v1/admin/users/${p.id}`, { method: "DELETE" })
  }
  console.log(`\n${pass} עברו, ${fail} נכשלו`)
  process.exitCode = fail ? 1 : 0
}
