// בודק את קריאת גוף הבקשה לבוטים (lib/site/body.ts, ביקורת אבטחה שישית, ממצא 3): גוף גדול נעצר בזמן
// הקריאה, גם בלי כותרת אורך, ולא נקרא כולו לזיכרון. בלי רשת.
//
// הרצה: node 03-rollout/solution-4-app/test/body.mjs

const { readJson, MAX_BODY } = await import("../../../levi-garage/lib/site/body.ts")

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

const json = JSON.stringify({ question: "איך מורידים רכב לחניה?" })
ok("שאלה רגילה נקראת", (await readJson(new Request("http://x", { method: "POST", body: json })))?.question === "איך מורידים רכב לחניה?")
ok("כותרת אורך גדולה נדחית בלי לקרוא", (await readJson(new Request("http://x", { method: "POST", body: json, headers: { "content-length": String(MAX_BODY + 1) } }))) === null)

// זרם בלי כותרת אורך: 64KB בחתיכות של 4KB. נעצר אחרי שעוברים 32KB.
let pulled = 0
const stream = new ReadableStream({
  pull(c) {
    if (pulled >= 16) return c.close()
    pulled++
    c.enqueue(new Uint8Array(4096).fill(97))
  },
})
const big = new Request("http://x", { method: "POST", body: stream, duplex: "half" })
ok("גוף גדול בלי כותרת אורך נדחה", (await readJson(big)) === null)
ok("והקריאה נעצרה באמצע, לא קראה הכול", pulled < 16, `נקראו ${pulled} מתוך 16 חתיכות`)
ok("JSON שבור נדחה", (await readJson(new Request("http://x", { method: "POST", body: "{nope" }))) === null)
ok("גוף ריק נדחה", (await readJson(new Request("http://x", { method: "POST", body: "" }))) === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
