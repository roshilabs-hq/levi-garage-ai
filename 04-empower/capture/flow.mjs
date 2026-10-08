// צילומי הסרטון "רכב אחד, שני מסכים" (04-empower/videos/the-full-flow.md).
//
// בסרטון שני הצדדים זה לצד זה, ולכן כל פרט חייב להתאים: רכב אחד (דנה לוי, סקודה
// FABIA שמסתיימת ב-376, כמו בהודעות הוואטסאפ), שעובר את כל השלבים, ובכל שלב מצלמים את
// הלוח של דניאל, את העמדה ליד הליפט ואת הטלפון של דנה.
//
// השעה: היום של דנה הוא יום שני, 5.10.2026, מ-07:30 עד 14:46. השרת המקומי רץ עם
// fake-now.mjs, והדפדפן עם clock.setFixedTime, כך שכל שעה ו"כבר X דק'" במסך תואמים לשעון בסרטון.
//
// בלי הודעות אמיתיות: הכפתורים שיוצאת מהם הודעה ללקוח ("קבלת רכב ושליחת ההצעה",
// "לשלוח ללקוח", "הרכב מוכן") לא נלחצים. המצב שלהם נכתב ישר למסד, כמו ב-capture.mjs.
//
// הרצה (מתוך 04-empower/capture), אחרי שהשרת המקומי עלה:
//   npm run flow
// הנתונים: תורים עם cal_uid שמתחיל ב-guide-, כרטיסים עם notes שמתחיל ב"מדריך". נמחקים בסוף.

import { createHmac } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

import { passwordFor } from "../../03-rollout/solution-4-app/test/_auth.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, "../../00-planning/videos/flow/comp/assets/img")
mkdirSync(OUT, { recursive: true })
const FAKE = process.env.FAKE_NOW_FILE
if (!FAKE) throw new Error("חסר FAKE_NOW_FILE (אותו קובץ של השרת המקומי)")

const BASE = process.env.CAPTURE_BASE || "http://localhost:3123"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (!serviceKey) throw new Error("חסר SUPABASE_SECRET_KEY")

// ------------------------------------------------------------------ מסד

const call = (path, { token = anonKey, key = anonKey, ...init } = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  })
const admin = (path, init = {}) => call(path, { ...init, token: serviceKey, key: serviceKey })
async function insert(table, row) {
  const res = await admin(`/rest/v1/${table}`, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row) })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return (await res.json())[0]
}
async function patch(table, filter, row) {
  const res = await admin(`/rest/v1/${table}?${filter}`, { method: "PATCH", body: JSON.stringify(row) })
  if (!res.ok) throw new Error(`${table} patch: ${res.status} ${await res.text()}`)
}
async function get(path) {
  return (await admin(`/rest/v1/${path}`)).json()
}
async function rpc(fn, body, token) {
  const res = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(body), token })
  const text = await res.text()
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
async function tokenOf(email) {
  const res = await call(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: passwordFor(email) }) })
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`)
  return (await res.json()).access_token
}

const made = { stations: [], stationRequests: [], files: [] }
const PHOTOS = resolve(here, "../../levi-garage/public/demo-photos")
async function upload(bucket, path, file) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "image/jpeg", "x-upsert": "true" },
    body: readFileSync(resolve(PHOTOS, file)),
  })
  if (!res.ok) throw new Error(`upload ${bucket}/${path}: ${res.status} ${await res.text()}`)
  made.files.push({ bucket, path })
  return path
}
async function cleanup() {
  await admin(`/rest/v1/job_cards?notes=like.${encodeURIComponent("מדריך*")}`, { method: "DELETE" })
  await admin(`/rest/v1/bookings?cal_uid=like.guide-*`, { method: "DELETE" })
  for (const id of made.stationRequests) await admin(`/rest/v1/station_requests?id=eq.${id}`, { method: "DELETE" })
  for (const id of made.stations) await admin(`/rest/v1/stations?id=eq.${id}`, { method: "DELETE" })
  for (const bucket of new Set(made.files.map((f) => f.bucket))) {
    const prefixes = made.files.filter((f) => f.bucket === bucket).map((f) => f.path)
    await fetch(`${url}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes }),
    })
  }
  made.stations = []
  made.stationRequests = []
  made.files = []
}

// ------------------------------------------------------------------ השעון

