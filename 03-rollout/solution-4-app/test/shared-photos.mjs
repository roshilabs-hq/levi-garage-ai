// התמונות בדף האישור נסגרות יחד עם הקישור (049, בדיקת ציות 4.10).
// שני אישורים עם תמונה: אחד בתוקף ואחד שפג. אורח (בלי התחברות, כמו הלקוח) מבקש
// כתובת חתומה לכל אחד, ומנסה גם את הכתובת הציבורית הישנה. אם BASE מוגדר, נבדק
// גם שדף האישור עצמו מציג כתובת חתומה ולא ציבורית.
//
// הרצה: node --env-file=levi-garage/.env.local 03-rollout/solution-4-app/test/shared-photos.mjs
//       BASE=https://levi-garage.co.il ...   (גם הדף החי)
// הכול נמחק בסוף: הקבצים, האישורים, הממצאים והכרטיס.

import { randomBytes } from "node:crypto"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
const base = process.env.BASE
if (!url || !anonKey || !secret) throw new Error("חסרים משתני Supabase. להריץ עם --env-file=levi-garage/.env.local")

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

const service = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const guest = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const insert = async (table, row) => {
  const res = await service(`/rest/v1/${table}`, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row) })
  if (!res.ok) throw new Error(`insert ${table}: ${res.status} ${await res.text()}`)
  return (await res.json())[0]
}

// JPEG של פיקסל אחד.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
)

const now = Date.now()
const live = randomBytes(18).toString("hex")
const old = randomBytes(18).toString("hex")
let jobId = null
const paths = [`${live}/0.jpg`, `${old}/0.jpg`]

try {
  const job = await insert("job_cards", { plate: "9990049", status: "in_progress", notes: "רשומת בדיקה · 049", whatsapp_consent: false })
  jobId = job.id
  for (const [token, expires] of [
    [live, new Date(now + 7 * 86400000).toISOString()],
    [old, new Date(now - 86400000).toISOString()],
  ]) {
    const f = await insert("findings", {
      job_card_id: jobId, source: "pricelist", title: "בדיקה 049", summary: "בדיקה 049", customer_text: "בדיקה 049",
      status: "sent", urgency: "yellow", safety: false, price_original: 100, sent_at: new Date(now - 2 * 86400000).toISOString(),
    })
    await insert("approvals", {
      finding_id: f.id, token, channel: "link", message_text: "בדיקה 049",
      sent_at: new Date(now - 2 * 86400000).toISOString(), expires_at: expires, photo_paths: [`${token}/0.jpg`],
    })
  }
  // העלאה כמו שהאפליקציה עושה (מפתח שירות כאן, כי הבדיקה לא מתחברת כמנהל).
  for (const p of paths) {
    const res = await service(`/storage/v1/object/shared-quotes/${p}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: JPEG })
    if (!res.ok) throw new Error(`upload ${p}: ${res.status} ${await res.text()}`)
  }

  const bucket = await (await service(`/storage/v1/bucket/shared-quotes`)).json()
  ok("הדלי shared-quotes פרטי", bucket.public === false, `public=${bucket.public}`)

  const sign = (p) => guest(`/storage/v1/object/sign/shared-quotes/${p}`, { method: "POST", body: JSON.stringify({ expiresIn: 60 }) })

  // 1. בתוקף: אורח מקבל כתובת חתומה, והיא מחזירה את התמונה.
  const s1 = await sign(paths[0])
  const signed = s1.ok ? (await s1.json()).signedURL : null
  ok("קישור בתוקף: אורח מקבל כתובת חתומה", Boolean(signed), `${s1.status}`)
  if (signed) {
    const img = await fetch(`${url}/storage/v1${signed}`)
    ok("הכתובת החתומה מחזירה את התמונה", img.ok && (img.headers.get("content-type") || "").startsWith("image/"), `${img.status}`)
  }

  // 2. פג: אין כתובת חתומה.
  const s2 = await sign(paths[1])
  ok("קישור שפג: אין כתובת חתומה", !s2.ok, `${s2.status}`)

  // 3. תיקייה שלא קיימת.
  const s3 = await sign(`${randomBytes(18).toString("hex")}/0.jpg`)
  ok("טוקן מנוחש: אין כתובת חתומה", !s3.ok, `${s3.status}`)

  // 4. הכתובת הציבורית הישנה לא עובדת, גם לקישור בתוקף.
  for (const [name, p] of [["בתוקף", paths[0]], ["שפג", paths[1]]]) {
    const pub = await fetch(`${url}/storage/v1/object/public/shared-quotes/${p}`)
    ok(`כתובת ציבורית (${name}) חסומה`, !pub.ok, `${pub.status}`)
  }

  // 5. אורח לא מצליח לרשום את תוכן הדלי.
  const list = await guest(`/storage/v1/object/list/shared-quotes`, { method: "POST", body: JSON.stringify({ prefix: "", limit: 100 }) })
  const listed = list.ok ? await list.json() : []
  ok("אורח לא רואה את רשימת התיקיות", !listed.some((o) => o.name === live || o.name === old), `${list.status} ${listed.length}`)

  // 6. הדף עצמו (אם BASE מוגדר).
  if (base) {
    const html = await (await fetch(`${base}/approve/${live}`)).text()
    ok("דף האישור מציג כתובת חתומה", html.includes(`/storage/v1/object/sign/shared-quotes/${live}/0.jpg`))
    ok("דף האישור לא מציג כתובת ציבורית", !html.includes("/object/public/shared-quotes"))
    const html2 = await (await fetch(`${base}/approve/${old}`)).text()
    ok("קישור שפג: הדף בלי תמונות", !html2.includes(`shared-quotes/${old}`))
  }
} finally {
  await service(`/storage/v1/object/shared-quotes`, { method: "DELETE", body: JSON.stringify({ prefixes: paths }) })
  if (jobId) {
    const fs = await (await service(`/rest/v1/findings?job_card_id=eq.${jobId}&select=id`)).json()
    if (fs.length) await service(`/rest/v1/approvals?finding_id=in.(${fs.map((f) => f.id).join(",")})`, { method: "DELETE" })
    for (const t of ["findings", "job_moves"]) await service(`/rest/v1/${t}?job_card_id=eq.${jobId}`, { method: "DELETE" })
    const del = await service(`/rest/v1/job_cards?id=eq.${jobId}`, { method: "DELETE" })
    ok("ניקוי", del.ok)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
