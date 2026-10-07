// המדריך האינטראקטיבי (/training): כל הסבר בתוכן מוצא את הכפתור שלו בצילום האחרון.
// כשמסך משתנה וכפתור מקבל שם אחר, ההסבר שלו נעלם מהמדריך בשקט. הבדיקה הזו תופסת את זה.
//
// הרצה: node 03-rollout/solution-4-app/test/training.mjs
// (אחרי npm run capture ב-04-empower/capture, ו-node scripts/sync-training.mjs ב-levi-garage.)

import { readFileSync } from "node:fs"

import { ROLES } from "../../../levi-garage/lib/training/guide.ts"
import { matchGuide } from "../../../levi-garage/lib/training/match.ts"

const all = JSON.parse(readFileSync(new URL("../../../levi-garage/lib/training/hotspots.json", import.meta.url), "utf8"))
const { roles, missing } = matchGuide(ROLES, all)

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

ok("כל הסבר מצא את הכפתור שלו", missing.length === 0, missing.join(" | "))
for (const r of roles) {
  const spots = r.screens.reduce((a, s) => a + s.spots.length, 0)
  ok(`${r.name}: ${r.screens.length} מסכים, ${spots} כפתורים`, r.screens.length > 0)
  for (const s of r.screens) {
    const out = s.spots.filter((p) => p.x < 0 || p.y < 0 || p.x + p.w > 100.5 || p.y + p.h > 100.5)
    if (out.length) ok(`${s.id}: כל הנקודות בתוך התמונה`, false, out.map((p) => p.t).join(", "))
  }
}
const ids = roles.flatMap((r) => r.screens.map((s) => s.id))
ok("אין מסך כפול", new Set(ids).size === ids.length)

// ההדרכה למכונאים בערבית וברוסית (7.10): התרגום נבנה מהעברית הנוכחית. אם מישהו שינה מסך,
// את המדריך למכונאי או את השאלות הנפוצות בעמדה, ולא הריץ את scripts/translate-training.mjs,
// העובד דובר הערבית או הרוסית היה מקבל הדרכה ישנה.
const i18n = JSON.parse(readFileSync(new URL("../../../levi-garage/lib/training/i18n.json", import.meta.url), "utf8"))
const mech = ROLES.find((r) => r.id === "mechanic")
const stale = mech.screens.filter((s) => JSON.stringify(i18n.src[`screen:${s.id}`]) !== JSON.stringify({ title: s.title, intro: s.intro, spots: s.spots.map((p) => ({ t: p.t, b: p.b })) }))
ok("מסכי המכונאים מתורגמים מהגרסה הנוכחית", stale.length === 0, stale.map((s) => s.id).join(", "))
const guides = new URL("../../../04-empower/guides/", import.meta.url)
const mechMd = readFileSync(new URL("mechanic.md", guides), "utf8").replace(/\r\n/g, "\n").trim()
ok("המדריך למכונאי מתורגם מהגרסה הנוכחית", i18n.src["doc:mechanic"] === mechMd)
const faq = readFileSync(new URL("faq.md", guides), "utf8").replace(/\r\n/g, "\n")
const faqStation = faq.slice(faq.indexOf("## בעמדה (מכונאי)"), faq.indexOf("## בדלפק (דניאל)")).trim()
ok("השאלות הנפוצות בעמדה מתורגמות מהגרסה הנוכחית", i18n.src["doc:faq-station"] === faqStation)
for (const l of ["ar", "ru"]) {
  const bad = mech.screens.filter((s) => i18n[l][`screen:${s.id}`]?.spots?.length !== s.spots.length)
  ok(`${l}: לכל מסך של מכונאים תרגום, עם אותו מספר נקודות`, bad.length === 0, bad.map((s) => s.id).join(", "))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
