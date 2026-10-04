// החישובים של מסך המדדים (1.2.0), כפונקציות טהורות: מקבלות שורות ו"עכשיו",
// ומחזירות מספר. ככה אפשר לבדוק אותן עם נתונים ידועים (test/metrics.mjs),
// בלי מסד ובלי שעון אמיתי. עד 1.2.0 הכול ישב בתוך הדף, ונמצאו בו טעויות:
// ליפט שחיכה בלילה נספר כ-15 שעות, "עד 16:00" נמדד לפי איסוף ולא לפי מוכן,
// והחודש התחיל לפי שעון אנגליה.
//
// בלי imports בכוונה: הבדיקה מריצה את הקובץ ישר ב-node.

export type Opening = ReadonlyArray<{ open: string; close: string } | null>

const TZ = "Asia/Jerusalem"
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hour12: false,
})
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** תאריך, יום בשבוע ודקות מתחילת היום, בשעון ישראל. */
export function israel(iso: string | Date) {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  const hour = Number(p.hour) % 24
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday as string] ?? 0, minutes: hour * 60 + Number(p.minute) }
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/**
 * כמה דקות מתוך הקטע [from, to) היו בשעות הפתיחה של המוסך. רכב שנשאר על הליפט
 * בלילה לא "מחכה" 15 שעות: באותן שעות אף אחד לא היה עובד עליו ממילא.
 */
export function openMinutesBetween(from: string, to: string, opening: Opening): number {
  let a = new Date(from).getTime()
  const b = new Date(to).getTime()
  let total = 0
  // צעדים של עד יום, לפי גבולות ימים בשעון ישראל.
  for (let guard = 0; a < b && guard < 400; guard++) {
    const here = israel(new Date(a))
    const dayEnd = a + (24 * 60 - here.minutes) * 60000
    const stop = Math.min(b, dayEnd)
    const hours = opening[here.weekday]
    if (hours) {
      const startMin = here.minutes
      const endMin = startMin + (stop - a) / 60000
      const lo = Math.max(startMin, toMin(hours.open))
      const hi = Math.min(endMin, toMin(hours.close))
      if (hi > lo) total += hi - lo
    }
    a = stop
  }
  return total
}

// ---------------------------------------------------------------- ליפט מת

export type Move = { job_card_id: number; place: string; status: string; moved_at: string }

/**
 * KPI 2: "שעות ליפט מתות". רכב על ליפט שמחכה ללקוח (waiting_approval) או לדניאל
 * (waiting_quote). המתנה לחלק עוד לא נרשמת במערכת כמצב נפרד.
 * כל קטע נמדד עד התזוזה הבאה של אותו רכב, או עד "עכשיו", ורק בשעות הפתיחה.
 * מחולק במספר ימי העבודה בחלון (לפי שעון ישראל) שבהם הייתה תזוזה כלשהי.
 */
export function liftDeadMinutesPerDay(moves: Move[], now: string, since: string, opening: Opening): number | null {
  const byJob = new Map<number, Move[]>()
  for (const m of moves) {
    const list = byJob.get(m.job_card_id) ?? []
    list.push(m)
    byJob.set(m.job_card_id, list)
  }
  let dead = 0
  const days = new Set<string>()
  const sinceMs = new Date(since).getTime()
  for (const list of byJob.values()) {
    list.sort((x, y) => x.moved_at.localeCompare(y.moved_at))
    list.forEach((m, i) => {
      if (new Date(m.moved_at).getTime() >= sinceMs) days.add(israel(m.moved_at).date)
      if (m.place === "lift" && (m.status === "waiting_approval" || m.status === "waiting_quote")) {
        const end = list[i + 1]?.moved_at ?? now
        // קטע שהתחיל לפני החלון נספר רק מתחילת החלון.
        const start = new Date(m.moved_at).getTime() < sinceMs ? since : m.moved_at
        if (new Date(end).getTime() > new Date(start).getTime()) dead += openMinutesBetween(start, end, opening)
      }
    })
  }
  return days.size ? dead / days.size : null
}

// ---------------------------------------------------------------- מוכן עד 16:00

