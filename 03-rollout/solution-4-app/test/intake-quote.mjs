// קבלת רכב עד "מוכן", בצד המסד (013, 015): מחירון, הצעת מחיר וגרסאותיה, בדיקת
// כניסה, קריאות מהעמדה, והעדכון שהלקוח מקבל אחרי שענה.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/intake-quote.mjs
//
// כל בדיקה מתחברת בזהות האמיתית (מנהל עבודה, מכונאי, מסך, אורח) ומנסה לקרוא
// ולכתוב, ובודקת במסד מה קרה בפועל — לא רק את קוד התשובה. שום מייל ושום
// וואטסאפ לא יוצאים: הבדיקה מדברת רק עם המסד. הכול נמחק בסוף.

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
async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}
const rpc = async (name, args, token = anonKey) => {
  const res = await call(`/rest/v1/rpc/${name}`, { method: "POST", token, body: JSON.stringify(args) })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}
const rows = async (path, token) => {
  const res = await call(path, { token })
  return res.ok ? await res.json() : []
}

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
const wall = await signIn("screen2@test.com")

let jobId = null
try {
  // ---------- 1. המחירון ----------
  const listMech = await rows(`/rest/v1/price_list?select=id,code,price_aftermarket,single_reason&active=eq.true`, mechanic)
  ok("מכונאי רואה את המחירון (לדעת מה אושר)", listMech.length >= 20, `${listMech.length}`)
  ok("לכל עבודה במחירון יש חלופה או הסבר למה אין (ס' 131)", listMech.every((r) => r.price_aftermarket !== null || r.single_reason))
  ok("מסך הסדנה לא רואה מחירים", (await rows(`/rest/v1/price_list?select=id`, wall)).length === 0)
  ok("אורח לא רואה מחירים", (await rows(`/rest/v1/price_list?select=id`)).length === 0)
  const bump = await call(`/rest/v1/price_list?code=eq.wipers`, {
    token: mechanic,
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ price_original: 1 }),
  })
  const wipers = (await (await service(`/rest/v1/price_list?code=eq.wipers&select=price_original`)).json())[0]
  ok("מכונאי לא יכול לשנות מחיר במחירון", Number(wipers?.price_original) === 180, `HTTP ${bump.status} → ${wipers?.price_original}`)

  // ---------- 2. כרטיס בדיקה ----------
  const [job] = await (
    await service(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        plate: "9999916",
        vehicle_make: "טויוטה",
        vehicle_model: "בדיקה",
        customer_name: "בדיקת הצעה",
        customer_phone: "+972500009930",
        customer_email: "quote-test@example.com",
        updates_consent_at: new Date().toISOString(),
        whatsapp_consent: true,
        status: "open",
        notes: "בדיקה אוטומטית של הצעת המחיר — נמחק בסוף",
      }),
    })
  ).json()
  jobId = job.id

  // ---------- 3. שורת ההצעה מהקבלה ----------
  const line = {
    job_card_id: jobId,
    title: "טיפול תקופתי קטן",
    labor_hours: 1,
    price_original: 650,
    price_aftermarket: 450,
    warranty_original: "6 חודשים",
    warranty_aftermarket: "6 חודשים",
    part_diff: "מקורי מול חלופי באותו תקן",
    part_choice: "aftermarket",
  }
  const mechLine = await call(`/rest/v1/quote_items`, { token: mechanic, method: "POST", body: JSON.stringify(line) })
  ok("מכונאי לא רושם שורה בהצעת המחיר", mechLine.status >= 400, `HTTP ${mechLine.status}`)
  const noDiff = await call(`/rest/v1/quote_items`, { token: manager, method: "POST", body: JSON.stringify({ ...line, part_diff: null }) })
  ok("שני סוגי חלקים בלי הסבר ההבדל — המסד מסרב (ס' 131)", noDiff.status >= 400, `HTTP ${noDiff.status}`)
  const mgrLine = await call(`/rest/v1/quote_items`, { token: manager, method: "POST", body: JSON.stringify(line) })
  ok("מנהל עבודה רושם את השורה מהקבלה", mgrLine.status === 201, `HTTP ${mgrLine.status}`)

  // ---------- 4. גרסאות ההצעה ----------
  let r = await rpc("start_quote_version", { p_job_id: jobId, p_reason: "intake", p_channel: "email" }, mechanic)
  ok("מכונאי לא מוציא הצעת מחיר", r.status >= 400, `HTTP ${r.status}`)
  r = await rpc("start_quote_version", { p_job_id: jobId, p_reason: "intake", p_channel: "email" }, manager)
  const v1 = r.body
  ok("הצעה ראשונה: גרסה 1, עם המייל ושורת הקבלה", v1?.version === 1 && v1?.email === "quote-test@example.com" && v1?.snapshot?.lines?.length === 1, JSON.stringify(r.body).slice(0, 160))
  r = await rpc("finish_quote_version", { p_id: v1?.id, p_status: "sent" }, manager)
  r = await rpc("start_quote_version", { p_job_id: jobId, p_reason: "update", p_channel: "print" }, manager)
  ok("גרסה מודפסת: גרסה 2, ונרשמת כיצאה", r.body?.version === 2)
  const versionsMgr = await rows(`/rest/v1/quote_versions?job_card_id=eq.${jobId}&select=version,status&order=version`, manager)
  ok("מנהל רואה את כל הגרסאות שיצאו", versionsMgr.length === 2 && versionsMgr.every((v) => v.status === "sent"), JSON.stringify(versionsMgr))
  ok("מכונאי לא רואה את גרסאות ההצעה", (await rows(`/rest/v1/quote_versions?job_card_id=eq.${jobId}&select=version`, mechanic)).length === 0)
  const forged = await call(`/rest/v1/quote_versions`, {
    token: manager,
    method: "POST",
    body: JSON.stringify({ job_card_id: jobId, version: 9, reason: "update", channel: "email", snapshot: {} }),
  })
  ok("אי אפשר לזייף גרסה ישירות, רק דרך הפונקציה", forged.status >= 400, `HTTP ${forged.status}`)

  // ---------- 5. בדיקת הכניסה ----------
  const insMech = await call(`/rest/v1/inspections`, {
    token: mechanic,
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ job_card_id: jobId, items: { brakes: { light: "red" } } }),
  })
  ok("מכונאי בעמדת האבחון רושם בדיקת כניסה", insMech.status < 300, `HTTP ${insMech.status}`)
  const insWall = await call(`/rest/v1/inspections?job_card_id=eq.${jobId}`, {
    token: wall,
    method: "PATCH",
    body: JSON.stringify({ items: { brakes: { light: "green" } } }),
  })
  const ins = (await (await service(`/rest/v1/inspections?job_card_id=eq.${jobId}&select=items`)).json())[0]
  ok("מסך הסדנה לא משנה בדיקת כניסה", ins?.items?.brakes?.light === "red", `HTTP ${insWall.status}`)

  // ---------- 6. "דניאל, בוא לעמדה" ----------
  const mechId = (await rows(`/rest/v1/staff?select=id&limit=1`, mechanic))[0]?.id
  const mgrId = (await rows(`/rest/v1/staff?select=id,full_name&full_name=eq.דניאל לוי`, manager))[0]?.id
  let hc = await call(`/rest/v1/help_calls`, { token: mechanic, method: "POST", body: JSON.stringify({ job_card_id: jobId, lift: 1, requested_by: mechId, kind: "help" }) })
  ok("מכונאי קורא לדניאל", hc.status === 201, `HTTP ${hc.status}`)
  hc = await call(`/rest/v1/help_calls`, { token: mechanic, method: "POST", body: JSON.stringify({ job_card_id: jobId, lift: 1, requested_by: mechId, kind: "help" }) })
  ok("לחיצה כפולה לא פותחת קריאה שנייה", hc.status >= 400, `HTTP ${hc.status}`)
  hc = await call(`/rest/v1/help_calls`, { token: mechanic, method: "POST", body: JSON.stringify({ job_card_id: jobId, lift: 1, requested_by: mgrId, kind: "done" }) })
  ok("מכונאי לא קורא בשם מישהו אחר", hc.status >= 400, `HTTP ${hc.status}`)
  await call(`/rest/v1/help_calls?job_card_id=eq.${jobId}`, { token: mechanic, method: "PATCH", body: JSON.stringify({ resolved_at: new Date().toISOString() }) })
  let open = await (await service(`/rest/v1/help_calls?job_card_id=eq.${jobId}&resolved_at=is.null&select=id`)).json()
  ok("מכונאי לא סוגר קריאה (רק דניאל או אבי)", open.length === 1)
  await call(`/rest/v1/help_calls?job_card_id=eq.${jobId}`, { token: manager, method: "PATCH", body: JSON.stringify({ resolved_at: new Date().toISOString() }) })
  open = await (await service(`/rest/v1/help_calls?job_card_id=eq.${jobId}&resolved_at=is.null&select=id`)).json()
  ok("דניאל סוגר את הקריאה", open.length === 0)

  // ---------- 7. ממצא, תשובת הלקוח, ועדכון ההצעה ----------
  const [finding] = await (
    await service(`/rest/v1/findings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        job_card_id: jobId,
        source: "intake",
        title: "רפידות בלם קדמיות",
        summary: "בדיקה",
        customer_text: "הרפידות הקדמיות שחוקות.",
        urgency: "red",
        safety: true,
        price_original: 780,
        price_aftermarket: 520,
        labor_hours: 1,
        warranty_original: "12 חודשים",
        warranty_aftermarket: "6 חודשים",
        part_diff: "מקורי מול חלופי בתקן אירופי",
        status: "draft",
      }),
    })
  ).json()
  r = await rpc("send_finding", { p_finding_id: finding.id, p_message: "הרפידות הקדמיות שחוקות.", p_channel: "link" }, manager)
  const token = r.body
  ok("מנהל שולח את הממצא ומקבל קישור", typeof token === "string" && /^[0-9a-f]{36}$/.test(token), JSON.stringify(r.body))

  r = await rpc("set_approval_photos", { p_token: token, p_paths: [`${token}/0.jpg`] }, mechanic)
  ok("מכונאי לא קובע אילו תמונות הלקוח רואה", r.status >= 400, `HTTP ${r.status}`)
  r = await rpc("set_approval_photos", { p_token: token, p_paths: [`${token}/0.jpg`, `${token}/1.jpg`] }, manager)

  const view = (await rpc("approval_view", { p_token: token })).body?.[0]
  ok(
    "הלקוח רואה שעות, אחריות לכל סוג, הבדל, בטיחות ותמונות",
    Number(view?.labor_hours) === 1 && view?.warranty_aftermarket === "6 חודשים" && view?.part_diff && view?.safety === true && view?.photo_paths?.length === 2,
    JSON.stringify(view).slice(0, 200),
  )

  r = await rpc("quote_update_for_token", { p_token: token })
  ok("לפני שהלקוח ענה — אין עדכון להצעה", r.body === null, JSON.stringify(r.body))
  await rpc("approval_decide", { p_token: token, p_decision: "approved", p_part_choice: "aftermarket" })
  r = await rpc("quote_update_for_token", { p_token: token })
  const upd = r.body
  ok(
    "אחרי התשובה: גרסה חדשה של ההצעה, עם מה שאושר ובאיזה מחיר",
    upd?.version === 3 && upd?.email === "quote-test@example.com" && upd?.snapshot?.findings?.[0]?.status === "approved" && Number(upd?.snapshot?.findings?.[0]?.price) === 520,
    JSON.stringify(upd).slice(0, 200),
  )
  r = await rpc("quote_update_for_token", { p_token: token })
  ok("העדכון יוצא פעם אחת לכל תשובה", r.body === null)
  await rpc("finish_quote_update", { p_token: "0".repeat(36), p_id: upd?.id, p_status: "sent" })
  let v3 = (await (await service(`/rest/v1/quote_versions?id=eq.${upd?.id}&select=status`)).json())[0]
  ok("טוקן אחר לא יכול לסמן את העדכון כנשלח", v3?.status === "pending", v3?.status)
  await rpc("finish_quote_update", { p_token: token, p_id: upd?.id, p_status: "sent" })
  v3 = (await (await service(`/rest/v1/quote_versions?id=eq.${upd?.id}&select=status`)).json())[0]
  ok("עם הטוקן של הלקוח — העדכון מסומן כנשלח", v3?.status === "sent", v3?.status)

  const staffSnap = (await rpc("quote_snapshot", { p_job_id: jobId }, mechanic)).body
  ok("מכונאי רואה את ההצעה (מה מותר לבצע)", staffSnap?.lines?.length === 1 && staffSnap?.findings?.length === 1)
  r = await rpc("quote_snapshot", { p_job_id: jobId })
  ok("אורח לא רואה הצעה של אף אחד", r.status >= 400 || r.body === null, `HTTP ${r.status}`)
} finally {
  if (jobId) {
    for (const t of ["help_calls", "quote_versions", "quote_items", "inspections", "customer_notices"]) {
      await service(`/rest/v1/${t}?job_card_id=eq.${jobId}`, { method: "DELETE" })
    }
    const del = await service(`/rest/v1/job_cards?id=eq.${jobId}`, { method: "DELETE" })
    console.log(del.ok ? "\n· כרטיס הבדיקה נמחק" : `\n✗ לא נמחק כרטיס הבדיקה ${jobId}: ${del.status}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
