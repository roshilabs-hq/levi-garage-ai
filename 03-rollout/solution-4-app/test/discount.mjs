// בודק את כללי ההנחה (020) מול המסד האמיתי: מי רשאי, כמה, עם סיבה, ושהמחיר
// שהלקוח רואה ומאשר הוא המחיר אחרי ההנחה.
//
// הרצה: node --env-file=levi-garage/.env.local --env-file=levi-garage/.env.staff.local 03-rollout/solution-4-app/test/discount.mjs
//
// למה זה קיים: הנחה היא כסף שיוצא מהקופה. הכלל של רועי ("דניאל עד 10%,
// מעל זה אבי, ותמיד עם סיבה") שווה משהו רק אם הוא נאכף גם כשמישהו לא משתמש
// בטופס. וכל הנחה נרשמת, כי בסוף החודש רוצים לדעת על מה הלך הכסף.
//
// כל מה שנוצר כאן נמחק בסוף.

import { passwordFor, readable } from "./_auth.mjs"

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
  fetch(`${url}${readable(path, token)}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
const rpc = (fn, body, token) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })

async function signIn(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const daniel = await signIn("test1@test.com")
const avi = await signIn("test3@test.com")
const mechanic = await signIn("test5@test.com")

const PLATE = "9990020"
let jobId = null

const patch = (id, body, token) => call(`/rest/v1/findings?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body), token })
const finding = async (id) => (await (await admin(`/rest/v1/findings?id=eq.${id}&select=*`)).json())[0]
const hintOf = async (res) => (await res.json().catch(() => ({})))?.hint

// ממצא טיוטה עם מחיר מחירון של רפידות: 780 מקורי, 520 חלופי.
async function draft() {
  const res = await call(`/rest/v1/findings`, {
    method: "POST",
    token: daniel,
    body: JSON.stringify({ job_card_id: jobId, source: "manager", status: "draft", title: "רפידות בלם קדמיות", customer_text: "בדיקה" }),
  })
  const [row] = await res.json()
  return row.id
}
// ממצא שלם לפי החוק (014): מחיר, שעות, אחריות לכל סוג, והסבר ההבדל.
const PRICES = {
  list_price_original: 780,
  list_price_aftermarket: 520,
  price_original: 780,
  price_aftermarket: 520,
  labor_hours: 1,
  warranty_original: "12 חודשים",
  warranty_aftermarket: "6 חודשים",
  part_diff: "מקורי של יצרן הרכב, חלופי של יצרן מוכר",
}

