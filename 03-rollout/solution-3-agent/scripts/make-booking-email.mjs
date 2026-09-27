// מעביר את המייל של הלקוח מ-Cal.com למסד (27.9).
//
//   node 03-rollout/solution-3-agent/scripts/make-booking-email.mjs
//
// למה: הצעת המחיר הראשונה חייבת לצאת "במסמך מודפס או בהודעת דואר
// אלקטרוני" (ס' 132(ב) לחוק רישוי שירותים ומקצועות בענף הרכב). Cal.com מבקש
// מייל בכל תור, ו-Make לא העביר אותו. כאן: משתנה customer_email במודול 3,
// ושדה באותו שם בגוף הבקשה של מודול 4 (מבנה הנתונים 595092 עודכן דרך ה-MCP).
//
// כמו שאר הסקריפטים כאן: לא מדפיס את התרחיש, שיש בו את הסיסמה של
// intake_booking. אידמפוטנטי. דורש MAKE_API_TOKEN ב-.env.wiring.local.

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
const EMAIL_VALUE = "{{ifempty(1.payload.responses.email.value; 1.payload.attendees[1].email)}}"

const read = async () => {
  const res = await fetch(`${ZONE}/scenarios/${SCENARIO}/blueprint`, { headers })
  if (!res.ok) throw new Error(`קריאת התרחיש נכשלה: ${res.status}`)
  const json = await res.json()
  return json?.response?.blueprint ?? json?.blueprint
}

const blueprint = await read()
const vars = blueprint.flow.find((m) => m.id === 3)
const call = blueprint.flow.find((m) => m.id === 4)
if (!vars?.mapper?.variables || !call?.mapper?.dataStructureBodyContent?.p) {
  console.error("✗ המבנה של התרחיש לא כמו שציפיתי. לא נגעתי בכלום.")
  process.exit(1)
}

const hasVar = vars.mapper.variables.some((v) => v.name === "customer_email")
const hasField = call.mapper.dataStructureBodyContent.p.customer_email === "{{3.customer_email}}"
console.log(`לפני: משתנה customer_email=${hasVar ? "יש" : "אין"} · בגוף הבקשה=${hasField ? "יש" : "אין"} · dlq=${blueprint.metadata?.scenario?.dlq}`)
if (hasVar && hasField) {
  console.log("✓ כבר מוגדר. לא נגעתי בכלום.")
  process.exit(0)
}

if (!hasVar) vars.mapper.variables.push({ name: "customer_email", value: EMAIL_VALUE })
if (!hasField) call.mapper.dataStructureBodyContent.p.customer_email = "{{3.customer_email}}"

const put = await fetch(`${ZONE}/scenarios/${SCENARIO}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ blueprint: JSON.stringify(blueprint) }),
})
if (!put.ok) {
  console.error("✗ השמירה נכשלה:", put.status, (await put.text()).slice(0, 200))
  process.exit(1)
}

const after = await read()
const ok =
  after.flow.find((m) => m.id === 3)?.mapper?.variables?.some((v) => v.name === "customer_email") &&
  after.flow.find((m) => m.id === 4)?.mapper?.dataStructureBodyContent?.p?.customer_email === "{{3.customer_email}}"
console.log(`אחרי: ${ok ? "שני השינויים במקום" : "משהו לא נשמר"} · dlq=${after.metadata?.scenario?.dlq}`)
process.exit(ok ? 0 : 1)
