// מה קורה במוסך עכשיו, בשביל לוח היום ופס "היום" במדדים (ביקורת UX חיצונית, 8.10, ממצא 10:
// "אבי ביקש להבין את המצב במהירות, והמדדים מכסים 30 יום"). חישוב אחד לשני המסכים, כדי שהחריגות
// בפס ובלוח יהיו אותו מספר.

import { minutesSince } from "./format"
import { awaitingIntake, type QueueCard } from "./queue"
import { clockOf, heat, type ClockCard } from "./stages"

export type TodayCard = QueueCard & ClockCard

/**
 * חריגות (רועי, 30.9: רכב חיכה 7 שעות לליפט, ובלוח לא הופיע כלום). אותם ספים כמו בצבעים של
 * מסך הסדנה. רכב שמחכה ללקוח כבר מופיע ב"להתקשר", ומחכה לדניאל ב"ממצאים".
 */
export function overdueCards<C extends TodayCard>(all: C[]) {
  return all
    .filter((c) => c.status !== "waiting_approval" && c.status !== "waiting_quote" && !c.parked_at && !awaitingIntake(c))
    .map((c) => {
      const clock = clockOf(c)
      const minutes = minutesSince(clock.iso)
      return { c, clock, minutes, level: heat(minutes, clock.limit) }
    })
    .filter((x) => x.level !== "ok")
    .sort((a, b) => b.minutes / b.clock.limit - a.minutes / a.clock.limit)
}

const ACTIVE = new Set(["open", "in_progress", "waiting_quote", "waiting_approval"])

/** ארבעה מספרים: מוכנים היום, מחכים לתשובת לקוח, ליפטים תפוסים, חריגות. */
export function todayNumbers(all: TodayCard[], readyToday: number) {
  const lifts = new Set(all.filter((c) => c.lift !== null && ACTIVE.has(c.status)).map((c) => c.lift))
  return {
    ready: readyToday,
    waiting: all.filter((c) => c.status === "waiting_approval").length,
    lifts: lifts.size,
    late: overdueCards(all).length,
  }
}
