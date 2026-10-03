// בודק את התיקונים של החזרה הגנרלית (3.10, מיגרציה 039) מול המסד האמיתי.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local --env-file=03-rollout/solution-3-agent/.env.wiring.local 03-rollout/solution-4-app/test/round3.mjs
//
// מה נבדק: "בדיקה לפני קנייה" במחירון; הסכמה לוואטסאפ מתוך הודעה (המזהה האטום
// של הבוט); "התור נקבע" שואל רק כן/לא; רכב בלי תור (מי פותח, מה נשמר); והתקנון
// שהלקוח בלי התור מאשר בדף ההצעה. והנוסחים הכתובים מראש באתר אכן נתפסים כהסכמה.
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

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

// אותו מזהה שהבוט שולח: 'wa-' ו-16 תווים ראשונים של HMAC על המספר הבינלאומי.
const clientId = (phone) => "wa-" + crypto.createHmac("sha256", botToken).update("972" + phone.replace(/\D/g, "").slice(1)).digest("hex").slice(0, 16)

const manager = await signIn("test1@test.com")
const mechanic = await signIn("test5@test.com")
const PHONE = "0500000391"
const bookings = []
const jobs = []

try {
  // 1. מחירון
  const [pp] = await (await admin(`/rest/v1/price_list?code=eq.pre-purchase&select=price_original,fixed_price,active,labor_hours`)).json()
  ok("בדיקה לפני קנייה במחירון: 450, מחיר קבוע, פעיל", pp && Number(pp.price_original) === 450 && pp.fixed_price && pp.active, JSON.stringify(pp))

  // 2. הסכמה מתוך הודעה
  const uid = "r3test" + crypto.randomBytes(10).toString("hex")
  const [b] = await (
    await admin(`/rest/v1/bookings`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        cal_uid: uid, status: "booked", drop_off_at: new Date(Date.now() + 86400e3).toISOString(),
        customer_name: "בדיקה סבב 3", customer_phone: PHONE, whatsapp_consent: false, plate: "7360391", notes: "רשומת בדיקה אוטומטית (round3)",
      }),
    })
  ).json()
  bookings.push(b.id)

  const before = await rpcJson("booking_consent", { p_uid: uid })
  ok("התור נקבע: נמצא, בלי הסכמה", before.found === true && before.consent === false, JSON.stringify(before))
  const nope = await rpcJson("booking_consent", { p_uid: "r3nope" + crypto.randomBytes(10).toString("hex") })
  ok("uid אחר: לא נמצא, ובלי פרטים", nope.found === false && !("consent" in nope), JSON.stringify(nope))
  const junk = await rpcJson("booking_consent", { p_uid: "' or 1=1 --" })
  ok("uid לא תקין: לא נמצא", junk.found === false)

  const bad = await rpc("grant_whatsapp_consent", { p_secret: "x".repeat(40), p_client: clientId(PHONE) })
  ok("הסכמה בלי הטוקן של הבוט: נחסם", !bad.ok, String(bad.status))
  const other = await rpcJson("grant_whatsapp_consent", { p_secret: botToken, p_client: clientId("0500000392") })
  ok("הודעה ממספר אחר: לא משנה את התור", other === 0, JSON.stringify(other))
  const granted = await rpcJson("grant_whatsapp_consent", { p_secret: botToken, p_client: clientId(PHONE) })
  ok("הודעה מהמספר של התור: ההסכמה נרשמת", granted >= 1, JSON.stringify(granted))
  const after = await rpcJson("booking_consent", { p_uid: uid })
  ok("התור נקבע: עכשיו עם הסכמה", after.consent === true, JSON.stringify(after))
  const again = await rpcJson("grant_whatsapp_consent", { p_secret: botToken, p_client: clientId(PHONE) })
  ok("הודעה שנייה: אין מה לשנות", again === 0, JSON.stringify(again))

  // 3. רכב בלי תור
  const walkin = {
    plate: "73-603-93", customer_phone: "050-0000393", customer_name: "לקוח בלי תור", customer_email: "not-an-email",
    service: "בדיקה לפני קנייה", notes: "רשומת בדיקה אוטומטית (round3)", vehicle_found: true, vehicle_make: "מאזדה", vehicle_model: "3", vehicle_year: 2019,
  }
  const byMech = await rpc("create_walkin_booking", { p: walkin }, mechanic)
  ok("מכונאי לא פותח תור בדלפק", !byMech.ok, String(byMech.status))
  const byAnon = await rpc("create_walkin_booking", { p: walkin })
  ok("בלי התחברות: נחסם", !byAnon.ok, String(byAnon.status))
  const badPhone = await (await rpc("create_walkin_booking", { p: { ...walkin, customer_phone: "123" } }, manager)).json()
  ok("טלפון לא תקין: נדחה עם רמז", badPhone?.hint === "phone", JSON.stringify(badPhone))
  const wid = await rpcJson("create_walkin_booking", { p: walkin }, manager)
  ok("דניאל פותח תור לרכב בלי תור", typeof wid === "number", JSON.stringify(wid))
  if (typeof wid === "number") bookings.push(wid)
  const [w] = typeof wid !== "number" ? [] : await (await admin(`/rest/v1/bookings?id=eq.${wid}&select=source,status,plate,customer_phone,customer_email,whatsapp_consent,cal_uid,service`)).json()
  ok("נשמר: בלי תור, לוחית נקייה, בלי הסכמה, בלי Cal.com", w?.source === "walkin" && w.plate === "7360393" && w.whatsapp_consent === false && String(w.cal_uid).startsWith("walkin-"), JSON.stringify(w))
  ok("מייל לא תקין לא נשמר", w?.customer_email === null)

  // 4. תקנון בדף ההצעה, רק למי שהגיע בלי תור
  const newJob = async (bookingId) => {
    const [j] = await (
      await admin(`/rest/v1/job_cards`, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          booking_id: bookingId, plate: "7360393", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "לקוח בלי תור",
          customer_phone: "0500000393", status: "open", whatsapp_consent: true, updates_consent_at: new Date().toISOString(), notes: "רשומת בדיקה אוטומטית (round3)",
        }),
      })
    ).json()
    jobs.push(j.id)
    await admin(`/rest/v1/quote_items`, {
      method: "POST",
      body: JSON.stringify({ job_card_id: j.id, title: "בדיקה לפני קנייה", labor_hours: 1.5, price_original: 450, warranty_original: "ללא", single_reason: "עבודה בלבד.", part_choice: "original" }),
    })
    const token = await rpcJson("send_intake_request", { p_job_id: j.id }, manager)
    return token
  }
  const tWalk = await newJob(wid)
  const vWalk = await rpcJson("intake_view", { p_token: tWalk })
  ok("הצעה לרכב בלי תור: מבקשת אישור תקנון", vWalk?.needs_terms === true, JSON.stringify(vWalk?.needs_terms))
  const tCal = await newJob(b.id)
  const vCal = await rpcJson("intake_view", { p_token: tCal })
  ok("הצעה לרכב עם תור מ-Cal.com: בלי תקנון (כבר אושר בטופס)", vCal?.needs_terms === false, JSON.stringify(vCal?.needs_terms))
  ok("טוקן לא תקין: לא מאשר תקנון", (await rpcJson("intake_accept_terms", { p_token: "nope" })) === "unavailable")
  ok("אישור התקנון נרשם", (await rpcJson("intake_accept_terms", { p_token: tWalk })) === "done")
  const vWalk2 = await rpcJson("intake_view", { p_token: tWalk })
  ok("אחרי האישור: כבר לא מבקשת", vWalk2?.needs_terms === false)
  ok("ההכרעה עדיין עובדת", (await rpcJson("intake_decide", { p_token: tWalk, p_decision: "approved" })) === "done")
  ok("אחרי ההכרעה: אי אפשר לאשר שוב תקנון", (await rpcJson("intake_accept_terms", { p_token: tWalk })) === "unavailable")

  // 5. הנוסחים הכתובים מראש באתר נתפסים כהסכמה (lib/site/consent.ts מול dict.ts)
  const root = new URL("../../../levi-garage/", import.meta.url)
  const consentTs = fs.readFileSync(new URL("lib/site/consent.ts", root), "utf8")
  const dictTs = fs.readFileSync(new URL("lib/site/dict.ts", root), "utf8")
  const phrases = [...consentTs.slice(consentTs.indexOf("const PHRASES")).split("]")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase())
  const messages = [...dictTs.matchAll(/waMessage: "([^"]+)"/g)].map((m) => m[1])
  const counter = consentTs.match(/COUNTER_MESSAGE = "([^"]+)"/)?.[1]
  const caught = (t) => phrases.some((p) => t.replace(/\s+/g, " ").toLowerCase().includes(p))
  ok("שלושת הנוסחים באתר (עברית, ערבית, רוסית) נתפסים", messages.length === 3 && messages.every(caught), JSON.stringify(messages.map(caught)))
  ok("ההודעה מה-QR בדלפק נתפסת", Boolean(counter) && caught(counter))
  ok("\"מה המצב של הרכב?\" לא נתפס כהסכמה", !caught("שלום, מה המצב של הרכב שלי?"))
} finally {
  for (const id of jobs) {
    await admin(`/rest/v1/quote_requests?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/quote_items?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/quote_versions?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/customer_notices?job_card_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${id}`, { method: "DELETE" })
  }
  for (const id of bookings) {
    await admin(`/rest/v1/customer_notices?booking_id=eq.${id}`, { method: "DELETE" })
    await admin(`/rest/v1/bookings?id=eq.${id}`, { method: "DELETE" })
  }
  const left = await (await admin(`/rest/v1/bookings?notes=eq.${encodeURIComponent("רשומת בדיקה אוטומטית (round3)")}&select=id`)).json()
  ok("ניקוי: לא נשארו תורי בדיקה", Array.isArray(left) && left.length === 0, JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
