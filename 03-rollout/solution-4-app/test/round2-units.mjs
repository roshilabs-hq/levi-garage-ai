// סבב 2.10: חוקי התור ("סיימתי", "הלקוח אישר") ו"מתי לאסוף". לוגיקה טהורה, בלי מסד.
// מריצים: node 03-rollout/solution-4-app/test/round2-units.mjs (Node 22.6+ קורא TypeScript).
const { approvedWaitingForUs, doneAwaitingCheck, inQueue, placeLabel } = await import(
  new URL("../../../levi-garage/lib/staff/queue.ts", import.meta.url)
)
const { pickupPhrase } = await import(new URL("../../../levi-garage/lib/hours.ts", import.meta.url))

// prompt.ts מייבא את brain.generated בלי סיומת (כמו ש-Next מצפה); Node צריך ".ts".
import { register } from "node:module"
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c) } catch (e) { if (s.startsWith('.') && !s.endsWith('.ts')) return next(s + '.ts', c); throw e } }",
    ),
)
const { withVerify, contextLine } = await import(new URL("../../../levi-garage/lib/mentor/prompt.ts", import.meta.url))

let pass = 0
let fail = 0
const ok = (name, cond, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  (${extra})`}`)
}

const card = (over = {}) => ({
  lift: null, status: "in_progress", opened_at: "2026-10-02T10:00:00Z",
  parked_at: null, outside_at: null, priority_at: null, work_done_at: null, ...over,
})
const parked = { parked_at: "2026-10-02T11:00:00Z" }

// ממצא 9: בחניה עם טיוטות = waiting_quote, ולא "הלקוח אישר"
ok("בחניה, waiting_quote: לא 'הלקוח אישר'", !approvedWaitingForUs(card({ ...parked, status: "waiting_quote" })))
ok("בחניה, in_progress, בלי 'סיימתי': 'הלקוח אישר'", approvedWaitingForUs(card({ ...parked })))
ok("בחניה, waiting_quote: התווית 'בחניה, מחכה לתשובה'", placeLabel(card({ ...parked, status: "waiting_quote" })) === "בחניה, מחכה לתשובה")

// ממצא 14: "סיימתי" מפנה את הליפט, והרכב "גמור, מחכה לבדיקה" — לא בתור ולא "אושר"
const done = card({ ...parked, work_done_at: "2026-10-02T12:00:00Z" })
ok("'סיימתי': גמור, מחכה לבדיקה", doneAwaitingCheck(done))
ok("'סיימתי': לא 'הלקוח אישר: להחזיר לתור'", !approvedWaitingForUs(done))
ok("'סיימתי': לא בתור לליפט", !inQueue(done))
ok("'סיימתי': התווית 'גמור, מחכה לבדיקה'", placeLabel(done) === "גמור, מחכה לבדיקה")
ok("'מוכן' גובר על 'סיימתי'", placeLabel({ ...done, status: "ready" }) === "בחצר, מחכה ללקוח" && !doneAwaitingCheck({ ...done, status: "ready" }))
ok("רכב בתור רגיל עדיין בתור", inQueue(card()))

// ממצאים 17–18: מתי לאסוף, בשעון ישראל (קיץ: UTC+3)
const at = (iso) => pickupPhrase(new Date(iso))
ok("שישי 14:20, אחרי הסגירה: ביום ראשון", at("2026-10-02T11:20:00Z") === "אפשר לאסוף ביום ראשון, מ-07:00", at("2026-10-02T11:20:00Z"))
ok("שישי 10:00: היום עד 12:00", at("2026-10-02T07:00:00Z") === "אפשר לאסוף היום, עד 12:00")
ok("שלישי 11:00: היום עד 17:00", at("2026-10-06T08:00:00Z") === "אפשר לאסוף היום, עד 17:00")
ok("שלישי 18:00: מחר", at("2026-10-06T15:00:00Z") === "אפשר לאסוף מחר, מ-07:00")
ok("שלישי 06:30: היום מ-07:00", at("2026-10-06T03:30:00Z") === "אפשר לאסוף היום, מ-07:00 עד 17:00")
ok("שבת: מחר (ראשון)", at("2026-10-03T09:00:00Z") === "אפשר לאסוף מחר, מ-07:00")
ok("חמישי 17:30: מחר (שישי)", at("2026-10-08T14:30:00Z") === "אפשר לאסוף מחר, מ-07:00")

// "המוסכניק הוותיק": רשת הביטחון ל"⚠️ לאמת" (גם Pro השמיט אותו, 2.10)
ok("מספר עם יחידה בלי 'לאמת': נוספת שורה", withVerify("מתח טעינה סביב 14.4V.").includes("⚠️ לאמת"))
ok("כבר יש 'לאמת': לא נוסף שוב", withVerify("14.4V ⚠️ לאמת מול היצרן").split("לאמת").length === 2)
ok("בלי מספרים: בלי שינוי", withVerify("לבדוק חזותית את הקטבים.") === "לבדוק חזותית את הקטבים.")
ok("קוד תקלה הוא לא מספר עם יחידה", withVerify("P0301 בצילינדר 1") === "P0301 בצילינדר 1")
ok("ברוסית עם проверить: לא נוסף", withVerify("14,4 V — проверить по данным") === "14,4 V — проверить по данным")
ok("ההקשר: מי שואל, כדי לא להפנות אותו לעצמו", contextLine({ car: "x", year: null, engine: null, complaint: null, inspection: null, asker: { name: "אלכס", role: "mechanic", lang: "ru" } }).includes("השואל: אלכס"))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