/** 5.10.2026 בשעה hh:mm, שעון ישראל (קיץ, UTC+3). day=-1: יום ראשון, 4.10. */
const T = (hhmm, day = 0) => {
  const [h, m] = hhmm.split(":").map(Number)
  return new Date(Date.UTC(2026, 9, 5 + day, h - 3, m)).toISOString()
}
const contexts = []
async function at(hhmm, day = 0) {
  const t = new Date(T(hhmm, day)).getTime()
  writeFileSync(FAKE, JSON.stringify({ t, at: Date.now() }))
  for (const c of contexts) await c.clock.setFixedTime(t)
  await new Promise((r) => setTimeout(r, 400)) // שהשרת יקרא את הקובץ
  console.log(`🕒 ${day ? "4.10 " : ""}${hhmm}`)
}
const minus = (hhmm, min, day = 0) => new Date(new Date(T(hhmm, day)).getTime() - min * 60_000).toISOString()

// ------------------------------------------------------------------ דפדפן

const browser = await chromium.launch({ channel: "chrome" })
const DESK = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }
async function contextFor(viewport, mobile = false) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1, colorScheme: "light", locale: "he-IL", timezoneId: "Asia/Jerusalem",
    isMobile: mobile, hasTouch: mobile,
  })
  contexts.push(ctx)
  return ctx
}
async function signIn(email, viewport = DESK) {
  const page = await (await contextFor(viewport)).newPage()
  await page.goto(`${BASE}/staff/login`, { timeout: 120_000 })
  await page.fill("#email", email)
  await page.fill("#password", passwordFor(email))
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 120_000 }), page.click('button[type="submit"]')])
  return page
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(600)
}
async function go(page, path) {
  await page.goto(`${BASE}${path}`, { timeout: 120_000 })
  await settle(page)
}
const hotspots = {}
async function recordHotspots(page, name, origin, size) {
  const items = await page.evaluate(({ ox, oy, w, h }) => {
    const SEL = 'button, a[href], select, textarea, summary, [role="button"], [role="tab"], input:not([type="hidden"])'
    const seen = new Set()
    const out = []
    for (const raw of document.querySelectorAll(SEL)) {
      const n = raw.matches('input[type="checkbox"], input[type="radio"]') ? raw.closest("label") || raw : raw
      if (seen.has(n)) continue
      seen.add(n)
      if (n.checkVisibility && !n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) continue
      const r = n.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) continue
      const x = r.x + window.scrollX - ox
      const y = r.y + window.scrollY - oy
      if (x + r.width <= 0 || y + r.height <= 0 || x >= w || y >= h) continue
      const text = (n.getAttribute("aria-label") || n.innerText || n.getAttribute("placeholder") || n.getAttribute("title") || n.value || n.querySelector("img")?.getAttribute("alt") || "")
        .replace(/\s+/g, " ").trim().slice(0, 80)
      out.push({ text, tag: n.tagName.toLowerCase(), x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) })
    }
    return out
  }, { ox: origin.x, oy: origin.y, w: size.width, h: size.height })
  hotspots[name] = { width: Math.round(size.width), height: Math.round(size.height), items }
}
const shots = []
async function shot(page, name, target = null) {
  await settle(page)
  const path = resolve(OUT, `${name}.png`)
  // nextjs-portal: הסמל של שרת הפיתוח בפינה
  await page.addStyleTag({ content: ".qb-send, .req-foot { position: static !important; } nextjs-portal { display: none !important; }" })
  if (target) {
    const el = page.locator(target).first()
    await el.scrollIntoViewIfNeeded()
    const box = await el.evaluate((n) => {
      const r = n.getBoundingClientRect()
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
    })
    const vw = page.viewportSize().width
    const pad = 16
    const x = Math.max(0, box.x - pad)
    const clip = { x, y: Math.max(0, box.y - pad), width: Math.min(vw - x, box.width + pad * 2), height: box.height + pad * 2 }
    await page.screenshot({ path, animations: "disabled", fullPage: true, clip })
    await recordHotspots(page, name, { x: clip.x, y: clip.y }, clip)
  } else {
    await page.screenshot({ path, fullPage: true, animations: "disabled" })
    const full = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
    await recordHotspots(page, name, { x: 0, y: 0 }, full)
  }
  shots.push(name)
  console.log(`✓ ${name}`)
}

// ------------------------------------------------------------------ הנתונים

