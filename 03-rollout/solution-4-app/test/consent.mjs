// בודק את זיהוי ההסכמה לעדכונים בוואטסאפ (lib/site/consent.ts, ביקורת אבטחה חמישית, 8.10, ממצא 2).
// ההודעות הכתובות מראש נקלטות כהסכמה, ומשפט עם שלילה לא. בלי מסד ובלי רשת.
//
// הרצה: node 03-rollout/solution-4-app/test/consent.mjs

import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"

const ROOT = pathToFileURL("C:/projects/final-project/levi-garage/").href
registerHooks({
  resolve(spec, ctx, next) {
    const s = spec.startsWith("@/") ? new URL(spec.slice(2), ROOT).href : spec
    try {
      return next(s, ctx)
    } catch (e) {
      if ((s.startsWith(".") || s.startsWith("file:")) && !s.endsWith(".ts")) return next(`${s}.ts`, ctx)
      throw e
    }
  },
})
const { asksForUpdates, PREFILLED, wantsRemoval } = await import("../../../levi-garage/lib/site/consent.ts")

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

for (const m of PREFILLED) ok(`הודעה כתובה מראש נקלטת: ${m.slice(0, 30)}…`, asksForUpdates(m))
ok("עריכה קלה של הלקוח עדיין נקלטת", asksForUpdates("היי, אשמח לקבל עדכונים על הרכב"))

for (const m of [
  "אני לא אשמח לקבל עדכונים",
  "לא, אל תשלחו. אשמח לקבל תזכורת? לא",
  "בלי זה, אשמח לקבל בוואטסאפ רק את המחיר",
  "אני לא רוצה. אשמח לקבל עדכונים בעתיד אולי",
  "لا أرجو تذكيري",
  "Не пришлите, пожалуйста, напоминание",
]) ok(`שלילה לא נקלטת כהסכמה: ${m}`, !asksForUpdates(m))

ok("מילה שמכילה 'לא' (מלא) לא נחשבת שלילה", asksForUpdates("המיכל מלא, אשמח לקבל עדכונים"))
ok("'הסר' עדיין מבטל", wantsRemoval("הסר"))

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
