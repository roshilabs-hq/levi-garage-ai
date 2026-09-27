// קובע את שם האירוע ב-Cal.com: הכותרת של מייל האישור ושל האירוע ביומן.
//
//   node 03-rollout/solution-3-agent/scripts/cal-event-name.mjs
//
// למה: ברירת המחדל של Cal.com היא "<שם סוג האירוע> עם <המארגן>", ויצא
// "מסירת רכב למוסך עם מוסך לוי ובניו" (נמצא בבדיקה מטלפון אמיתי, 27.9).
// אידמפוטנטי. דורש CAL_API_KEY בקובץ .env.wiring.local. המפתח לא מודפס.

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

const key = local.get("CAL_API_KEY")
if (!key) {
  console.error(`✗ חסר CAL_API_KEY ב-${localFile}`)
  process.exit(1)
}

const API = "https://api.cal.com/v2"
const SLUG = "drop-off"
const NAME = "מסירת רכב למוסך לוי ובניו"
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json", "cal-api-version": "2024-06-14" }

const list = await fetch(`${API}/event-types`, { headers })
if (!list.ok) {
  console.error("✗ קריאת סוגי האירועים נכשלה:", list.status, (await list.text()).slice(0, 200))
  process.exit(1)
}
const all = []
const walk = (x) => {
  if (Array.isArray(x)) x.forEach(walk)
  else if (x && typeof x === "object") {
    if (typeof x.slug === "string" && (typeof x.id === "number" || typeof x.id === "string")) all.push(x)
    Object.values(x).forEach(walk)
  }
}
walk((await list.json())?.data)
const ev = all.find((e) => e.slug === SLUG)
if (!ev) {
  console.error(`✗ לא נמצא סוג אירוע בשם ${SLUG}`)
  process.exit(1)
}
console.log(`סוג האירוע: ${ev.slug} (מזהה ${ev.id}) · שם כרגע: ${ev.customName || "(ברירת מחדל)"}`)
if (ev.customName === NAME) {
  console.log("✓ כבר מוגדר. לא נגעתי בכלום.")
  process.exit(0)
}

const put = await fetch(`${API}/event-types/${ev.id}`, { method: "PATCH", headers, body: JSON.stringify({ customName: NAME }) })
const text = await put.text()
if (!put.ok) {
  console.error("✗ העדכון נכשל:", put.status, text.slice(0, 300))
  process.exit(1)
}
console.log(`✓ מעכשיו הכותרת במייל וביומן: "${NAME}"`)