const STAFF = Object.fromEntries(((await get(`staff?select=id,full_name,role`)) ?? []).map((s) => [s.full_name.split(" ")[0], s]))
const motiLift = (await get(`staff?id=eq.${STAFF["מוטי"]?.id}&select=lift`))[0]?.lift ?? null
const PL = Object.fromEntries((await get(`price_list?select=id,code,price_original,price_aftermarket,labor_hours`)).map((r) => [r.code, r]))
const fromList = (code, qty = 1) => {
  const r = PL[code]
  if (!r) throw new Error(`price_list: אין ${code}`)
  return {
    price_list_id: r.id, quantity: qty, labor_hours: Number(r.labor_hours) * qty,
    price_original: Number(r.price_original) * qty, price_aftermarket: r.price_aftermarket === null ? null : Number(r.price_aftermarket) * qty,
  }
}

const HERO = { plate: "8215376", customer_name: "דנה לוי", vehicle_make: "סקודה", vehicle_model: "FABIA", vehicle_year: 2012, engine_code: "CBZ", fuel: "בנזין" }
const NOTE = "מדריך · רכב אחד, שני מסכים"

// רקע, כדי שהלוח והעמדה ייראו כמו יום עבודה. שעות הפתיחה קבועות (לא 07:10, ולא לפני
// שהמוסך נפתח), וה"כבר X דק'" מתעדכן לפני כל שלב.
const BG = [
  { key: "a", row: { plate: "9034412", vehicle_make: "מאזדה", vehicle_model: "6", vehicle_year: 2018, customer_name: "אורי שפירא", lift: 1, opened_at: T("07:02"), inspected_at: T("07:20") }, since: 40 },
  { key: "b", row: { plate: "7715360", vehicle_make: "סוזוקי", vehicle_model: "SWIFT", vehicle_year: 2020, customer_name: "שירן אדרי", lift: 3, opened_at: T("07:05"), inspected_at: T("07:24") }, since: 28 },
  { key: "c", row: { plate: "2640918", vehicle_make: "שברולט", vehicle_model: "SPARK", vehicle_year: 2015, customer_name: "אבי פרץ", lift: null, status: "open", opened_at: T("07:42") }, since: 12, arrived: 32 },
]
const bg = {}
async function rebase(hhmm) {
  for (const b of BG) {
    if (!bg[b.key]) continue
    const s = minus(hhmm, b.since)
    // רכב שמחכה בתור הגיע תמיד חצי שעה קודם: אף רכב לא מחכה בתור שעות
    const extra = b.arrived ? { opened_at: minus(hhmm, b.arrived) } : {}
    await patch("job_cards", `id=eq.${bg[b.key].id}`, { status_since: s, lift_since: b.row.lift ? s : null, ...extra })
  }
}

// ------------------------------------------------------------------ היום של דנה

