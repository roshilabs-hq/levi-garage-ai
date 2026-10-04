// "שבוע הדגמה" למסך המדדים (1.2.0): חמישה ימי עבודה של פעילות מדומה, כדי שהמדדים
// יציגו מספרים אמיתיים בסרטון ולבוחנים, לפני שיש לקוחות. כל רכב מסומן
// notes = "שבוע הדגמה · …", ומסך המדדים מציג למעלה "כולל שבוע הדגמה".
//
// הרצה, מתיקיית levi-garage:
//   node --env-file=.env.local scripts/demo-week.mjs           # יוצר (ומוחק קודם שבוע קודם)
//   node --env-file=.env.local scripts/demo-week.mjs --remove  # מוחק הכול
//
// המספרים בנויים כך שיראו מוסך באמצע הדרך: רוב הרכבים מוכנים עד 16:00, ליפט
// מחכה לפעמים, רוב האישורים בקישור. אקראיות קבועה (seed), אז כל הרצה זהה.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error("חסר NEXT_PUBLIC_SUPABASE_URL או SUPABASE_SECRET_KEY (.env.local)")
const NOTE = "שבוע הדגמה"
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }
const api = async (path, init = {}) => {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } })
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json().catch(() => null)
}
const insert = (table, rows) => api(table, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(rows) })

async function remove() {
  const jobs = (await api(`job_cards?notes=like.${encodeURIComponent(NOTE + "*")}&select=id`)) ?? []
  if (jobs.length === 0) return 0
  const ids = jobs.map((j) => j.id).join(",")
  const fs = (await api(`findings?job_card_id=in.(${ids})&select=id`)) ?? []
  if (fs.length) await api(`approvals?finding_id=in.(${fs.map((f) => f.id).join(",")})`, { method: "DELETE" })
  for (const t of ["findings", "job_moves", "customer_notices", "quote_items", "quote_versions", "quote_requests", "help_calls", "inspections"]) {
    await api(`${t}?job_card_id=in.(${ids})`, { method: "DELETE" })
  }
  await api(`job_cards?id=in.(${ids})`, { method: "DELETE" })
  return jobs.length
}

if (process.argv.includes("--remove")) {
  console.log(`נמחקו ${await remove()} רכבים של ${NOTE}.`)
  process.exit(0)
}

// ---------------------------------------------------------------- יצירה

let seed = 20261004
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("")

// שעון ישראל: עד סוף אוקטובר UTC+3, אחר כך UTC+2.
const israelToIso = (date, minutes) => {
  const [y, m, d] = date.split("-").map(Number)
  const offset = m < 10 || (m === 10 && d < 25) ? 3 : 2
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - offset * 60)).toISOString()
}
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString()

// חמשת ימי העבודה (א'–ה') האחרונים לפני היום.
const days = []
for (let back = 1; days.length < 5 && back < 14; back++) {
  const d = new Date(Date.now() - back * 86400000)
  const wd = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })).getDay()
  if (wd >= 0 && wd <= 4) days.unshift(d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }))
}

const CARS = [
  ["טויוטה", "COROLLA"], ["יונדאי", "i20"], ["קיה", "PICANTO"], ["מאזדה", "3"], ["סקודה", "OCTAVIA"],
  ["פולקסווגן", "GOLF"], ["שברולט", "SPARK"], ["רנו", "CLIO"], ["סוזוקי", "SWIFT"], ["ניסאן", "QASHQAI"],
]
const NAMES = ["דנה", "אורי", "מאיה", "יוסי", "נועה", "סמיר", "אולגה", "רונית", "עמית", "חנה", "ליאור", "ראמי"]
const FINDINGS = [
  { title: "החלפת רפידות בלם קדמיות", o: 780, a: 520, safety: true },
  { title: "החלפת מגבים (זוג)", o: 180, a: 110, safety: false },
  { title: "החלפת נורה ראשית", o: 120, a: null, safety: true },
  { title: "החלפת מסנן אוויר ומסנן מזגן", o: 280, a: 190, safety: false },
]
const REASONS = ["לקוח ותיק", "עיכוב שלנו", "צי של עסק מהאזור"]

const removed = await remove()
if (removed) console.log(`נמחק ${NOTE} קודם (${removed} רכבים).`)

