// מונע מתרחיש קליטת התורים ב-Make לכבות את עצמו בשקט.
//
//   node 03-rollout/solution-3-agent/scripts/make-keep-alive.mjs
//
// מה קרה (26.9–27.9): הרצה אחת נכשלה (ביטול בלי מספר רישוי), ו-Make כיבה את
// כל התרחיש. בתרחיש שמתחיל ב-Webhook, כשאחסון ההרצות שלא הושלמו כבוי (dlq),
// שגיאה אחת מכבה אותו. מאז כל תור חדש נתקע בתור של ה-Webhook, יום וחצי, ואף
// אחד לא ידע — עד שבדיקה מטלפון אמיתי לא הגיעה למסד.
//
// התיקון: dlq=true. הרצה שנכשלת נשמרת ב-Make כ"לא הושלמה" (אפשר להריץ אותה
// שוב), והתרחיש ממשיך לקלוט את התורים הבאים.
//
// כמו make-allow-cancel: קורא את התרחיש, משנה הגדרה אחת, שומר — ולא מדפיס את
// התרחיש, שיש בו את הסיסמה של intake_booking. דורש MAKE_API_TOKEN ב-.env.wiring.local.

import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const localFile = resolve(here, "../.env.wiring.local")
const local = new Map()
if (existsSync(localFile)) {
  for (const line of readFileSync(localFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) local.set(m[1], m[2].trim())
  }
}
const token = local.get("MAKE_API_TOKEN")
if (!token) {
  console.error(`✗ חסר MAKE_API_TOKEN ב-${localFile}`)
  process.exit(1)
}

const ZONE = "https://eu1.make.com/api/v2"
const SCENARIO = 7538765
const headers = { authorization: `Token ${token}`, "content-type": "application/json" }

const read = async () => {
  const res = await fetch(`${ZONE}/scenarios/${SCENARIO}/blueprint`, { headers })
  if (!res.ok) throw new Error(`קריאת התרחיש נכשלה: ${res.status}`)
  const json = await res.json()
  return json?.response?.blueprint ?? json?.blueprint
}

const blueprint = await read()
const settings = blueprint?.metadata?.scenario
if (!settings) {
  console.error("✗ לא נמצאו הגדרות התרחיש")
  process.exit(1)
}
console.log(`לפני: שמירת הרצות שנכשלו=${settings.dlq} · רצף=${settings.sequential} · שגיאות עד כיבוי=${settings.maxErrors}`)
if (settings.dlq === true) {
  console.log("✓ כבר מוגדר. לא נגעתי בכלום.")
  process.exit(0)
}

settings.dlq = true
const put = await fetch(`${ZONE}/scenarios/${SCENARIO}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ blueprint: JSON.stringify(blueprint) }),
})
if (!put.ok) {
  console.error("✗ השמירה נכשלה:", put.status, (await put.text()).slice(0, 200))
  process.exit(1)
}
const after = (await read())?.metadata?.scenario
console.log(`אחרי: שמירת הרצות שנכשלו=${after?.dlq}`)
if (after?.dlq !== true) {
  console.error("✗ Make קיבל את השמירה אבל ההגדרה לא השתנתה")
  process.exit(1)
}
console.log("✓ הרצה שנכשלת נשמרת להרצה חוזרת, והתרחיש ממשיך לקלוט תורים.")
