// בודק את התיקונים של גרסה 1.1.0 (ההרצה של 4.10, מיגרציות 041–042) מול המסד האמיתי.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-4-app/test/v110.mjs
//
// מה נבדק: "הסר" מבטל את ההסכמה לוואטסאפ בתור ובכרטיס, ו"אשמח לקבל עדכונים"
// מחזיר אותה; רק הודעה שכולה "הסר" נתפסת; דניאל ואבי מוסיפים ממצא מהמחירון;
// ובקשת הנחה מעל 10%: מי מבקש, מי מחליט, מה נרשם, ומה קורה אחרי שליחה.
//
// כל מה שנוצר כאן נמחק בסוף, גם אם בדיקה נכשלה.

import crypto from "node:crypto"
import fs from "node:fs"
import { passwordFor } from "./_auth.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY
const botToken = process.env.GARAGE_BOT_TOKEN
if (!serviceKey) throw new Error("חסר SUPABASE_SECRET_KEY (levi-garage/.env.local)")
if (!botToken) throw new Error("חסר GARAGE_BOT_TOKEN (03-rollout/solution-3-agent/.env.wiring.local)")

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

const call = (path, { token = anonKey, key = anonKey, ...init } = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
const rpcJson = async (fn, body, token) => (await rpc(fn, body, token)).json()
const hintOf = async (res) => (res.ok ? "ok" : ((await res.json()).hint ?? `status ${res.status}`))

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  const j = await res.json()
  return { token: j.access_token, id: j.user.id }
}

// אותו מזהה שהבוט שולח: 'wa-' ו-16 תווים ראשונים של HMAC על המספר הבינלאומי.
const clientId = (phone) => "wa-" + crypto.createHmac("sha256", botToken).update("972" + phone.replace(/\D/g, "").slice(1)).digest("hex").slice(0, 16)

const manager = await signIn("test1@test.com")
const owner = await signIn("test3@test.com")
const mechanic = await signIn("test5@test.com")
const NOTE = "רשומת בדיקה אוטומטית (v110)"
const PHONE = "0500000411"
const bookings = []
const jobs = []
const finding = async (id) => (await (await admin(`/rest/v1/findings?id=eq.${id}&select=*`)).json())[0]
const bookingRow = async (id) => (await (await admin(`/rest/v1/bookings?id=eq.${id}&select=whatsapp_consent,whatsapp_revoked_at`)).json())[0]
const jobRow = async (id) => (await (await admin(`/rest/v1/job_cards?id=eq.${id}&select=whatsapp_consent,whatsapp_revoked_at,updates_consent_at`)).json())[0]

