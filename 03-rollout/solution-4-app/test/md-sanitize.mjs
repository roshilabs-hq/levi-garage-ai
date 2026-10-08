// בודק את הניקוי של ה-Markdown במרכז ההדרכה (lib/training/read.ts, ביקורות האבטחה, 7.10-8.10).
// תוכן עוין לא מגיע לדף כקוד, והמדריכים האמיתיים יוצאים בדיוק כמו קודם. בלי מסד ובלי רשת.
//
// הרצה: node 03-rollout/solution-4-app/test/md-sanitize.mjs

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
const { mdHtml } = await import("../../../levi-garage/lib/training/read.ts")

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

const raw = mdHtml('שלום\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n')
ok("תגית script מוצגת כטקסט", !raw.includes("<script") && raw.includes("&lt;script&gt;"), raw)
ok("תמונה עם onerror מוצגת כטקסט", !/<img[^>]*onerror/i.test(raw), raw)

const js = mdHtml("[לחצו](javascript:alert(1))")
ok("קישור javascript: הופך ל-#", js.includes('href="#"') && !js.includes("javascript:"), js)
const data = mdHtml("![x](data:text/html;base64,PHNjcmlwdD4=)")
ok("תמונה מ-data: הופכת ל-#", data.includes('src="#"'), data)
const proto = mdHtml("[x](//evil.example/a)")
ok("קישור שמתחיל ב-// נחסם", proto.includes('href="#"'), proto)

const alt = mdHtml('![a" onload="x](img/a.png)')
ok("מרכאות בטקסט החלופי לא שוברות את התכונה", !/onload="x"/.test(alt), alt)

const good = mdHtml("[מדריך](/training/read/faq#כללי) · [GitHub](https://github.com/roshilabs-hq) · [טלפון](tel:0553048489) · ![צילום](img/m1.png)")
ok("קישור פנימי עם עברית: נשמר ומקודד", good.includes('href="/training/read/faq#%D7%9B%D7%9C%D7%9C%D7%99"'), good)
ok("קישור https נשמר", good.includes('href="https://github.com/roshilabs-hq"'))
ok("קישור tel נשמר", good.includes('href="tel:0553048489"'))
ok("תמונה יחסית נשמרת", good.includes('src="img/m1.png"'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