try {
  const res = await call(`/rest/v1/job_cards`, {
    method: "POST",
    token: daniel,
    body: JSON.stringify({ plate: PLATE, customer_name: "בדיקה אוטומטית", status: "in_progress", updates_consent_at: new Date().toISOString() }),
  })
  jobId = (await res.json())[0].id

  const a = await draft()
  const r1 = await patch(a, { ...PRICES, discount_pct: 10, discount_reason: "עיכוב שלנו" }, daniel)
  const f1 = await finding(a)
  ok("דניאל נותן 10%: המחיר מחושב מהמחירון", r1.ok && Number(f1.price_original) === 702 && Number(f1.price_aftermarket) === 468, JSON.stringify({ o: f1.price_original, a: f1.price_aftermarket }))
  ok("ההנחה נרשמת: כמה, למה ומי", Number(f1.discount_pct) === 10 && f1.discount_reason === "עיכוב שלנו" && Boolean(f1.discount_by))

  const cheat = await patch(a, { price_original: 500 }, daniel)
  ok("אי אפשר להקליד מחיר 'מוזל' שלא מתאים לאחוז", cheat.ok && Number((await finding(a)).price_original) === 702)

  const r2 = await patch(a, { discount_pct: 15 }, daniel)
  ok("דניאל לא נותן 15%", !r2.ok && (await hintOf(r2)) === "discount-owner", `status ${r2.status}`)

  const r3 = await patch(a, { discount_pct: 20, discount_reason: "לקוח של 20 שנה" }, avi)
  const f3 = await finding(a)
  ok("אבי נותן 20%", r3.ok && Number(f3.price_original) === 624 && Number(f3.price_aftermarket) === 416, JSON.stringify({ o: f3.price_original }))

  const r4 = await patch(a, { discount_pct: 60, discount_reason: "סתם" }, avi)
  ok("גם אבי לא מעל 50%", !r4.ok, `status ${r4.status}`)

  const b = await draft()
  const r5 = await patch(b, { ...PRICES, discount_pct: 5, discount_reason: null }, daniel)
  ok("הנחה בלי סיבה נדחית", !r5.ok && (await hintOf(r5)) === "discount-reason", `status ${r5.status}`)
  const r6 = await patch(b, { ...PRICES, discount_pct: 5, discount_reason: "רצה" }, mechanic)
  ok("מכונאי לא נותן הנחה", !r6.ok && (await hintOf(r6)) === "discount-role", `status ${r6.status}`)
  const r7 = await patch(b, { ...PRICES, discount_pct: 0 }, daniel)
  const f7 = await finding(b)
  ok("בלי הנחה: מחיר המחירון, בלי סיבה ובלי שם", r7.ok && Number(f7.price_original) === 780 && f7.discount_reason === null && f7.discount_by === null)

  // ---------------------------------------------------------------- מה הלקוח רואה ומאשר
  const token = await (await rpc("send_finding", { p_finding_id: a, p_message: "בדיקה", p_channel: "link" }, daniel)).json()
  ok("הממצא עם ההנחה נשלח", typeof token === "string", JSON.stringify(token))

  const after = await patch(a, { discount_pct: 10, discount_reason: "שיניתי את דעתי" }, avi)
  ok("אחרי השליחה אי אפשר לשנות את ההנחה", !after.ok && (await hintOf(after)) === "discount-sent", `status ${after.status}`)

  const [view] = await (await rpc("approval_view", { p_token: token })).json()
  ok("דף הלקוח: המחיר אחרי ההנחה", Number(view.price_original) === 624 && Number(view.price_aftermarket) === 416)
  ok("ודף הלקוח מראה את מחיר המחירון ואת האחוז", Number(view.list_price_original) === 780 && Number(view.list_price_aftermarket) === 520 && Number(view.discount_pct) === 20)

  const decided = await (await rpc("approval_decide", { p_token: token, p_decision: "approved", p_part_choice: "aftermarket" })).json()
  const [ap] = await (await admin(`/rest/v1/approvals?finding_id=eq.${a}&select=price_chosen`)).json()
  ok("הלקוח מאשר, ונרשם המחיר אחרי ההנחה", decided === "approved" && Number(ap.price_chosen) === 416, JSON.stringify(ap))

  const [plain] = await (await rpc("approval_view", { p_token: "x".repeat(36) })).json().then((v) => (Array.isArray(v) ? v : [v]))
  ok("טוקן אחר לא מחזיר כלום", !plain)
} finally {
  if (jobId) {
    const fs = await (await admin(`/rest/v1/findings?job_card_id=eq.${jobId}&select=id`)).json()
    for (const f of fs) await admin(`/rest/v1/approvals?finding_id=eq.${f.id}`, { method: "DELETE" })
    await admin(`/rest/v1/findings?job_card_id=eq.${jobId}`, { method: "DELETE" })
    await admin(`/rest/v1/customer_notices?job_card_id=eq.${jobId}`, { method: "DELETE" })
    await admin(`/rest/v1/job_cards?id=eq.${jobId}`, { method: "DELETE" })
  }
  const left = await (await admin(`/rest/v1/job_cards?plate=eq.${PLATE}&select=id`)).json()
  ok("נוקה: לא נשאר כרטיס בדיקה", left.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
