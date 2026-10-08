// בודק את lib/staff/today.ts (ביקורת UX חיצונית, 8.10, ממצא 10): פס "היום" במדדים, וחריגות
// באותו חישוב כמו לוח היום. נתונים ידועים מראש, בלי מסד.
//
// הרצה: node 03-rollout/solution-4-app/test/today.mjs

// הקבצים ב-lib מייבאים זה את זה בלי סיומת (כמו ש-Next מצפה), ו-node דורש סיומת. ההוק משלים ".ts".
import { registerHooks } from "node:module"
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith(".") && !spec.endsWith(".ts")) return next(`${spec}.ts`, ctx)
      throw e
    }
  },
})
const { overdueCards, todayNumbers } = await import("../../../levi-garage/lib/staff/today.ts")

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
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
const card = (over) => ({
  status: "in_progress", lift: null, opened_at: ago(600), lift_since: null, status_since: ago(5),
  parked_at: null, outside_at: null, priority_at: null, work_done_at: null, work_approved_at: ago(600), ...over,
})

const cards = [
  card({ lift: 1, lift_since: ago(30) }), // על ליפט, בזמן
  card({ lift: 2, lift_since: ago(300) }), // על ליפט 5 שעות: חריגה
  card({ lift: 3, status: "waiting_approval", lift_since: ago(20), status_since: ago(20) }), // מחכה ללקוח
  card({ status: "waiting_approval", status_since: ago(400), parked_at: ago(400) }), // בחניה, מחכה ללקוח: לא חריגה
  card({ status: "open", status_since: ago(90) }), // בתור לליפט 90 דקות: חריגה
  card({ status: "open", work_approved_at: null, status_since: ago(200) }), // מחכה לאישור הקבלה: לא נספר כחריגה
  card({ lift: 4, status: "ready", status_since: ago(10) }), // מוכן: לא תופס ליפט פעיל
]

const late = overdueCards(cards)
ok("חריגות: שתיים (5 שעות על ליפט, 90 דקות בתור)", late.length === 2, String(late.length))
ok("חריגות: הגרועה ביותר ראשונה", late[0]?.c.lift === null, JSON.stringify(late.map((x) => x.c.lift)))
const n = todayNumbers(cards, 3)
ok("מוכנים היום: מה שנספר מבחוץ", n.ready === 3)
ok("מחכים לתשובת לקוח: שניים", n.waiting === 2, String(n.waiting))
ok("ליפטים בעבודה: שלושה (מוכן לא נספר)", n.lifts === 3, String(n.lifts))
ok("חריגות בפס = חריגות בלוח", n.late === late.length)
ok("בלי רכבים: הכול אפס", JSON.stringify(todayNumbers([], 0)) === JSON.stringify({ ready: 0, waiting: 0, lifts: 0, late: 0 }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
