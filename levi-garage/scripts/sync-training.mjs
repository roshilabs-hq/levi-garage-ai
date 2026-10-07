// מעתיק את הצילומים ואת מיקומי הכפתורים מסקריפט הצילום אל המדריך האינטראקטיבי (/training).
// מריצים אחרי כל צילום מחדש (04-empower/capture: npm run capture), ואז פורסים.
//
//   node scripts/sync-training.mjs     (מתיקיית levi-garage)

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
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
// 1.5.0: המדריכים הכתובים, לבסיס הידע של "שאלה על המערכת". בלי שורות התמונות
// והקישורים בין הקבצים, שאין להם משמעות בתוך תשובה.
const DOCS = ["mechanic.md", "daniel.md", "avi.md", "screens.md", "faq.md"]
const NL = "\n"
const docs = DOCS.map((f) =>
  readFileSync(join(src, f), "utf8")
    .replace(/^!\[.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\r?\n){3,}/g, NL + NL)
    .trim(),
).join(`${NL}${NL}---${NL}${NL}`)
writeFileSync(
  join(root, "lib", "training", "docs.ts"),
  `// נוצר ב-scripts/sync-training.mjs מתוך 04-empower/guides. לא לערוך כאן.${NL}export const TRAINING_DOCS = ${JSON.stringify(docs)}${NL}`,
)
// 1.14.0: המדריכים הכתובים גם כדפים במרכז ההדרכה (/training/read/...), עם התמונות.
// התמונות כבר הועתקו ל-public/training. קישור בין מדריכים עובר לדף שלו באתר, וקישור לקובץ
// אחר בריפו עובר ל-GitHub.
const REPO = "https://github.com/roshilabs-hq/levi-garage-ai/blob/main/04-empower"
const READ = ["mechanic", "station-card", "daniel", "avi", "screens", "faq"]
const guides = Object.fromEntries(
  READ.map((id) => [
    id,
    readFileSync(join(src, `${id}.md`), "utf8")
      .replace(/\r\n/g, NL)
      .replace(/\]\(img\/([^)]+)\)/g, "](/training/$1)")
      .replace(/\]\(\.\.\/([^)]+)\)/g, `](${REPO}/$1)`)
      .replace(/\]\(([a-z-]+)\.md(#[^)]*)?\)/g, (_, f, h = "") => `](/training/read/${f}${h})`),
  ]),
)
// המדריך המלא לבוחנים (7.10, רועי: "למה מפנה ל-GIT?"): דף באתר, כמו שאר המדריכים. הוא יושב
// ב-04-empower ולא ב-guides, ולכן "../" שלו הוא שורש הריפו. קישור לאתר עצמו נשאר בתוך האתר.
guides.examiner = readFileSync(join(src, "..", "examiner-guide.md"), "utf8")
  .replace(/\r\n/g, NL)
  .replace(/\]\(\.\.\/([^)]+)\)/g, (_, f) => `](${REPO.replace(/\/blob\/main\/04-empower$/, f.endsWith("/") ? "/tree/main" : "/blob/main")}/${f})`)
  .replace(/\]\(https:\/\/levi-garage\.co\.il(\/[^)]*)\)/g, "]($1)")
writeFileSync(
  join(root, "lib", "training", "guides.ts"),
  `// נוצר ב-scripts/sync-training.mjs מתוך 04-empower/guides. לא לערוך כאן.${NL}export const GUIDES: Record<string, string> = ${JSON.stringify(guides, null, 1)}${NL}`,
)
console.log(`הועתקו ${n} צילומים, מיקומי הכפתורים, ו-${DOCS.length} מדריכים (ו-${READ.length} דפי מדריך).`)
