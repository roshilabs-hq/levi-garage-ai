// בודק את קריאת גוף הבקשה לבוטים (lib/site/body.ts, ביקורת אבטחה שישית, ממצא 3): גוף גדול נעצר בזמן
// הקריאה, גם בלי כותרת אורך, ולא נקרא כולו לזיכרון. בלי רשת.
//
// הרצה: node 03-rollout/solution-4-app/test/body.mjs

const { readJson, readForm, MAX_BODY } = await import("../../../levi-garage/lib/site/body.ts")

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

// טופס עם קובץ (readForm, ביקורת שביעית, ממצא 6)
const smallForm = new FormData()
smallForm.append("job_id", "7")
smallForm.append("photo", new Blob([new Uint8Array(2048).fill(1)], { type: "image/jpeg" }), "p.jpg")
const smallReq = new Request("http://x", { method: "POST", body: smallForm })
const parsed = await readForm(smallReq, 64 * 1024)
ok("טופס קטן נקרא, עם הקובץ", parsed?.get("job_id") === "7" && parsed?.get("photo") instanceof Blob && parsed.get("photo").size === 2048)
const bigForm = new FormData()
bigForm.append("photo", new Blob([new Uint8Array(200 * 1024).fill(1)], { type: "image/jpeg" }), "p.jpg")
ok("טופס מעל התקרה נדחה (גוף טופס מגיע בלי כותרת אורך)", (await readForm(new Request("http://x", { method: "POST", body: bigForm }), 64 * 1024)) === null)
// אותו טופס, בזרם בלי כותרת אורך: נעצר באמצע
const bigBytes = new Uint8Array(await new Request("http://x", { method: "POST", body: bigForm }).arrayBuffer())
const type = new Request("http://x", { method: "POST", body: bigForm }).headers.get("content-type")
let fed = 0
const formStream = new ReadableStream({
  pull(c) {
    if (fed >= bigBytes.length) return c.close()
    c.enqueue(bigBytes.slice(fed, fed + 4096))
    fed += 4096
  },
})
const streamed = new Request("http://x", { method: "POST", body: formStream, duplex: "half", headers: { "content-type": type } })
ok("טופס גדול בלי כותרת אורך נדחה", (await readForm(streamed, 64 * 1024)) === null)
ok("והקריאה נעצרה לפני הסוף", fed < bigBytes.length, `נקראו ${fed} מתוך ${bigBytes.length}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
