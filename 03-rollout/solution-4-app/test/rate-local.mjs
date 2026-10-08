// בודק את המונה המקומי של הגבלת הקצב (lib/site/rate-local.ts, ביקורת חוזרת, 8.10, ממצא 2).
// כשהמסד לא סופר (סוד שגוי, תקלה), השרת סופר בזיכרון עם אותן תקרות, ולא מאשר הכול.
// בלי מסד ובלי רשת.
//
// הרצה: node 03-rollout/solution-4-app/test/rate-local.mjs

const { localAllowed } = await import("../../../levi-garage/lib/site/rate-local.ts")

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

const k = `t:${Date.now()}`
const first = [1, 2, 3].map(() => localAllowed(k, 60, 3))
ok("עד התקרה: מותר", first.every(Boolean), JSON.stringify(first))
ok("מעל התקרה: נחסם", localAllowed(k, 60, 3) === false)
ok("ממשיך להיחסם בתוך החלון", localAllowed(k, 60, 3) === false)
ok("מפתח אחר נספר לחוד", localAllowed(`${k}:other`, 60, 3) === true)

const short = `${k}:short`
localAllowed(short, 1, 1)
ok("חלון של שנייה: הפעם השנייה נחסמת", localAllowed(short, 1, 1) === false)
await new Promise((r) => setTimeout(r, 1100))
ok("אחרי שהחלון נגמר: מותר שוב", localAllowed(short, 1, 1) === true)

// הצפה במפתחות שונים לא מנפחת את הזיכרון בלי סוף, ולא נופלת
for (let i = 0; i < 6000; i++) localAllowed(`${k}:flood:${i}`, 60, 5)
ok("אחרי 6,000 מפתחות שונים: עדיין עובד", localAllowed(`${k}:after`, 60, 1) === true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
