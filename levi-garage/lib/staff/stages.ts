// שלבי השרשרת, הספים והצבעים. במקום אחד, כי שלושה מסכים קוראים את זה:
// מסך העבודה, הטלוויזיה בסדנה, ודרך עקיפה גם ההיסטוריה. אם המספרים היו
// משוכפלים, שני מסכים היו מראים צבע אחר על אותו רכב, וזה גרוע ממסך בלי צבע.

import { minutesSince } from "./format"

export type Stage = "booked" | "working" | "waiting" | "done"

export const stageLabel: Record<Stage, string> = {
  booked: "מוזמנים להיום",
  working: "בטיפול",
  waiting: "מחכים לתשובה",
  done: "הסתיים",
}

// מתי שלב הופך לתקוע. החלטה, לא מדידה: אחרי שבוע עבודה אמיתי יושבים עם
// דניאל ומכוונים. הערכים בדקות.
export const TOO_LONG = { lift: 240, noLift: 30, quote: 30, customer: 120, ready: 120 } as const

/** ירוק בתוך הזמן, כתום מעבר לסף, אדום מעבר לכפול ממנו. */
export type Heat = "ok" | "warn" | "late"

export function heat(minutes: number, limit: number): Heat {
  if (minutes > limit * 2) return "late"
  if (minutes > limit) return "warn"
  return "ok"
}

export type ClockCard = {
  status: string
  lift: number | null
  lift_since: string | null
  status_since: string
  /** 1.2.0: כשהמסך שולף אותם, השעון יודע על "מחכה לאישור הקבלה" ועל "גמור, מחכה לבדיקה". */
  work_approved_at?: string | null
  work_done_at?: string | null
}

/**
 * איזה שעון רץ על הרכב הזה, ומה הסף שלו.
 * לכל מצב השעון שמתאים לו: רכב שמחכה ללקוח נמדד מרגע השליחה ולא מרגע
 * העלייה לתא, אחרת כמעט כל רכב היה אדום וכולם היו מפסיקים להסתכל.
 */
export function clockOf(c: ClockCard): { iso: string; label: string; limit: number; stage: Stage } {
  if (c.status === "ready") {
    return { iso: c.status_since, label: "מוכן", limit: TOO_LONG.ready, stage: "done" }
  }
  if (c.status === "waiting_approval") {
    return { iso: c.status_since, label: "אצל הלקוח", limit: TOO_LONG.customer, stage: "waiting" }
  }
  if (c.status === "waiting_quote") {
    return { iso: c.status_since, label: "מחכה לשליחה", limit: TOO_LONG.quote, stage: "waiting" }
  }
  if (c.lift !== null) {
    return { iso: c.lift_since ?? c.status_since, label: "בעבודה", limit: TOO_LONG.lift, stage: "working" }
  }
  // 1.2.0 (מיפוי המסכים, 4.10): רכב שמחכה שהלקוח יאשר את הצעת הקבלה הוא "אצל הלקוח",
  // לא "ממתין לליפט". עד היום הוא נצבע כתום אחרי 30 דקות, כאילו הוא בתור.
  if (c.work_approved_at === null && (c.status === "open" || c.status === "in_progress")) {
    return { iso: c.status_since, label: "מחכה לאישור הלקוח", limit: TOO_LONG.customer, stage: "waiting" }
  }
  // "סיימתי" של המכונאי: גמור, מחכה לבדיקה של דניאל.
  if (c.work_done_at && (c.status === "open" || c.status === "in_progress")) {
    return { iso: c.work_done_at, label: "גמור, מחכה לבדיקה", limit: TOO_LONG.quote, stage: "done" }
  }
  return { iso: c.status_since, label: "ממתין לליפט", limit: TOO_LONG.noLift, stage: "working" }
}

export function heatOf(c: ClockCard): Heat {
  const { iso, limit } = clockOf(c)
  return heat(minutesSince(iso), limit)
}
