// מעתיק את הצילומים ואת מיקומי הכפתורים מסקריפט הצילום אל המדריך האינטראקטיבי (/training).
// מריצים אחרי כל צילום מחדש (04-empower/capture: npm run capture), ואז פורסים.
//
//   node scripts/sync-training.mjs     (מתיקיית levi-garage)

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const src = join(root, "..", "04-empower", "guides")
const img = join(root, "public", "training")
mkdirSync(img, { recursive: true })

let n = 0
for (const f of readdirSync(join(src, "img"))) {
  if (!f.endsWith(".png")) continue
  copyFileSync(join(src, "img", f), join(img, f))
  n++
}
const hs = join(src, "hotspots.json")
if (!existsSync(hs)) throw new Error("חסר 04-empower/guides/hotspots.json. להריץ קודם את סקריפט הצילום.")
copyFileSync(hs, join(root, "lib", "training", "hotspots.json"))
console.log(`הועתקו ${n} צילומים ומיקומי הכפתורים.`)
