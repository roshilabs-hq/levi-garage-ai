// רכב אחד עובר את כל שרשרת המוסך, ובכל שלב בודקים מה רואים שלושה צדדים:
// המסך בחדר ההמתנה, המסך בסדנה, והלקוח ששואל את הבוט "מה המצב של הרכב שלי".
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/pipeline-screens.mjs
//
// למה זה קיים (27.9): רועי שאל "איך מוודאים שבכל שלב הרכב מופיע נכון במסכים".
// בדיקה ידנית דורשת שלושה חלונות ושלושה משתמשים, ומסך שמתרענן כל דקה. זו
// הבדיקה שמריצים לפני כל הדגמה במקום זה.
//
// המצבים משתנים כמו שדניאל משנה אותם: עם הזהות שלו ודרך אותן הרשאות (RLS).
// המסכים נקראים עם הזהויות של המסכים עצמם. שום הודעה לא יוצאת ללקוח: הבדיקה
// לא נוגעת בבוט, רק בשאילתה שהבוט שואל. הרכב נמחק בסוף, גם אם משהו נכשל.

import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const wiring = Object.fromEntries(
  readFileSync(resolve(here, "../../solution-3-agent/.env.wiring.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const BOT_TOKEN = wiring.GARAGE_BOT_TOKEN

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
const password = process.env.STAFF_DEMO_PASSWORD
if (!password) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")
if (!BOT_TOKEN) throw new Error("חסר GARAGE_BOT_TOKEN ב-solution-3-agent/.env.wiring.local")

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
const service = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) },
  })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

// מספר רישוי של בדיקה, עם שלוש ספרות אחרונות שלא קיימות בנתוני ההדגמה,
// כדי שבחדר ההמתנה (שמראה רק שלוש ספרות) לא יהיה ספק על איזה רכב מדובר.
const PLATE = "9999917"
const TAIL = PLATE.slice(-3)
const PHONE = "972500009920" // מספר בדוי
const clientId = `wa-${createHmac("sha256", BOT_TOKEN).update(PHONE).digest("hex").slice(0, 16)}`

// מה כל צד אמור לראות בכל שלב. זו אותה טבלה שהוסברה לרועי ב-27.9, ואותו
// קיבוץ שיש ב-app/(he)/wall/page.tsx ובפונקציה lobby_view.
const STAGES = [
  { status: "open", lift: null, lobby: "working", wall: "בטיפול" },
  { status: "in_progress", lift: 3, lobby: "working", wall: "בטיפול" },
  { status: "waiting_quote", lift: 3, lobby: "working", wall: "מחכים לתשובה" },
  { status: "waiting_approval", lift: 3, lobby: "working", wall: "מחכים לתשובה" },
  { status: "ready", lift: null, lobby: "ready", wall: "הסתיים" },
  { status: "delivered", lift: null, lobby: null, wall: null },
]
const wallGroup = (status) =>
  status === "open" || status === "in_progress"
    ? "בטיפול"
    : status === "waiting_quote" || status === "waiting_approval"
      ? "מחכים לתשובה"
      : status === "ready"
        ? "הסתיים"
        : null

const daniel = await signIn("test1@test.com")
const lobbyScreen = await signIn("screen1@test.com")
const wallScreen = await signIn("screen2@test.com")

