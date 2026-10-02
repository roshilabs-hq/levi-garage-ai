// "המוסכניק הוותיק" בעמדה משתמש באותו מוח כמו ה-Gem (פתרון 1): אותן הנחיות, אותה
// רשימה אדומה, אותו בסיס ידע. מקור האמת הוא התיקייה של פתרון 1, והסקריפט הזה מעתיק
// אותה לקוד, כי Vercel בונה רק את levi-garage. כשדניאל מעדכן את בסיס הידע של ה-Gem:
//
//   node levi-garage/scripts/sync-mentor-brain.mjs
//
// ואז פריסה. כך שני הערוצים לא מתרחקים זה מזה.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const gem = resolve(here, "../../03-rollout/solution-1-gem")
const read = (p) => readFileSync(resolve(gem, p), "utf8").replace(/\r\n/g, "\n").trim()

const out = `// נוצר אוטומטית מ-03-rollout/solution-1-gem על ידי scripts/sync-mentor-brain.mjs. לא לערוך ידנית.
export const INSTRUCTIONS = ${JSON.stringify(read("gem-instructions.md"))}
export const RED_LIST = ${JSON.stringify(read("knowledge/red-list.md"))}
export const KNOWLEDGE = ${JSON.stringify(read("knowledge/garage-knowledge.md"))}
`
const target = resolve(here, "../lib/mentor/brain.generated.ts")
writeFileSync(target, out, "utf8")
console.log(`נכתב ${target} (${out.length} תווים)`)