export type Card = { id: number; opened_at: string; ready_at: string | null }

/**
 * KPI 1: "15 מתוך 15 עד 16:00". נמדד לפי מתי הרכב היה **מוכן** (ready_at), באותו
 * יום שבו התקבל, לפני 16:00 בשעון ישראל. מתי הלקוח בא לאסוף זה לא בשליטת המוסך.
 */
export function readyByFour(cards: Card[]): { onTime: number; total: number } {
  const ready = cards.filter((c) => c.ready_at)
  const onTime = ready.filter((c) => {
    const r = israel(c.ready_at!)
    return r.date === israel(c.opened_at).date && r.minutes < 16 * 60
  })
  return { onTime: onTime.length, total: ready.length }
}

// ---------------------------------------------------------------- זמן תשובה

export type Approval = { id: number; request_id: number | null; sent_at: string; decided_at: string | null; expires_at: string | null }

/**
 * זמן תשובה של לקוח, לפי **הודעה** ולא לפי ממצא (מ-027 הודעה אחת יכולה לשאת כמה
 * ממצאים). נמדד בשעות הפתיחה. "ממתינים" הם הודעות פתוחות שהקישור שלהן עוד בתוקף.
 */
export function customerResponse(approvals: Approval[], now: string, opening: Opening) {
  const groups = new Map<string, Approval>()
  for (const a of approvals) {
    const key = a.request_id ? `r${a.request_id}` : `a${a.id}`
    if (!groups.has(key)) groups.set(key, a)
  }
  const messages = [...groups.values()]
  const decided = messages.filter((m) => m.decided_at)
  const waits = decided.map((m) => openMinutesBetween(m.sent_at, m.decided_at!, opening))
  const avg = waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : null
  const waiting = messages.filter((m) => !m.decided_at && (!m.expires_at || m.expires_at > now)).length
  return { avg, waiting, decided: decided.length }
}

// ---------------------------------------------------------------- אישור בכתב

/**
 * KPI 5: "אפס ויכוחים בקופה". כל עבודה שאושרה, עם הוכחה בכתב: הלקוח אישר בקישור
 * (link) או חתם על עותק מודפס (print). "counter" הוא סימון של דניאל בלבד, בלי שום
 * דבר מהלקוח (לפני 036), ולכן הוא לא בכתב.
 */
export function writtenApprovals(cards: { work_approved_via: string | null }[]) {
  const approved = cards.filter((c) => c.work_approved_via)
  const written = approved.filter((c) => c.work_approved_via === "link" || c.work_approved_via === "print")
  return { written: written.length, total: approved.length }
}

// ---------------------------------------------------------------- הנחות

export type Discounted = {
  status: string
  discount_reason: string | null
  list_price_original: number | null
  list_price_aftermarket: number | null
  approval: { part_choice: string | null; price_chosen: number | null; decided_at: string | null } | null
}

/**
 * הנחות שהלקוח באמת קיבל ב-30 הימים האחרונים: ממצא שאושר, מול מחיר המחירון של
 * החלק שבחר, לפי מתי הלקוח אישר. חלון מתגלגל ולא חודש קלנדרי: בתחילת חודש המדד
 * לא מתאפס לאפס, וההשוואה ל"2,000–2,500 בחודש" נשארת הוגנת.
 */
export function discountsSince(rows: Discounted[], since: string) {
  const given = rows.filter((r) => {
    const a = r.approval
    if (r.status !== "approved" || !a?.price_chosen || !a.decided_at) return false
    if (a.decided_at < since) return false
    const list = a.part_choice === "aftermarket" ? r.list_price_aftermarket : r.list_price_original
    return list !== null && Number(list) > Number(a.price_chosen)
  })
  const sum = given.reduce((s, r) => {
    const a = r.approval!
    const list = a.part_choice === "aftermarket" ? r.list_price_aftermarket : r.list_price_original
    return s + (Number(list) - Number(a.price_chosen))
  }, 0)
  const reasons = [...new Set(given.map((r) => r.discount_reason).filter(Boolean) as string[])].slice(0, 3)
  return { sum, count: given.length, reasons }
}
