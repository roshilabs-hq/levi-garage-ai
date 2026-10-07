// ההדרכה של המכונאים בערבית וברוסית (7.10, ביקורת חיצונית על ההדרכה: "דווקא התוכן שעובד דובר
// ערבית או רוסית יפתח כשהוא תקוע נשאר בעברית"). מתרגם, דרך Gemini ב-Vertex:
//   · את מסכי המכונאים במפת הכפתורים (lib/training/guide.ts): כותרת, פתיח, וכל נקודה
//   · את המדריך למכונאי (04-empower/guides/mechanic.md)
//   · את הסעיף "בעמדה (מכונאי)" בשאלות הנפוצות (04-empower/guides/faq.md)
// שמות הכפתורים נשארים בעברית, בדיוק כמו במסך, ולידם תרגום בסוגריים, כמו בכרטיס העמדה.
//
//   GEMINI_SA=gcp-sa.json node scripts/translate-training.mjs   (מתיקיית levi-garage)
//   →  lib/training/i18n.json. רק מה שהשתנה בעברית מתורגם מחדש.
import crypto from "node:crypto"
import fs from "node:fs"
import { join } from "node:path"

import { ROLES } from "../lib/training/guide.ts"

const root = join(import.meta.dirname, "..")
const OUT = join(root, "lib", "training", "i18n.json")
const G = join(root, "..", "04-empower", "guides")
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { src: {}, ar: {}, ru: {} }

const sa = JSON.parse(fs.readFileSync(process.env.GEMINI_SA, "utf8"))
const now = Math.floor(Date.now() / 1000)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`
const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")
const { access_token: token } = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) })).json()

const GLOSSARY = `Audience: car mechanics in a family garage in Israel. Arabic: simple Modern Standard Arabic, as spoken to mechanics in Israel. Russian: simple, as spoken to mechanics in Israel.
Glossary (keep consistent):
- ליפט = Arabic: رافعة · Russian: подъёмник
- עמדה (the fixed phone/tablet next to a lift) = Arabic: محطة · Russian: станция
- ממצא (something the mechanic found in the car) = Arabic: عطل · Russian: находка
- המוסכניק הוותיק = Arabic: الميكانيكي المخضرم · Russian: опытный механик
- קוד (the personal 6-digit code) = Arabic: رمز · Russian: код
- דניאל = دانيال / Даниэль; אבי = آفي / Ави; מוטי = موطي / Моти; סאמר = سامر / Самер; אלכס = أليكس / Алекс; נועם = نوعام / Ноам; רועי = روعي / Рои
- Keep emoji and symbols (✓ ⏳ 📝 ✗ ⚠️ 🧰) exactly as they are.
- BUTTON NAMES: any text in double quotes or in **bold quotes** that is the name of a button on the screen stays in Hebrew, exactly as written, followed by its translation in parentheses. Example (Arabic): "להוריד מהליפט לחניה" (أنزل من الرافعة إلى الموقف). Example (Russian): "להוריד מהליפט לחניה" (снять с подъёмника на стоянку).
- Keep numbers, times and URLs as they are. Keep Markdown formatting (headings, bold, lists, tables, images, links) exactly; translate only the visible text.`

async function ask(prompt) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/gemini-2.5-pro:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    })
    const j = await res.json()
    try {
      return JSON.parse(j.candidates[0].content.parts[0].text)
    } catch (e) {
      console.log(`נסיון ${attempt} נכשל: ${e.message ?? j.error?.message}`)
    }
  }
  throw new Error("התרגום נכשל")
}

const out = { src: {}, ar: {}, ru: {} }
const same = (key, he) => JSON.stringify(prev.src[key]) === JSON.stringify(he) && prev.ar[key] && prev.ru[key]

// ---------------------------------------------------------------- מסכי המכונאים
const mech = ROLES.find((r) => r.id === "mechanic")
for (const s of mech.screens) {
  const he = { title: s.title, intro: s.intro, spots: s.spots.map((p) => ({ t: p.t, b: p.b })) }
  const key = `screen:${s.id}`
  out.src[key] = he
  if (same(key, he)) {
    out.ar[key] = prev.ar[key]
    out.ru[key] = prev.ru[key]
    continue
  }
  const t = await ask(`Translate this screen guide (JSON) from Hebrew into Arabic and Russian.
Return JSON {"ar": <same shape>, "ru": <same shape>}, with the same keys and exactly ${he.spots.length} items in "spots", same order.
"t" is a short label, "b" is the explanation.
${GLOSSARY}

${JSON.stringify(he, null, 1)}`)
  if (t.ar?.spots?.length !== he.spots.length || t.ru?.spots?.length !== he.spots.length) throw new Error(`${s.id}: מספר נקודות לא תואם`)
  out.ar[key] = t.ar
  out.ru[key] = t.ru
  console.log(`ok ${s.id} · ${he.spots.length} נקודות`)
}

// ---------------------------------------------------------------- המדריך למכונאי, והשאלות הנפוצות בעמדה
const faq = fs.readFileSync(join(G, "faq.md"), "utf8").replace(/\r\n/g, "\n")
const faqStation = faq.slice(faq.indexOf("## בעמדה (מכונאי)"), faq.indexOf("## בדלפק (דניאל)")).trim()
const docs = {
  "doc:mechanic": fs.readFileSync(join(G, "mechanic.md"), "utf8").replace(/\r\n/g, "\n").trim(),
  "doc:faq-station": faqStation,
}
for (const [key, he] of Object.entries(docs)) {
  out.src[key] = he
  if (same(key, he)) {
    out.ar[key] = prev.ar[key]
    out.ru[key] = prev.ru[key]
    continue
  }
  const t = await ask(`Translate this Markdown guide from Hebrew into Arabic and into Russian.
Return JSON {"ar": "<the full Markdown in Arabic>", "ru": "<the full Markdown in Russian>"}.
Keep every heading, list item, table row, image line and link. Do not summarize or drop anything.
${GLOSSARY}

${he}`)
  if (typeof t.ar !== "string" || typeof t.ru !== "string") throw new Error(`${key}: לא חזר טקסט`)
  out.ar[key] = t.ar
  out.ru[key] = t.ru
  console.log(`ok ${key}`)
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
console.log(`נכתב ${OUT}`)
