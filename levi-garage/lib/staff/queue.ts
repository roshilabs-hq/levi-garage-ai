// התור לליפטים, במקום אחד. ארבעה מסכים קוראים אותו (הליפט, מפת המוסך, הלוח
// של דניאל והטלוויזיה בסדנה), ואם כל אחד היה מחשב לבד, שני מסכים היו מראים
// "הבא בתור" אחר — והמכונאי היה מושך רכב שדניאל הבטיח למישהו אחר.
//
// הכלל (רועי, 28.9): הליפט הוא המשאב היקר, והחניה היא התור. רכב שמחכה למשהו
// יורד לחניה ויוצא מהתור; דניאל מחזיר אותו, לראש התור.

export const ACTIVE = ["open", "in_progress", "waiting_quote", "waiting_approval"] as const

export type QueueCard = {
  lift: number | null
  status: string
  opened_at: string
  parked_at: string | null
  outside_at: string | null
  priority_at: string | null
  /** המכונאי לחץ "סיימתי" (028). הרכב ירד לחניה ומחכה לבדיקה של דניאל. */
  work_done_at?: string | null
  /**
   * הלקוח אישר את הצעת הקבלה (036). null = עוד לא: הרכב בחניה ולא עולה לליפט.
   * מסך שלא בוחר את השדה (undefined) מתנהג כמו קודם.
   */
  work_approved_at?: string | null
}

const active = (c: QueueCard) => (ACTIVE as readonly string[]).includes(c.status)

/** הלקוח עוד לא אישר את הצעת הקבלה (036). הליפט לא מחכה לו: הוא מחוץ לתור. */
export const awaitingIntake = (c: QueueCard) => active(c) && c.lift === null && c.work_approved_at === null

/** בחניה, מחכה שמכונאי יתפנה: הלקוח אישר, ויש עליו עבודה. */
export const inQueue = (c: QueueCard) =>
  active(c) && c.lift === null && !c.parked_at && !c.outside_at && !c.work_done_at && c.work_approved_at !== null

/** הורד מהליפט ומחכה ללקוח או לחלק. מחוץ לתור עד שדניאל מחזיר. */
export const isParked = (c: QueueCard) => active(c) && c.lift === null && Boolean(c.parked_at)

/** הלקוח כבר ענה, והרכב עדיין בחניה: זה התור של דניאל, לא של הלקוח. */
export const approvedWaitingForUs = (c: QueueCard) =>
  isParked(c) && (c.status === "open" || c.status === "in_progress") && !c.work_done_at

/**
 * המכונאי סיים, הליפט התפנה, והרכב בחניה עד שדניאל בודק ומסמן "מוכן"
 * (החלטה של רועי, 2.10: הליפט לא מחכה לבדיקה).
 */
export const doneAwaitingCheck = (c: QueueCard) => active(c) && c.lift === null && Boolean(c.work_done_at)

export const isOutside = (c: QueueCard) => active(c) && c.lift === null && Boolean(c.outside_at)

/** מי שדניאל החזיר או הקדים — קודם, לפי מתי. אחריהם, לפי סדר ההגעה. */
export function byQueue(a: QueueCard, b: QueueCard) {
  if (a.priority_at && b.priority_at) return a.priority_at.localeCompare(b.priority_at)
  if (a.priority_at) return -1
  if (b.priority_at) return 1
  return a.opened_at.localeCompare(b.opened_at)
}

export const queueOf = <T extends QueueCard>(cards: T[]) => cards.filter(inQueue).sort(byQueue)

/** איפה הרכב, במילה אחת או שתיים, לטלוויזיה בסדנה ולכרטיס. */
export function placeLabel(c: QueueCard & { inspected_at?: string | null }) {
  if (c.status === "ready") return "בחצר, מחכה ללקוח"
  if (c.lift !== null) return `ליפט ${c.lift}`
  if (c.outside_at) return "בעבודה בחוץ"
  if (awaitingIntake(c)) return "בחניה, מחכה לאישור הלקוח"
  if (doneAwaitingCheck(c)) return "גמור, מחכה לבדיקה"
  if (approvedWaitingForUs(c)) return "אושר, חוזר לתור"
  if (c.parked_at) return "בחניה, מחכה לתשובה"
  return "בתור לליפט"
}
