// בודק את 053 (ביקורת אבטחה חיצונית, 7.10, ממצא 5): קישור לקוח שפג לפני שהלקוח ענה לא מחזיר
// שם, רכב, פריטים או מחירים. קישור שנענה ממשיך להחזיר את הקבלה, וקישור בתוקף עובד כרגיל.
// הקריאות בשם אורח (המפתח הציבורי), בדיוק כמו דף הלקוח.
//
// הרצה: node --env-file=levi-garage/.env.local 03-rollout/solution-4-app/test/expired-link.mjs
//
// כל מה שנוצר כאן נמחק בסוף, גם אם בדיקה נכשלה.

import crypto from "node:crypto"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (!serviceKey) throw new Error("חסר SUPABASE_SECRET_KEY (levi-garage/.env.local)")

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
  fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const add = async (table, body) => {
  const res = await admin(`/rest/v1/${table}`, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(body) })
  const j = await res.json()
  if (!res.ok || !Array.isArray(j)) throw new Error(`${table}: ${JSON.stringify(j).slice(0, 200)}`)
  return j[0]
}
const anon = async (fn, token) => (await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify({ p_token: token }) })).json()

const NOTE = "רשומת בדיקה אוטומטית (expired-link)"
const tok = () => crypto.randomBytes(18).toString("hex")
const past = new Date(Date.now() - 2 * 86400_000).toISOString()
const future = new Date(Date.now() + 2 * 86400_000).toISOString()
let jobId = null

try {
  const job = await add("job_cards", {
    plate: "7360453", vehicle_make: "מאזדה", vehicle_model: "3", customer_name: "לקוח בדיקה", customer_phone: "0500000453",
    status: "waiting_approval", notes: NOTE,
  })
  jobId = job.id
  const finding = (title) => add("findings", { job_card_id: jobId, source: "manual", title, summary: title, urgency: "yellow", status: "sent", price_original: 500, price_aftermarket: 300 })

  // ממצאים לאישור: פג ולא נענה, פג ונענה, בתוקף
  const mk = async (expires, decided) => {
    const f = await finding(decided ? "נענה" : "לא נענה")
    const r = await add("quote_requests", { job_card_id: jobId, token: tok(), kind: "findings", expires_at: expires, decided_at: decided ? past : null })
    await add("approvals", {
      finding_id: f.id, request_id: r.id, token: tok(), message_text: "בדיקת קישור", expires_at: expires,
      decision: decided ? "approved" : null, decided_at: decided ? past : null, part_choice: decided ? "original" : null, price_chosen: decided ? 500 : null,
    })
    return r.token
  }
  const expiredOpen = await mk(past, false)
  const expiredDone = await mk(past, true)
  const live = await mk(future, false)

  const [e] = await anon("request_view", expiredOpen)
  ok("פג ולא נענה: מסומן שפג", e?.expired === true)
  ok("פג ולא נענה: בלי פריט, מחיר, רכב והודעה", e && e.title === null && e.price_original === null && e.vehicle === null && e.plate_last3 === null && e.message_text === null, JSON.stringify(e))
  ok("פג ולא נענה: בלי 'אושר קודם'", (await anon("request_agreed", expiredOpen)) === null)

  const [d] = await anon("request_view", expiredDone)
  ok("פג ונענה: הקבלה נשארת (פריט, מחיר, רכב)", d && d.title === "נענה" && Number(d.price_chosen) === 500 && d.vehicle === "מאזדה 3", JSON.stringify(d))
  ok("פג ונענה: 'אושר קודם' נשאר", (await anon("request_agreed", expiredDone)) !== null)

  const [l] = await anon("request_view", live)
  ok("בתוקף: הכול כרגיל", l && l.expired === false && l.title === "לא נענה" && Number(l.price_original) === 500 && l.vehicle === "מאזדה 3", JSON.stringify(l))

  // 055 (ביקורת חוזרת, 8.10, ממצא 5): תוקף התמונות לא עובר את תוקף הקישור
  const soon = await mk(new Date(Date.now() + 10 * 60_000).toISOString(), false)
  const s = await anon("link_seconds_left", soon)
  ok("קישור שנשארו לו עשר דקות: התמונות לעשר דקות, לא לשעה", typeof s === "number" && s > 500 && s <= 600, String(s))
  const lv = await anon("link_seconds_left", live)
  ok("קישור בתוקף ליומיים: יותר משעה (הדף נשאר עם שעה)", typeof lv === "number" && lv > 3600, String(lv))
  ok("קישור שפג: 0", (await anon("link_seconds_left", expiredOpen)) === 0)
  ok("טוקן שלא קיים: כלום", (await anon("link_seconds_left", tok())) === null)

  // הצעת הקבלה
  const ri =await add("quote_requests", { job_card_id: jobId, token: tok(), kind: "intake", expires_at: past })
  const iv = await anon("intake_view", ri.token)
  ok("קבלה שפגה: רק 'פג', בלי רכב, שם ופריטים", iv?.status === "expired" && iv.vehicle === null && iv.customer === null && Array.isArray(iv.lines) && iv.lines.length === 0, JSON.stringify(iv))

  // הקישור הישן, ממצא בודד
  const fo = await finding("ישן")
  const old = await add("approvals", { finding_id: fo.id, token: tok(), message_text: "בדיקת קישור ישן", expires_at: past })
  const [ov] = await anon("approval_view", old.token)
  ok("קישור ישן שפג: בלי פריט, מחיר והודעה", ov && ov.expired === true && ov.title === null && ov.price_original === null && ov.message_text === null, JSON.stringify(ov))
} finally {
  if (jobId) {
    const fs = await (await admin(`/rest/v1/findings?job_card_id=eq.${jobId}&select=id`)).json()
    for (const f of Array.isArray(fs) ? fs : []) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    for (const t of ["quote_requests", "quote_items", "quote_versions", "customer_notices", "findings", "job_moves", "inspections"]) {
      await admin(`/rest/v1/${t}?job_card_id=eq.${jobId}`, { method: "DELETE" })
    }
    await admin(`/rest/v1/job_cards?id=eq.${jobId}`, { method: "DELETE" })
  }
  const left = await (await admin(`/rest/v1/job_cards?notes=eq.${encodeURIComponent(NOTE)}&select=id`)).json()
  ok("ניקוי: לא נשארו רשומות בדיקה", Array.isArray(left) && left.length === 0, JSON.stringify(left))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
