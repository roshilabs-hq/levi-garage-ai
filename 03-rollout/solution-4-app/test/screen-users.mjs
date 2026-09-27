// בודק שמשתמש של מסך תלוי באמת נעול, מול מסד הנתונים האמיתי ועם ההרשאות
// האמיתיות — לא מול מה שהדף מצייר.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/screen-users.mjs
//
// למה זה קיים: המסך בחדר ההמתנה נשאר מחובר כל היום בחדר ציבורי. אם הזהות
// שעליו יכולה לקרוא את job_cards, אז מספיק מישהו עם כלי פיתוח באותו מסך
// כדי להוציא שמות, טלפונים ומחירים — גם אם המסך עצמו מראה שלוש ספרות.
// הבדיקה הזאת היא ההבדל בין "המסך לא מציג" לבין "אי אפשר להוציא".

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const password = process.env.STAFF_DEMO_PASSWORD
if (!password) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")

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

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

const rows = async (token, path) => {
  const res = await call(path, { token })
  return res.ok ? await res.json() : []
}

const lobby = await signIn("screen1@test.com")
const wall = await signIn("screen2@test.com")
const daniel = await signIn("test1@test.com")

// ---------- 1. מסך חדר ההמתנה לא רואה שום טבלת עבודה ----------
for (const table of ["job_cards", "bookings", "findings", "approvals", "media"]) {
  const got = await rows(lobby, `/rest/v1/${table}?select=*`)
  ok(`מסך חדר ההמתנה לא קורא ${table}`, got.length === 0, `קיבל ${got.length} שורות`)
}

const staffRows = await rows(lobby, `/rest/v1/staff?select=id,full_name,role`)
ok("מסך חדר ההמתנה רואה רק את השורה של עצמו בטבלת הצוות", staffRows.length === 1, `קיבל ${staffRows.length}`)

// ---------- 2. אבל הוא כן מקבל את מה שהוא צריך, וזה ממוסך ----------
const view = await (await call(`/rest/v1/rpc/lobby_view`, { token: lobby, method: "POST", body: "{}" })).json()
ok("מסך חדר ההמתנה מקבל את הרשימה שלו", Array.isArray(view))
const fields = new Set(view.flatMap((r) => Object.keys(r)))
ok(
  "ובה שלושה שדות בלבד: ספרות, דגם, מצב",
  [...fields].every((f) => ["plate_last3", "vehicle", "state"].includes(f)),
  [...fields].join(", "),
)
ok("אין בה מספר רישוי מלא", view.every((r) => String(r.plate_last3).length === 3))
ok("ואין מצב שמסגיר שממתינים לאישור הלקוח", view.every((r) => r.state === "working" || r.state === "ready"))

// ---------- 3. מסך הסדנה תלוי באזור העבודה, ולכן הוא כן קורא ----------
const wallCards = await rows(wall, `/rest/v1/job_cards?select=id`)
ok("מסך הסדנה כן קורא את הכרטיסים", wallCards.length > 0)
const wallLobby = await (await call(`/rest/v1/rpc/lobby_view`, { token: wall, method: "POST", body: "{}" })).json()
ok("אבל הוא לא מקבל את הרשימה של חדר ההמתנה", Array.isArray(wallLobby) && wallLobby.length === 0)

// ---------- 4. מסך לא כותב כלום ----------
// הבדיקה בודקת "לפני ואחרי" על רכב חי, ולא מחפשת ערך קבוע: אם הכתיבה
// תיחסם כמו שצריך, הבדיקה לא משאירה שום שינוי אחריה. בגרסה הראשונה היא
// כן שינתה רכב, כי היא בדקה מול ערך קבוע ולא מול המצב הקודם.
const victim = (await rows(daniel, `/rest/v1/job_cards?status=neq.delivered&select=id,status&limit=1`))[0]
const before = victim?.status
const write = await call(`/rest/v1/job_cards?id=eq.${victim?.id ?? 0}`, {
  token: wall,
  method: "PATCH",
  body: JSON.stringify({ status: "delivered" }),
})
const after = (await rows(daniel, `/rest/v1/job_cards?id=eq.${victim?.id ?? 0}&select=status`))[0]?.status
ok("מסך הסדנה לא מצליח לשנות מצב של רכב", Boolean(before) && after === before, `${before} → ${after} (HTTP ${write.status})`)

const insert = await call(`/rest/v1/job_cards`, {
  token: wall,
  method: "POST",
  body: JSON.stringify({ plate: "0000000", status: "in_progress" }),
})
ok("ולא מצליח לפתוח כרטיס חדש", insert.status >= 400, `HTTP ${insert.status}`)

// ---------- 5. אורח (בלי התחברות) לא מגיע לפונקציות של הצוות ----------
// עד 27.9 הן היו פתוחות לאורח: ה-revoke מ-public לא מבטל את ההרשאה הישירה
// ש-Supabase נותן ל-anon (ראו sql/012). הן החזיקו רק בזכות בדיקה פנימית.
// כאן בודקים את השכבה החיצונית: ההרשאה עצמה, לא מה שהפונקציה עושה.
for (const [fn, body] of [
  ["lobby_view", {}],
  ["send_finding", { p_finding_id: 0, p_message: "x", p_channel: "link" }],
  ["set_my_lift", { p_lift: 1 }],
]) {
  const res = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) })
  const text = await res.text()
  ok(`אורח לא מורשה להריץ את ${fn}`, res.status >= 400 && /permission denied/i.test(text), `HTTP ${res.status} ${text.slice(0, 120)}`)
}

// ---------- 6. דניאל לא נפגע מכל זה ----------
const danielCards = await rows(daniel, `/rest/v1/job_cards?select=id,customer_name`)
ok("מנהל העבודה ממשיך לראות את הכרטיסים במלואם", danielCards.length > 0 && "customer_name" in (danielCards[0] ?? {}))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
