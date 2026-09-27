// השער החוקי על שליחת הצעה ללקוח (014): הצעה חסרה לא יוצאת.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/law-gate.mjs
//
// חוק רישוי שירותים ומקצועות בענף הרכב, התשע"ו-2016:
//   ס' 132(א)(1) — מחיר, שעות עבודה צפויות, היקף אחריות.
//   ס' 131       — יותר מסוג חלק אחד והסבר ההבדל, או הסבר למה אין חלופה.
//   ס' 132(ב)    — עדכון באמצעי אלקטרוני רק בהסכמת הלקוח.
// כל מקרה נבדק מול המסד בזהות של מנהל העבודה, ובודקים גם שלא נוצר קישור.

import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secret = process.env.SUPABASE_SECRET_KEY
const password = process.env.STAFF_DEMO_PASSWORD
if (!password) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")

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
const call = (path, { token = anonKey, ...init } = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const service = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const signIn = async (email) =>
  (await (await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })).json()).access_token
const send = async (findingId, token) => {
  const res = await call(`/rest/v1/rpc/send_finding`, {
    token,
    method: "POST",
    body: JSON.stringify({ p_finding_id: findingId, p_message: "בדיקה", p_channel: "link" }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const hasLink = async (findingId) => (await (await service(`/rest/v1/approvals?finding_id=eq.${findingId}&select=id`)).json()).length > 0

const manager = await signIn("test1@test.com")
const COMPLETE = {
  price_original: 780,
  price_aftermarket: 520,
  labor_hours: 1,
  warranty_original: "12 חודשים",
  warranty_aftermarket: "6 חודשים",
  part_diff: "מקורי מול חלופי",
}

const jobs = []
async function job(fields) {
  const [row] = await (
    await service(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ plate: "9999915", status: "in_progress", notes: "בדיקת השער החוקי — נמחק בסוף", ...fields }),
    })
  ).json()
  jobs.push(row.id)
  return row
}
async function finding(jobId, fields) {
  const [row] = await (
    await service(`/rest/v1/findings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ job_card_id: jobId, source: "manual", summary: "בדיקה", customer_text: "בדיקה", status: "draft", ...fields }),
    })
  ).json()
  return row
}

try {
  const consented = await job({ updates_consent_at: new Date().toISOString() })

  const cases = [
    ["בלי שעות עבודה", { ...COMPLETE, labor_hours: null }, "law-132a"],
    ["בלי אחריות", { ...COMPLETE, warranty_original: null }, "law-132a"],
    ["בלי מחיר", { ...COMPLETE, price_original: null }, "law-132a"],
    ["סוג חלק אחד בלי הסבר למה", { ...COMPLETE, price_aftermarket: null, warranty_aftermarket: null, part_diff: null }, "law-131"],
    ["שני סוגים בלי הסבר ההבדל", { ...COMPLETE, part_diff: null }, "law-131"],
    ["שני סוגים בלי אחריות לחלופי", { ...COMPLETE, warranty_aftermarket: null }, "law-131"],
  ]
  for (const [name, fields, hint] of cases) {
    const f = await finding(consented.id, fields)
    const r = await send(f.id, manager)
    ok(`${name}: לא יוצא (${hint})`, r.status >= 400 && r.body?.hint === hint && !(await hasLink(f.id)), `HTTP ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`)
  }

  const single = await finding(consented.id, { ...COMPLETE, price_aftermarket: null, warranty_aftermarket: null, part_diff: null, single_reason: "סוג גז אחד בלבד" })
  let r = await send(single.id, manager)
  ok("סוג אחד עם הסבר למה אין חלופה: יוצא", r.status === 200 && (await hasLink(single.id)), `HTTP ${r.status}`)

  const full = await finding(consented.id, COMPLETE)
  r = await send(full.id, manager)
  ok("הצעה שלמה: יוצאת", r.status === 200 && (await hasLink(full.id)), `HTTP ${r.status}`)

  const noConsent = await job({ whatsapp_consent: false, updates_consent_at: null })
  const nc = await finding(noConsent.id, COMPLETE)
  r = await send(nc.id, manager)
  ok("לקוח שלא הסכים לעדכונים אלקטרוניים: לא יוצא (law-132b)", r.status >= 400 && r.body?.hint === "law-132b" && !(await hasLink(nc.id)), `HTTP ${r.status}`)

  const waOnly = await job({ whatsapp_consent: true, updates_consent_at: null })
  const wa = await finding(waOnly.id, COMPLETE)
  r = await send(wa.id, manager)
  ok("הסכמה לוואטסאפ מהתור נחשבת הסכמה לעדכון", r.status === 200, `HTTP ${r.status}`)
} finally {
  for (const id of jobs) {
    await service(`/rest/v1/customer_notices?job_card_id=eq.${id}`, { method: "DELETE" })
    await service(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