let jobId = null
try {
  // הכרטיס נפתח כמו שדניאל פותח אותו (עם הזהות שלו), לא דרך מפתח השירות.
  const opened = await call(`/rest/v1/job_cards`, {
    token: daniel,
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      plate: PLATE,
      status: "open",
      customer_name: "בדיקת שרשרת",
      customer_phone: `+${PHONE}`,
      vehicle_make: "טויוטה",
      vehicle_model: "בדיקה",
      notes: "בדיקה אוטומטית של המסכים — נמחק בסוף",
    }),
  })
  const [row] = await opened.json()
  jobId = row?.id ?? null
  ok("דניאל פותח כרטיס לרכב שהגיע", opened.ok && Boolean(jobId), `HTTP ${opened.status}`)
  if (!jobId) throw new Error("לא נפתח כרטיס, אין מה לבדוק")

  for (const stage of STAGES) {
    // אותו שינוי שהכפתור שולח (setJobStatus ב-app/(he)/staff/actions.ts): "מוכן"
    // רושם מתי ומפנה את הליפט, "נמסר" רושם מתי. בגרסה הראשונה של הבדיקה זה
    // חסר, והבוט "איבד" את הרכב אחרי המסירה — כי בלי delivered_at הוא לא יודע
    // שהמסירה הייתה היום.
    const patch = { status: stage.status, lift: stage.lift }
    if (stage.status === "ready") patch.ready_at = new Date().toISOString()
    if (stage.status === "delivered") patch.delivered_at = new Date().toISOString()
    const moved = await call(`/rest/v1/job_cards?id=eq.${jobId}`, {
      token: daniel,
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(patch),
    })
    const tag = `[${stage.status}]`
    ok(`${tag} דניאל מעביר את הרכב לשלב`, moved.ok, `HTTP ${moved.status}`)

    // חדר ההמתנה: שלוש ספרות אחרונות ומצב, בלי שום פרט מזהה.
    const lobbyRows = await (await call(`/rest/v1/rpc/lobby_view`, { token: lobbyScreen, method: "POST", body: "{}" })).json()
    const mine = (Array.isArray(lobbyRows) ? lobbyRows : []).filter((r) => r.plate_last3 === TAIL)
    if (stage.lobby) {
      ok(`${tag} חדר ההמתנה מראה "${stage.lobby === "ready" ? "מוכן" : "בעבודה"}"`, mine.length === 1 && mine[0].state === stage.lobby, JSON.stringify(mine))
      ok(`${tag} חדר ההמתנה לא חושף שם, טלפון או לוחית מלאה`, mine.length === 1 && Object.keys(mine[0]).sort().join() === "plate_last3,state,vehicle", Object.keys(mine[0] ?? {}).join())
    } else {
      ok(`${tag} הרכב נעלם מחדר ההמתנה`, mine.length === 0, JSON.stringify(mine))
    }

    // הסדנה: אותה שאילתה שהדף שולח, ואותו קיבוץ.
    const wallRows = await (
      await call(`/rest/v1/job_cards?id=eq.${jobId}&status=not.in.(delivered,cancelled)&select=status,lift`, { token: wallScreen })
    ).json()
    if (stage.wall) {
      const seen = Array.isArray(wallRows) && wallRows.length === 1 ? wallGroup(wallRows[0].status) : null
      ok(`${tag} הסדנה מראה אותו תחת "${stage.wall}"`, seen === stage.wall, JSON.stringify(wallRows))
    } else {
      ok(`${tag} הרכב נעלם מהסדנה`, Array.isArray(wallRows) && wallRows.length === 0, JSON.stringify(wallRows))
    }

    // הלקוח: מה שהבוט יקבל כשהוא ישאל "מה המצב של הרכב שלי".
    const cust = await (
      await call(`/rest/v1/rpc/garage_customer`, { method: "POST", body: JSON.stringify({ p_secret: BOT_TOKEN, p_client: clientId }) })
    ).json()
    const car = (Array.isArray(cust) ? cust : []).find((c) => c.kind === "job" && c.plate_tail === TAIL)
    ok(`${tag} הבוט יודע שהרכב של הלקוח במצב הזה`, car?.status === stage.status, JSON.stringify(cust))
  }

  // מסך הסדנה לא יכול להזיז רכב, גם כשהוא רואה אותו.
  const intruder = await call(`/rest/v1/job_cards?id=eq.${jobId}`, {
    token: wallScreen,
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ status: "ready" }),
  })
  const after = await (await service(`/rest/v1/job_cards?id=eq.${jobId}&select=status`)).json()
  ok("מסך הסדנה לא יכול לשנות מצב של רכב", after?.[0]?.status === "delivered", `HTTP ${intruder.status} → ${after?.[0]?.status}`)
} finally {
  if (jobId) {
    await service(`/rest/v1/customer_notices?job_card_id=eq.${jobId}`, { method: "DELETE" })
    const del = await service(`/rest/v1/job_cards?id=eq.${jobId}`, { method: "DELETE" })
    console.log(del.ok ? "\n· רכב הבדיקה נמחק" : `\n✗ לא הצלחתי למחוק את רכב הבדיקה ${jobId}: ${del.status}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
