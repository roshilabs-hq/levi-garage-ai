// הטופס של מסירת רכב ב-Cal.com (סוג אירוע drop-off): סדר, הסכמה רשות, תקנון ופרטיות.
//
//   node --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-3-agent/scripts/cal-form.mjs test   → עותק זמני ומוסתר
//   node --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-3-agent/scripts/cal-form.mjs apply x <backup.json>
//   node ... cal-form.mjs delete <id>
// המפתח לא מודפס. שימו לב: ה-API מחזיר את "מה קורה עם הרכב" לסוף הטופס; מזיזים אותו ידנית
// בלוח הבקרה ("קישורים" ← "טופס הזמנה" ← חץ ↑). הוחל ב-3.10, באישור רועי.
import fs from "node:fs"
const key = process.env.CAL_API_KEY
const API = "https://api.cal.com/v2"
const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json", "cal-api-version": "2024-06-14" }
const SITE = "https://levi-garage.co.il"

const FIELDS = [
  { type: "name", label: "שם", disableOnPrefill: false },
  { type: "email", label: "דוא\"ל (לא חובה)", required: false, placeholder: "", hidden: false },
  { type: "phone", slug: "attendeePhoneNumber", label: "טלפון נייד", required: true, hidden: false, placeholder: "050-0000000" },
  { type: "text", slug: "plate", label: "מספר רישוי", required: true, placeholder: "12-345-67", hidden: false },
  { type: "select", slug: "service", label: "סוג שירות", required: true, placeholder: "", hidden: false,
    options: ["טיפול תקופתי", "נורה דולקת / תקלה", "הכנה וליווי לטסט", "חשמל / מיזוג", "בדיקה לפני קנייה", "אחר"] },
  { slug: "notes", label: "מה קורה עם הרכב? (לא חובה)", placeholder: "למשל: רעש מקדימה כשבולמים, נורת מנוע דולקת מאתמול", required: false, hidden: false },
  { type: "boolean", slug: "whatsapp_consent", required: false, hidden: false,
    label: "מומלץ: אני רוצה לקבל בוואטסאפ תזכורת יום לפני, הצעת מחיר לאישור, והודעה כשהרכב מוכן. אחרי קביעת התור נבקש ממך לשלוח לנו הודעה אחת. בלי הסימון: הצעת המחיר תגיע במייל, או לחתימה בדלפק כשמביאים את הרכב." },
  { type: "boolean", slug: "terms_consent", required: true, hidden: false,
    label: `קראתי ואני מאשר/ת את [התקנון](${SITE}/terms?from=book) ואת [מדיניות הפרטיות](${SITE}/privacy?from=book) של מוסך לוי ובניו` },
  { slug: "title", hidden: true },
  { slug: "guests", hidden: true },
  { slug: "rescheduleReason", hidden: true },
]

async function call(method, path, body) {
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  let j; try { j = JSON.parse(t) } catch { j = t }
  if (!r.ok) { console.error("✗", method, path, r.status, t.slice(0, 600)); process.exit(1) }
  return j
}
function show(fields) {
  for (const f of fields) console.log(" -", f.slug ?? f.type, "|", f.type, "|", f.required ? "required" : "optional", f.hidden ? "| hidden" : "", "|", (f.label ?? "").slice(0, 60), f.bookingField ? "| raw:" + f.bookingField.slice(0, 90) : "")
}

const [mode, arg] = process.argv.slice(2)
if (mode === "test") {
  const created = await call("POST", "/event-types", { title: "בדיקת טופס (זמני)", slug: "form-test-" + Date.now().toString(36), lengthInMinutes: 15, hidden: true })
  const id = created.data.id
  console.log("זמני:", id, created.data.slug)
  const res = await call("PATCH", `/event-types/${id}`, { bookingFields: FIELDS })
  show(res.data.bookingFields)
} else if (mode === "retest") {
  const res = await call("PATCH", `/event-types/${arg}`, { bookingFields: FIELDS })
  show(res.data.bookingFields)
} else if (mode === "apply") {
  const before = await call("GET", "/event-types/7164398")
  fs.writeFileSync(process.argv[4] ?? "cal-backup.json", JSON.stringify(before.data.bookingFields, null, 2))
  const res = await call("PATCH", "/event-types/7164398", { bookingFields: FIELDS })
  show(res.data.bookingFields)
} else if (mode === "delete") {
  await call("DELETE", `/event-types/${arg}`)
  console.log("נמחק", arg)
}
