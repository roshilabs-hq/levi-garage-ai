// גיבוי מקומי של הנתונים (5.10). בתוכנית החינמית של Supabase אין גיבוי יומי שאפשר
// לשחזר ממנו, וההמלצה שלהם היא לייצא בעצמך ולשמור מחוץ ל-Supabase.
//
// מה נשמר: כל טבלה ב-public כקובץ JSON, ורשימת הקבצים בשני הדליים (בלי הקבצים
// עצמם; עם --files גם הם יורדים). הסכימה לא נשמרת כאן: היא בריפו, במיגרציות
// (ראו RECOVERY.md). הסקריפט רק קורא, ולא משנה כלום במסד.
//
// הרצה, מתיקיית levi-garage:
//   node --env-file=.env.local scripts/backup.mjs            # נתונים ורשימת קבצים
//   node --env-file=.env.local scripts/backup.mjs --files    # גם התמונות וההקלטות
//
// הפלט: levi-garage/backups/<תאריך>/ (מחוץ לגיט: יש בו פרטים אישיים של לקוחות).

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error("חסר NEXT_PUBLIC_SUPABASE_URL או SUPABASE_SECRET_KEY (.env.local)")
const h = { apikey: key, authorization: `Bearer ${key}` }

const TABLES = [
  "approvals", "bookings", "customer_notices", "findings", "help_calls", "inspections", "job_cards", "job_moves",
  "media", "mentor_questions", "price_list", "quote_items", "quote_requests", "quote_versions", "staff",
  "station_pair_codes", "station_requests", "stations",
]
const BUCKETS = ["job-media", "shared-quotes"]

const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "_").replace(/:/g, "-")
const out = join(import.meta.dirname, "..", "backups", stamp)
mkdirSync(out, { recursive: true })

let total = 0
for (const t of TABLES) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { ...h, range: `${from}-${from + 999}` } })
    if (!res.ok) throw new Error(`${t}: ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  writeFileSync(join(out, `${t}.json`), JSON.stringify(rows, null, 1))
  total += rows.length
  console.log(`${t}: ${rows.length}`)
}

const withFiles = process.argv.includes("--files")
for (const b of BUCKETS) {
  const names = []
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${url}/storage/v1/object/list/${b}`, {
        method: "POST", headers: { ...h, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      })
      if (!res.ok) throw new Error(`list ${b}: ${res.status}`)
      const items = await res.json()
      for (const i of items) {
        const path = prefix ? `${prefix}/${i.name}` : i.name
        if (i.id === null) await walk(path)
        else names.push(path)
      }
      if (items.length < 1000) break
    }
  }
  await walk("")
  writeFileSync(join(out, `storage-${b}.json`), JSON.stringify(names, null, 1))
  console.log(`${b}: ${names.length} קבצים`)
  if (withFiles) {
    for (const n of names) {
      const res = await fetch(`${url}/storage/v1/object/${b}/${n}`, { headers: h })
      if (!res.ok) continue
      const file = join(out, "files", b, n)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    }
  }
}
console.log(`\nנשמרו ${total} שורות ב-${out}`)