let cars = 0
for (const day of days) {
  const perDay = 7 + Math.floor(rand() * 3)
  for (let i = 0; i < perDay; i++) {
    const opened = israelToIso(day, 7 * 60 + 20 + i * 35 + Math.floor(rand() * 15))
    const approvedVia = rand() < 0.85 ? "link" : "print"
    const hasFinding = rand() < 0.35
    // מוכן: רוב הרכבים בין 12:00 ל-15:50, חלק אחרי 16:00.
    const readyMin = (rand() < 0.8 ? 12 * 60 + Math.floor(rand() * 230) : 16 * 60 + 10 + Math.floor(rand() * 50))
    const ready = israelToIso(day, Math.max(readyMin, 8 * 60 + i * 35 + 120))
    // כולם "נמסרו": רכב הדגמה לא מופיע בלוח, במפה או בחדר ההמתנה כאילו הוא באמת במוסך.
    const delivered = plus(ready, 40 + Math.floor(rand() * 90))
    const [make, model] = pick(CARS)
    const [job] = await insert("job_cards", [{
      plate: String(1000000 + Math.floor(rand() * 8999999)),
      vehicle_make: make,
      vehicle_model: model,
      customer_name: `${pick(NAMES)} (הדגמה)`,
      status: delivered ? "delivered" : "ready",
      opened_at: opened,
      work_approved_at: plus(opened, 12 + Math.floor(rand() * 20)),
      work_approved_via: approvedVia,
      inspected_at: plus(opened, 60),
      ready_at: ready,
      delivered_at: delivered,
      whatsapp_consent: true,
      notes: `${NOTE} · ${day}`,
    }])
    cars++

    // התזוזות שהטריגר רשם עכשיו לא נכונות לעבר: מחליפים בתזוזות של אותו יום.
    await api(`job_moves?job_card_id=eq.${job.id}`, { method: "DELETE" })
    const lift = 1 + (i % 4)
    const moves = [
      { place: "lot", lift: null, status: "open", moved_at: opened },
      { place: "lift", lift, status: "in_progress", moved_at: plus(opened, 45) },
    ]
    if (hasFinding) {
      const sent = plus(opened, 150)
      const f = pick(FINDINGS)
      // לפעמים הרכב נשאר על הליפט בזמן שמחכים (זה מה שהמדד תופס), ולרוב יורד לחניה.
      const stays = rand() < 0.1
      const answer = 15 + Math.floor(rand() * 55)
      moves.push({ place: "lift", lift, status: "waiting_quote", moved_at: plus(opened, 147) })
      moves.push({ place: "lift", lift, status: "waiting_approval", moved_at: sent })
      if (!stays) moves.push({ place: "parked", lift: null, status: "waiting_approval", moved_at: plus(sent, 3) })
      moves.push({ place: "lift", lift, status: "in_progress", moved_at: plus(sent, answer) })

      const approved = rand() < 0.8
      const discount = approved && rand() < 0.35 ? 10 : 0
      const after = f.a !== null && rand() < 0.5
      const list = after ? f.a : f.o
      const chosen = approved ? Math.round((list * (100 - discount)) / 100) : null
      const [fd] = await insert("findings", [{
        job_card_id: job.id, source: "pricelist", title: f.title, summary: f.title, customer_text: `מצאנו שצריך: ${f.title}.`,
        status: approved ? "approved" : "declined", urgency: "yellow", safety: f.safety,
        price_original: Math.round((f.o * (100 - discount)) / 100), price_aftermarket: f.a === null ? null : Math.round((f.a * (100 - discount)) / 100),
        list_price_original: f.o, list_price_aftermarket: f.a, discount_pct: discount, discount_reason: discount ? pick(REASONS) : null,
        labor_hours: 1, warranty_original: "12 חודשים", warranty_aftermarket: f.a === null ? null : "6 חודשים",
        part_diff: f.a === null ? null : "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.", single_reason: f.a === null ? "חלק אחד בלבד." : null,
        sent_at: sent, created_at: plus(opened, 130),
      }])
      await insert("approvals", [{
        finding_id: fd.id, token: hex(36), channel: "link", message_text: `מצאנו שצריך: ${f.title}.`,
        sent_at: sent, decided_at: plus(sent, answer), expires_at: plus(sent, 7 * 24 * 60),
        decision: approved ? "approved" : "declined", part_choice: approved ? (after ? "aftermarket" : "original") : null, price_chosen: chosen,
      }])
    }
    moves.push({ place: "done", lift: null, status: "ready", moved_at: ready })
    if (delivered) moves.push({ place: "done", lift: null, status: "delivered", moved_at: delivered })
    await insert("job_moves", moves.map((m) => ({ job_card_id: job.id, ...m })))
  }
}
console.log(`נוצר ${NOTE}: ${cars} רכבים ב-${days.length} ימים (${days[0]} עד ${days[days.length - 1]}).`)
