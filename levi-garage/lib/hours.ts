// שעות הפתיחה של המוסך, ו"מתי אפשר לאסוף". מקום אחד, כי שני ערוצים אומרים את זה
// ללקוח: התשובה ל"מה המצב של הרכב שלי?" והודעת "הרכב מוכן".
//
// סבב 2.10 (ממצאים 17 ו-18): ההודעה אמרה "אפשר לאסוף א׳–ה׳ עד 17:00, ו׳ עד 12:00",
// כלומר שעות פתיחה כלליות. הרכב היה מוכן בשישי ב-14:20, אחרי הסגירה, והלקוחה
// הייתה מגיעה לשער סגור. מה שהלקוח צריך לשמוע: מתי בפועל.
//
// חגים לא מטופלים כאן. במוסך אמיתי מוסיפים רשימת תאריכים סגורים.

const TZ = "Asia/Jerusalem"

/** לכל יום בשבוע (0 = ראשון): שעת פתיחה וסגירה, או null כשסגור. */
export const OPENING: ReadonlyArray<{ open: string; close: string } | null> = [
  { open: "07:00", close: "17:00" }, // ראשון
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" }, // חמישי
  { open: "07:00", close: "12:00" }, // שישי
  null, // שבת
]

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]

/** היום בשבוע והשעה בשעון ישראל, בלי תלות באזור הזמן של השרת. */
function local(d: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) }
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export type Pickup =
  | { when: "today"; from: string | null; until: string }
  | { when: "tomorrow"; from: string }
  | { when: "day"; day: string; from: string }

/**
 * המועד הקרוב שבו אפשר לבוא לאסוף, מהרגע `now`:
 * היום עד שעת הסגירה; או היום מהפתיחה, אם עוד לא פתחנו; או היום הפתוח הבא.
 */
export function nextPickup(now: Date = new Date()): Pickup {
  const { day, minutes } = local(now)
  const today = OPENING[day]
  if (today && minutes < toMinutes(today.close)) {
    return { when: "today", from: minutes < toMinutes(today.open) ? today.open : null, until: today.close }
  }
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7
    const h = OPENING[d]
    if (!h) continue
    return i === 1 ? { when: "tomorrow", from: h.open } : { when: "day", day: DAY_NAMES[d], from: h.open }
  }
  throw new Error("no opening day")
}

/** "אפשר לאסוף היום, עד 17:00" / "אפשר לאסוף מחר, מ-07:00" / "אפשר לאסוף ביום ראשון, מ-07:00". */
export function pickupPhrase(now: Date = new Date()): string {
  const p = nextPickup(now)
  if (p.when === "today") return p.from ? `אפשר לאסוף היום, מ-${p.from} עד ${p.until}` : `אפשר לאסוף היום, עד ${p.until}`
  if (p.when === "tomorrow") return `אפשר לאסוף מחר, מ-${p.from}`
  return `אפשר לאסוף ביום ${p.day}, מ-${p.from}`
}