let failed = null
try {
  await cleanup()
  const daniel = await tokenOf("test1@test.com")

  // התור של דנה, ועוד שניים מאוחר יותר באותו יום
  const booking = await insert("bookings", {
    cal_uid: "guide-flow-1", ...HERO, customer_phone: "0500000001", whatsapp_consent: true,
    service: "טיפול תקופתי", drop_off_at: T("07:30"), status: "booked", vehicle_found: true, created_at: T("21:40", -3),
  })
  await insert("bookings", { cal_uid: "guide-flow-2", plate: "5748301", customer_name: "עומר כהן", customer_phone: "0500000002", whatsapp_consent: true, service: "הכנה וליווי לטסט", drop_off_at: T("15:30"), status: "booked", vehicle_found: true, vehicle_make: "יונדאי", vehicle_model: "TUCSON", vehicle_year: 2017, fuel: "בנזין" })
  await insert("bookings", { cal_uid: "guide-flow-3", plate: "8815023", customer_name: "מרים אבו-חאטום", customer_phone: "0500000003", whatsapp_consent: true, service: "טיפול תקופתי", drop_off_at: T("16:00"), status: "booked", vehicle_found: true, vehicle_make: "יונדאי", vehicle_model: "i20", vehicle_year: 2017, fuel: "בנזין" })

  const d = await signIn("test1@test.com")

  // 1. ערב לפני: התור כבר בלוח, ב"ימים הקרובים"
  await at("18:05", -1)
  await go(d, "/staff")
  await shot(d, "f01-board-later", 'section[aria-labelledby="g-later"]')

  // הבוקר: רכבי הרקע
  for (const b of BG) {
    bg[b.key] = await insert("job_cards", {
      status: "in_progress", customer_phone: "0500000009", whatsapp_consent: true, updates_consent_at: b.row.opened_at,
      work_approved_at: b.row.opened_at, work_approved_via: "link", notes: NOTE, ...b.row,
    })
    await insert("quote_items", { job_card_id: bg[b.key].id, title: "טיפול 30,000", labor_hours: 1.5, price_original: 690, price_aftermarket: 520, warranty_original: "12 חודשים", warranty_aftermarket: "6 חודשים", part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר, באותו מפרט, זול יותר.", part_choice: "aftermarket" })
  }

  // 2. 07:25: תורים להיום
  await at("07:25")
  await rebase("07:25")
  await go(d, "/staff")
  await shot(d, "f02-board-arriving", 'section[aria-labelledby="g-arriving"]')

  // 3. 07:30: קבלת רכב, הטופס כבר מלא
  await at("07:30")
  await go(d, `/staff/arrive/${booking.id}`)
  await shot(d, "f03-arrive-form", ".arrive-form")

  // דניאל שלח את ההצעה (בלי ללחוץ: מהכפתור יוצאת הודעה). המצב נכתב ישר.
  const job = await insert("job_cards", {
    ...HERO, booking_id: booking.id, status: "open", lift: null, customer_phone: "0500000001", whatsapp_consent: true,
    updates_consent_at: T("07:31"), opened_at: T("07:31"), opened_by: STAFF["דניאל"]?.id ?? null, notes: NOTE,
  })
  await patch("job_cards", `id=eq.${job.id}`, { status_since: T("07:31") })
  await patch("bookings", `id=eq.${booking.id}`, { status: "arrived" })
  await insert("quote_items", { job_card_id: job.id, title: "טיפול 60,000", labor_hours: 2.5, price_original: 1150, price_aftermarket: 890, warranty_original: "12 חודשים", warranty_aftermarket: "6 חודשים", part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר, באותו מפרט, זול יותר.", part_choice: "aftermarket" })
  const intakeToken = await rpc("send_intake_request", { p_job_id: job.id }, daniel)
  await patch("quote_requests", `token=eq.${intakeToken}`, { sent_at: T("07:32") })

  // 4. 07:33: בלוח, מחכה לאישור הקבלה. 07:34: דנה, בטלפון, ליד הדלפק
  await at("07:33")
  await rebase("07:33")
  await go(d, "/staff")
  await shot(d, "f04-board-intake", 'section[aria-labelledby="g-intake"]')
  const c = await (await contextFor(PHONE, true)).newPage()
  await at("07:34")
  await go(c, `/approve/${intakeToken}`)
  await shot(c, "f05-intake-approve")

  // דנה אישרה
  await patch("job_cards", `id=eq.${job.id}`, { work_approved_at: T("07:36"), work_approved_via: "link", terms_accepted_at: T("07:36") })
  await patch("quote_requests", `token=eq.${intakeToken}`, { decided_at: T("07:36"), decision: "approved" })
  await patch("job_cards", `id=eq.${job.id}`, { status_since: T("07:36") })

  // 5. 08:12: המכונאי, בעמדה ליד ליפט 2
  await at("08:12")
  await rebase("08:12")
  const m = await (await contextFor(PHONE, true)).newPage()
  await go(m, "/station")
  await m.click("text=לבקש מדניאל לחבר")
  await m.waitForSelector(".station-req-code", { timeout: 60_000 })
  const code = (await m.textContent(".station-req-code")).trim()
  const open = (await rpc("open_station_requests", {}, daniel)) ?? []
  const asked = open.find((x) => x.code === code)
  if (!asked) throw new Error(`station request ${code} not found`)
  made.stationRequests.push(asked.id)
  await rpc("approve_station_request", { p_id: asked.id, p_lift: 2 }, daniel)
  await m.waitForSelector("text=מי עובד כאן עכשיו?", { timeout: 60_000 })
  const paired = (await get(`station_requests?id=eq.${asked.id}&select=station_id`))[0]
  if (paired?.station_id) made.stations.push(paired.station_id)
  await m.click('.station-name:has-text("מוטי")')
  await m.waitForSelector(".pin-pad")
  for (const digit of String(process.env.STATION_DEMO_PIN ?? "")) await m.click(`.pin-key[aria-label="${digit}"]`)
  await m.waitForURL(/\/staff\/lift/, { timeout: 60_000 })
  await at("08:14")
  await go(m, "/staff/lift")
  await shot(m, "f06-lift-queue")

  // למשוך לליפט (פעולה אמיתית, בלי הודעה). השעונים שהמסד קבע מוזזים לשעה של הסרטון.
  await m.click('button:text-is("למשוך לליפט 2")')
  await m.waitForSelector("text=להתחיל אבחון", { timeout: 60_000 })
  await patch("job_cards", `id=eq.${job.id}`, { lift_since: T("08:15"), status_since: T("08:15") })
  await at("08:16")
  await go(m, "/staff/lift")
  await shot(m, "f07-diagnose-first")
  await m.locator("text=להתחיל אבחון").first().click()
  await m.waitForURL(/\/staff\/inspect\//, { timeout: 60_000 })
  await shot(m, "f08-inspect")

  // 6. 08:38: האבחון הסתיים, ורפידות הבלמים באדום: צילום ומשפט אחד
  const finding = await insert("findings", {
    job_card_id: job.id, source: "voice", status: "draft", model: "gemini-2.5-pro", created_by: STAFF["מוטי"]?.id, created_at: T("08:38"),
    title: "החלפת רפידות בלם קדמיות", summary: "רפידות קדמיות שחוקות, 2 מ\"מ.", urgency: "red", safety: true,
    transcript: "הרפידות מקדימה גמורות, נשאר בערך שני מילימטר, צריך להחליף.",
    warranty_original: "12 חודשים", warranty_aftermarket: "6 חודשים", part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.",
  })
  const jobPhoto = await upload("job-media", `job-${job.id}/guide-${finding.id}.jpg`, "brakes.jpg")
  await insert("media", { job_card_id: job.id, finding_id: finding.id, kind: "photo", storage_path: jobPhoto, mime: "image/jpeg", bytes: 1, created_by: STAFF["מוטי"]?.id })
  await patch("job_cards", `id=eq.${job.id}`, { inspected_at: T("08:37"), inspected_by: STAFF["מוטי"]?.id, status: "waiting_quote" })
  await patch("job_cards", `id=eq.${job.id}`, { status_since: T("08:38") })
  await at("08:40")
  await rebase("08:40")
  await go(m, "/staff/lift")
  await shot(m, "f09-lift-finding")

  // 7. 09:05: אצל דניאל. בוחר עבודה מהמחירון, והנוסח ללקוח מוכן
  await patch("findings", `id=eq.${finding.id}`, {
    ...fromList("brakes-front-pads"), eta: "היום עד 15:00",
    customer_text: "רפידות הבלם הקדמיות כמעט גמורות (נשארו 2 מ\"מ). זה עניין של בטיחות, ממליצים להחליף עכשיו.",
  })
  await at("09:05")
  await rebase("09:05")
  await go(d, "/staff")
  await shot(d, "f10-board-queue", 'section[aria-labelledby="g-queue"]')
  await at("09:08")
  await go(d, `/staff/job/${job.id}`)
  await shot(d, "f11-pricing", 'section[aria-labelledby="send-title"]')

  // 09:12: נשלח (בלי ללחוץ "לשלוח ללקוח": משם יוצאת הודעה)
  const quoteToken = await rpc("send_quote_request", { p_job_id: job.id, p_finding_ids: [finding.id] }, daniel)
  await patch("quote_requests", `token=eq.${quoteToken}`, { sent_at: T("09:12") })
  const ap = (await get(`approvals?finding_id=eq.${finding.id}&select=token`))[0]
  await patch("approvals", `finding_id=eq.${finding.id}`, { sent_at: T("09:12") })
  await patch("findings", `id=eq.${finding.id}`, { sent_at: T("09:12"), sent_by: STAFF["דניאל"]?.id ?? null })
  const shared = await upload("shared-quotes", `${ap.token}/guide-${finding.id}.jpg`, "brakes.jpg")
  await rpc("set_approval_photos", { p_token: ap.token, p_paths: [shared] }, daniel)
  await patch("job_cards", `id=eq.${job.id}`, { status: "waiting_approval" })
  await patch("job_cards", `id=eq.${job.id}`, { status_since: T("09:12") })

  // 8. 09:14: בעמדה, הכפתור הגדול: להוריד לחניה
  await at("09:14")
  await rebase("09:14")
  await go(m, "/staff/lift")
  await shot(m, "f12-lift-park")
  await patch("job_cards", `id=eq.${job.id}`, { lift: null, lift_since: null, parked_at: T("09:15") })

  // 9. 09:48: דנה פותחת את הקישור
  await at("09:48")
  await go(c, `/approve/${quoteToken}`)
  await shot(c, "f13-approve")

  // דנה אישרה (חלק מקורי)
  const pf = (await get(`findings?id=eq.${finding.id}&select=price_original`))[0]
  await patch("approvals", `finding_id=eq.${finding.id}`, { decision: "approved", part_choice: "original", price_chosen: pf.price_original, decided_at: T("09:50") })
  await patch("quote_requests", `token=eq.${quoteToken}`, { decided_at: T("09:50"), decision: "approved" })
  await patch("findings", `id=eq.${finding.id}`, { status: "approved" })
  await patch("job_cards", `id=eq.${job.id}`, { status: "in_progress" })
  await patch("job_cards", `id=eq.${job.id}`, { status_since: T("09:50") })

  // 10. 09:52: אצל דניאל, "הלקוח אישר: להחזיר לתור"
  await at("09:52")
  await rebase("09:52")
  await go(d, "/staff")
  await shot(d, "f14-board-requeue", 'section[aria-labelledby="g-requeue"]')

  // חזר לראש התור, ומוטי משך אותו שוב לליפט 2
  await patch("job_cards", `id=eq.${job.id}`, { parked_at: null, priority_at: T("09:53"), lift: 2 })
  await patch("job_cards", `id=eq.${job.id}`, { lift_since: T("10:05"), status_since: T("10:05") })

  // 11. 14:28: העבודה גמורה, "סיימתי"
  await at("14:28")
  await rebase("14:28")
  await go(m, "/staff/lift")
  await shot(m, "f15-lift-finish")
  await m.click('button:has-text("סיימתי את העבודה")')
  // 066: "סיימתי" שואל אם הרכב סגור וכשיר לנסיעה. "כן" פעיל אחרי חצי שנייה.
  await m.waitForTimeout(700)
  await m.click('button:has-text("כן, סיימתי, להוריד לחניה")')
  await m.waitForTimeout(2500)
  await patch("job_cards", `id=eq.${job.id}`, { work_done_at: T("14:30") })
  await patch("help_calls", `job_card_id=eq.${job.id}&kind=eq.done`, { created_at: T("14:30") })
  await at("14:31")
  await go(m, "/staff/lift")
  await shot(m, "f16-lift-free")

  // 12. 14:44: בלוח, "קוראים לך": בדקתי · הרכב מוכן
  await at("14:44")
  await rebase("14:44")
  await go(d, "/staff")
  await shot(d, "f17-board-calls", 'section[aria-labelledby="g-calls"]')

  // 14:46: מוכן (בלי ללחוץ: משם יוצאת ההודעה "הרכב מוכן")
  await patch("job_cards", `id=eq.${job.id}`, { status: "ready", ready_at: T("14:46") })
  await patch("job_cards", `id=eq.${job.id}`, { status_since: T("14:46") })
  await patch("help_calls", `job_card_id=eq.${job.id}`, { resolved_at: T("14:46"), resolved_by: STAFF["דניאל"]?.id ?? null })
  await at("14:47")
  await go(d, "/staff")
  await shot(d, "f18-board-ready", 'section[aria-labelledby="g-ready"]')
} catch (e) {
  failed = e
  console.error("✗", e.message)
} finally {
  if (Object.keys(hotspots).length) writeFileSync(resolve(OUT, "../../../hotspots.json"), JSON.stringify(hotspots, null, 1))
  await browser.close()
  await cleanup()
  if (STAFF["מוטי"]) await patch("staff", `id=eq.${STAFF["מוטי"].id}`, { lift: motiLift }).catch(() => {})
  writeFileSync(FAKE, JSON.stringify({ t: Date.now(), at: Date.now() }))
  const left = await get(`job_cards?notes=like.${encodeURIComponent("מדריך*")}&select=id`)
  const leftB = await get(`bookings?cal_uid=like.guide-*&select=id`)
  console.log(`\n${shots.length} צילומים · נוקה: ${left.length === 0 && leftB.length === 0 ? "כן" : `נשארו ${left.length} כרטיסים, ${leftB.length} תורים`}`)
}
process.exit(failed ? 1 : 0)