try {
  // 1. "הסר" (041)
  const [b] = await (
    await admin(`/rest/v1/bookings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        cal_uid: "v110test" + crypto.randomBytes(10).toString("hex"), status: "booked", drop_off_at: new Date(Date.now() + 86400e3).toISOString(),
        customer_name: "בדיקה 1.1.0", customer_phone: PHONE, whatsapp_consent: true, plate: "7360411", notes: NOTE,
      }),
    })
  ).json()
  bookings.push(b.id)
  const [j] = await (
    await admin(`/rest/v1/job_cards`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        booking_id: b.id, plate: "7360411", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "בדיקה 1.1.0",
        customer_phone: PHONE, status: "open", whatsapp_consent: true, updates_consent_at: new Date().toISOString(), notes: NOTE,
      }),
    })
  ).json()
  jobs.push(j.id)

  const bad = await rpc("revoke_whatsapp_consent", { p_secret: "wrong", p_client: clientId(PHONE) })
  ok("הסר: בלי הטוקן של הבוט, נדחה", !bad.ok, `status ${bad.status}`)
  ok("הסר: מזהה לא תקין, אפס שורות", (await rpcJson("revoke_whatsapp_consent", { p_secret: botToken, p_client: "0500000411" })) === 0)
  const other = await rpcJson("revoke_whatsapp_consent", { p_secret: botToken, p_client: clientId("0500000999") })
  ok("הסר ממספר אחר: לא נוגע בלקוח הזה", other === 0 && (await bookingRow(b.id)).whatsapp_consent === true, String(other))

  const n = await rpcJson("revoke_whatsapp_consent", { p_secret: botToken, p_client: clientId(PHONE) })
  const br = await bookingRow(b.id)
  const jr = await jobRow(j.id)
  ok("הסר: בוטל בתור ובכרטיס (2 שורות)", n === 2 && br.whatsapp_consent === false && jr.whatsapp_consent === false, `${n} ${JSON.stringify([br, jr])}`)
  ok("הסר: נרשם מתי ביקש", Boolean(br.whatsapp_revoked_at && jr.whatsapp_revoked_at))
  ok("הסר: ההסכמה למייל (מהדלפק) לא נמחקה", Boolean(jr.updates_consent_at))
  ok("הסר פעם שנייה: אין מה לבטל", (await rpcJson("revoke_whatsapp_consent", { p_secret: botToken, p_client: clientId(PHONE) })) === 0)
  const back = await rpcJson("grant_whatsapp_consent", { p_secret: botToken, p_client: clientId(PHONE) })
  ok("\"אשמח לקבל עדכונים\" מחזיר את ההסכמה", back === 2 && (await bookingRow(b.id)).whatsapp_consent === true, String(back))

  // 2. מה נחשב "הסר" (lib/site/consent.ts)
  const root = new URL("../../../levi-garage/", import.meta.url)
  const consentTs = fs.readFileSync(new URL("lib/site/consent.ts", root), "utf8")
  const remove = [...consentTs.slice(consentTs.indexOf("const REMOVE")).split("]")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase())
  const wants = (t) => remove.includes(t.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?,"'״׳🙂]/g, "").trim())
  ok("\"הסר\", \"הסר!\" ו\"STOP\" נתפסים", wants("הסר") && wants("הסר!") && wants("STOP"))
  ok("\"הסרתי את הגלגל\" ו\"איך מסירים?\" לא נתפסים", !wants("הסרתי את הגלגל") && !wants("איך מסירים?"))
  ok("יש תשובה קבועה בשלוש שפות", /REMOVED_REPLY[\s\S]*he:[\s\S]*ar:[\s\S]*ru:/.test(consentTs))

  // 3. "+ ממצא" מהכרטיס: דניאל ואבי (ה-RPC של העמדה)
  const [brakes] = await (await admin(`/rest/v1/price_list?code=eq.brakes-front-pads&select=id,price_original,price_aftermarket`)).json()
  const [wipers] = await (await admin(`/rest/v1/price_list?code=eq.wipers&select=id`)).json()
  const add1 = await rpcJson("add_price_list_finding", { p_job_id: j.id, p_price_list_id: brakes.id }, manager.token)
  const add2 = await rpcJson("add_price_list_finding", { p_job_id: j.id, p_price_list_id: wipers.id }, owner.token)
  ok("דניאל מוסיף ממצא מהמחירון", Number(add1?.finding_id) > 0, JSON.stringify(add1))
  ok("אבי מוסיף ממצא מהמחירון", Number(add2?.finding_id) > 0, JSON.stringify(add2))
  const fid = add1.finding_id

  // 4. בקשת הנחה (042)
  const ask = (who, pct, reason) => rpc("request_discount", { p_finding_id: fid, p_pct: pct, p_reason: reason }, who.token)
  ok("בקשה בלי סיבה: נחסמת", (await hintOf(await ask(manager, 20, " "))) === "discount-reason")
  ok("בקשה ל-12%: נחסמת (15–30 בלבד)", (await hintOf(await ask(manager, 12, "בדיקה"))) === "discount-request-pct")
  ok("אבי לא מבקש מעצמו", (await hintOf(await ask(owner, 20, "בדיקה"))) === "discount-role")
  ok("מכונאי לא מבקש", (await hintOf(await ask(mechanic, 20, "בדיקה"))) === "discount-role")
  ok("דניאל מבקש 20% עם סיבה", (await hintOf(await ask(manager, 20, "לקוח ותיק"))) === "ok")
  let f = await finding(fid)
  ok("נרשמו: אחוז, סיבה, מי ביקש ומתי", Number(f.discount_request_pct) === 20 && f.discount_request_reason === "לקוח ותיק" && f.discount_request_by === manager.id && f.discount_request_at)
  ok("לפני ההחלטה: המחיר לא השתנה", Number(f.discount_pct) === 0 && Number(f.price_original) === Number(brakes.price_original))

  const decide = (who, approve) => rpc("decide_discount", { p_finding_id: fid, p_approve: approve }, who.token)
  ok("דניאל לא מאשר לעצמו", (await hintOf(await decide(manager, true))) === "discount-owner")
  ok("מכונאי לא מאשר", (await hintOf(await decide(mechanic, true))) === "discount-owner")
  ok("אבי מאשר", (await hintOf(await decide(owner, true))) === "ok")
  f = await finding(fid)
  ok("אחרי האישור: 20%, המחיר ירד, והסיבה נשמרה", Number(f.discount_pct) === 20 && Number(f.price_original) === Math.round(brakes.price_original * 0.8) && Number(f.price_aftermarket) === Math.round(brakes.price_aftermarket * 0.8) && f.discount_reason === "לקוח ותיק", JSON.stringify([f.discount_pct, f.price_original, f.price_aftermarket]))
  ok("ההנחה רשומה על אבי, והבקשה נסגרה", f.discount_by === owner.id && f.discount_request_at === null && f.discount_request_pct === null)
  ok("אישור פעם שנייה: אין בקשה", (await hintOf(await decide(owner, true))) === "discount-no-request")

  await ask(manager, 30, "עוד בדיקה")
  ok("אבי דוחה", (await hintOf(await decide(owner, false))) === "ok")
  f = await finding(fid)
  ok("אחרי דחייה: נשאר 20%, והבקשה נסגרה", Number(f.discount_pct) === 20 && f.discount_request_at === null)

  await ask(manager, 25, "לבטל")
  ok("דניאל מבטל בקשה", (await rpc("cancel_discount_request", { p_finding_id: fid }, manager.token)).ok && (await finding(fid)).discount_request_at === null)

  await admin(`/rest/v1/findings?id=eq.${fid}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) })
  ok("אחרי שנשלח ללקוח: אי אפשר לבקש", (await hintOf(await ask(manager, 20, "מאוחר"))) === "discount-sent")
} finally {
  for (const id of jobs) {
    const fs_ = await (await admin(`/rest/v1/findings?job_card_id=eq.${id}&select=id`)).json()
    for (const f of Array.isArray(fs_) ? fs_ : []) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    for (const t of ["quote_requests", "quote_items", "quote_versions", "customer_notices", "findings", "job_moves"]) {
      await admin(`/rest/v1/${t}?job_card_id=eq.${id}`, { method: "DELETE" })
    }
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  for (const id of bookings) {
    await admin(`/rest/v1/customer_notices?booking_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/bookings?id=eq.${id}`, { method: "DELETE" })
  }
  const left = await (await admin(`/rest/v1/bookings?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()
  const leftJobs = await (await admin(`/rest/v1/job_cards?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()
  ok("ניקוי: לא נשארו רשומות בדיקה", Array.isArray(left) && left.length === 0 && Array.isArray(leftJobs) && leftJobs.length === 0, JSON.stringify([left, leftJobs]))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
