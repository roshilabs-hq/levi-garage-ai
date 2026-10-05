// צילומי המסך של המדריכים (04-empower/guides/img), אוטומטית.
//
// הרצה, מתוך 04-empower/capture:
//   npm run capture                 # הכול
//   npm run capture -- d2 c0        # רק התמונות האלה (לפי תחילת השם)
//
// למה זה קיים (רועי, 2.10): 26 התמונות צולמו ביד, ואחרי כל סבב בדיקות חצי מהן
// מתיישנות (מסך העמדה, הקבלה, הלוח). כאן: יום עבודה שלם להדגמה נבנה במסד, כל
// מסך מצולם בגודל שלו, והכול נמחק בסוף, גם אם משהו נכשל. שינוי במסך = הרצה חוזרת.
//
// הנתונים: תורים עם cal_uid שמתחיל ב-guide-, כרטיסים עם notes שמתחיל ב"מדריך".
// הסיסמאות והקוד נקראים מ-levi-garage/.env.staff.local ולא מודפסים.
// דפדפן: Chrome שמותקן במחשב (channel: "chrome").

import { createHmac } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

import { passwordFor } from "../../03-rollout/solution-4-app/test/_auth.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, "../guides/img")
mkdirSync(OUT, { recursive: true })

const BASE = process.env.CAPTURE_BASE || "https://levi-garage.co.il"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (!serviceKey) throw new Error("חסר SUPABASE_SECRET_KEY")
const ONLY = process.argv.slice(2)
const want = (name) => ONLY.length === 0 || ONLY.some((p) => name.startsWith(p))

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
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
/** עוד X דקות, מעוגל לרבע שעה: תורים שעוד יגיעו היום, בכל שעה שמריצים. */
const later = (min) => {
  const d = new Date(Date.now() + min * 60_000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  return d.toISOString()
}

const made = { stations: [], stationRequests: [], files: [] }
const PHOTOS = resolve(here, "../../levi-garage/public/demo-photos")

/** תמונת הדגמה לאחסון (job-media לצוות, shared-quotes לדף הלקוח). */
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

// ------------------------------------------------------------------ יום ההדגמה

const STAFF = Object.fromEntries(
  ((await (await admin(`/rest/v1/staff?select=id,full_name,role`)).json()) ?? []).map((s) => [s.full_name.split(" ")[0], s]),
)

async function seed() {
  const day = {}
  // תורים להיום: שניים שעוד לא הגיעו, ואחד שמגיע לקבלה.
  day.b1 = await insert("bookings", {
    cal_uid: "guide-1", plate: "8215376", customer_name: "רונית ברק", customer_phone: "0500000001", whatsapp_consent: true,
    service: "טיפול תקופתי", drop_off_at: later(40), status: "booked", vehicle_found: true,
    vehicle_make: "סקודה", vehicle_model: "FABIA", vehicle_year: 2012, engine_code: "CBZ", fuel: "בנזין",
  })
  day.b2 = await insert("bookings", {
    cal_uid: "guide-2", plate: "5748301", customer_name: "עומר כהן", customer_phone: "0500000002", whatsapp_consent: true,
    service: "הכנה וליווי לטסט", drop_off_at: later(100), status: "booked", vehicle_found: true,
    vehicle_make: "יונדאי", vehicle_model: "TUCSON", vehicle_year: 2017, fuel: "בנזין",
  })

  // השעונים של השלב נקבעים בטריגר לרגע ההכנסה; מזיזים אותם אחורה בעדכון נפרד,
  // שלא נוגע ב-lift ובסטטוס (כמו ב-levi-garage/scripts/seed-demo-floor.mjs).
  const car = async ({ since = 30, ...over }) => {
    const row = await insert("job_cards", {
      status: "in_progress", lift: null, customer_phone: "0500000009", whatsapp_consent: true,
      updates_consent_at: ago(240), work_approved_at: ago(200), work_approved_via: "link",
      notes: "מדריך · צילומי מסך", ...over,
    })
    await patch("job_cards", `id=eq.${row.id}`, { status_since: ago(since), lift_since: row.lift ? ago(since) : null })
    return row
  }

  // על ליפט 1: עובדים עליו.
  day.onLift = await car({ plate: "6620417", vehicle_make: "טויוטה", vehicle_model: "COROLLA", vehicle_year: 2019, customer_name: "דנה לוי", lift: 1, opened_at: ago(150), inspected_at: ago(120), since: 95 })
  // ממצאים שמחכים לדניאל (טיוטות), על ליפט 3.
  day.toPrice = await car({ plate: "4471290", vehicle_make: "קיה", vehicle_model: "SPORTAGE", vehicle_year: 2016, customer_name: "נטלי אבידן", lift: 3, status: "waiting_quote", opened_at: ago(140), inspected_at: ago(100), since: 18 })
  // נשלח ללקוח, מחכה לתשובה, בחניה.
  day.waiting = await car({ plate: "3921574", vehicle_make: "רנו", vehicle_model: "MEGANE", vehicle_year: 2015, customer_name: "יוסי מזרחי", status: "waiting_quote", opened_at: ago(230), inspected_at: ago(200), parked_at: ago(90), since: 80 })
  // הלקוח אישר, הרכב בחניה: להחזיר לתור.
  day.requeue = await car({ plate: "9034412", vehicle_make: "מאזדה", vehicle_model: "6", vehicle_year: 2018, customer_name: "אורי שפירא", status: "in_progress", opened_at: ago(260), inspected_at: ago(230), parked_at: ago(70), since: 70 })
  // המכונאי סיים, הליפט התפנה, מחכה לבדיקה של דניאל.
  day.done = await car({ plate: "7715360", vehicle_make: "סוזוקי", vehicle_model: "SWIFT", vehicle_year: 2020, customer_name: "שירן אדרי", status: "in_progress", opened_at: ago(300), inspected_at: ago(270), parked_at: ago(25), work_done_at: ago(25), since: 25 })
  // מוכן, מחכה ללקוח.
  day.ready = await car({ plate: "5503187", vehicle_make: "פולקסווגן", vehicle_model: "POLO", vehicle_year: 2014, customer_name: "גלית חורי", status: "ready", opened_at: ago(320), inspected_at: ago(290), ready_at: ago(35), since: 35 })
  // התקבל בדלפק, מחכה לאישור הלקוח על הצעת הקבלה (036).
  day.intake = await car({
    plate: "8815023", vehicle_make: "יונדאי", vehicle_model: "i20", vehicle_year: 2017, customer_name: "מרים אבו-חאטום",
    status: "open", opened_at: ago(12), work_approved_at: null, work_approved_via: null, since: 12,
  })
  // בתור לליפט.
  day.queued = await car({ plate: "2640918", vehicle_make: "שברולט", vehicle_model: "SPARK", vehicle_year: 2015, customer_name: "אבי פרץ", status: "open", opened_at: ago(30), since: 22 })

  // שורות הצעה (קבלה) לכל רכב, כדי שהכרטיס והדפים יהיו מלאים.
  const service = (job, title, price, hours, after = null) =>
    insert("quote_items", {
      job_card_id: job.id, title, labor_hours: hours, price_original: price, price_aftermarket: after,
      warranty_original: after ? "12 חודשים" : "3 חודשים", warranty_aftermarket: after ? "6 חודשים" : null,
      part_diff: after ? "מקורי: של יצרן הרכב. חלופי: יצרן מוכר, באותו מפרט, זול יותר." : null,
      single_reason: after ? null : "עבודה בלבד, בלי חלקים.", part_choice: after ? "aftermarket" : "original",
    })
  for (const j of [day.onLift, day.toPrice, day.waiting, day.requeue, day.done, day.ready, day.queued]) await service(j, "טיפול 30,000", 690, 1.5, 520)
  await service(day.intake, "טיפול 60,000", 1150, 2.5, 890)
  await service(day.intake, "אבחון נורת מנוע", 250, 1)

  // ממצאים: שניים שמחכים לדניאל, ושניים שכבר נשלחו ללקוח.
  const finding = (job, f) =>
    insert("findings", {
      job_card_id: job.id, source: "voice", status: "draft", model: "gemini-2.5-pro",
      warranty_original: "12 חודשים", warranty_aftermarket: "6 חודשים",
      part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.", created_at: ago(18), ...f,
    })
  // תמונה מהעמדה, כמו שהמכונאי מצלם (ממצא אדום או בטיחותי חייב תמונה).
  const photo = async (job, f, file) => {
    const path = await upload("job-media", `job-${job.id}/guide-${f.id}.jpg`, file)
    await insert("media", { job_card_id: job.id, finding_id: f.id, kind: "photo", storage_path: path, mime: "image/jpeg", bytes: 1, created_by: STAFF["מוטי"]?.id })
  }
  // 5.10: ממצאים שדניאל כבר בחר להם עבודה מהמחירון, ולכן עם המחירים שלו. בלי
  // price_list_id, הבחירה בצילום נראתה ריקה, והמחירים לא תאמו את המחירון באתר.
  const res = await admin(`/rest/v1/price_list?select=id,code,price_original,price_aftermarket,labor_hours`)
  const PL = Object.fromEntries((await res.json()).map((r) => [r.code, r]))
  const fromList = (code, qty = 1) => {
    const r = PL[code]
    if (!r) throw new Error(`price_list: אין ${code}`)
    return {
      price_list_id: r.id, quantity: qty, labor_hours: Number(r.labor_hours) * qty,
      price_original: Number(r.price_original) * qty, price_aftermarket: r.price_aftermarket === null ? null : Number(r.price_aftermarket) * qty,
    }
  }
  const p1 = await finding(day.toPrice, {
    title: "החלפת רפידות בלם קדמיות", summary: "רפידות קדמיות שחוקות, 2 מ\"מ.", urgency: "red", safety: true,
    transcript: "הרפידות מקדימה גמורות, נשאר בערך שני מילימטר, צריך להחליף.",
    customer_text: "רפידות הבלם הקדמיות כמעט גמורות. זה עניין של בטיחות, ממליצים להחליף עכשיו.",
    ...fromList("brakes-front-pads"), eta: "היום עד 16:00",
  })
  const p2 = await finding(day.toPrice, {
    title: "החלפת מגבים (זוג)", summary: "מגבים קדמיים סדוקים.", urgency: "yellow",
    transcript: "שני המגבים מקדימה סדוקים, משאירים פסים.",
    customer_text: "שני המגבים הקדמיים סדוקים ומשאירים פסים על השמשה.",
    ...fromList("wipers"),
  })
  const w1 = await finding(day.waiting, {
    title: "החלפת משאבת מים", summary: "נזילה ממשאבת המים.", urgency: "red",
    transcript: "יש נזילה מהמשאבת מים, רואים סימנים של נוזל קירור.",
    customer_text: "מצאנו נזילה ממשאבת המים. אם לא מטפלים, המנוע עלול להתחמם.",
    ...fromList("water-pump"), eta: "מחר עד 12:00",
  })
  const w2 = await finding(day.waiting, {
    title: "2 × החלפת צמיג", summary: "שני צמיגים קדמיים שחוקים.", urgency: "yellow",
    transcript: "הצמיגים מקדימה כבר על הסף.",
    customer_text: "שני הצמיגים הקדמיים שחוקים, קרוב לגבול המותר.",
    ...fromList("tire-one", 2),
  })
  await photo(day.toPrice, p1, "brakes.jpg")
  await photo(day.toPrice, p2, "wiper.jpg")
  await photo(day.waiting, w1, "oil-leak.jpg")
  await photo(day.waiting, w2, "tire.jpg")
  const daniel = await tokenOf("test1@test.com")
  day.requestToken = await rpc("send_quote_request", { p_job_id: day.waiting.id, p_finding_ids: [w1.id, w2.id] }, daniel)
  await patch("quote_requests", `token=eq.${day.requestToken}`, { sent_at: ago(80) })
  // התמונות שהלקוח רואה בדף האישור (בדלפק זה קורה ב-sharePhotos, בשליחה).
  for (const [f, file] of [[w1, "oil-leak.jpg"], [w2, "tire.jpg"]]) {
    const ap = (await (await admin(`/rest/v1/approvals?finding_id=eq.${f.id}&select=token`)).json())[0]
    const path = await upload("shared-quotes", `${ap.token}/guide-${f.id}.jpg`, file)
    await rpc("set_approval_photos", { p_token: ap.token, p_paths: [path] }, daniel)
  }
  await patch("job_cards", `id=eq.${day.waiting.id}`, { parked_at: ago(90) })
  day.intakeToken = await rpc("send_intake_request", { p_job_id: day.intake.id }, daniel)
  day.daniel = daniel
  await patch("quote_requests", `token=eq.${day.intakeToken}`, { sent_at: ago(10) })

  // קריאות: "בוא לעמדה" מליפט 1, ו"סיימתי" של הסוזוקי.
  await insert("help_calls", { job_card_id: day.onLift.id, kind: "help", lift: 1, requested_by: STAFF["מוטי"]?.id, created_at: ago(4) })
  await insert("help_calls", { job_card_id: day.done.id, kind: "done", lift: 2, requested_by: STAFF["אלכס"]?.id, created_at: ago(25) })
  return day
}

// ------------------------------------------------------------------ דפדפן

const browser = await chromium.launch({ channel: "chrome" })
const DESK = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }

async function contextFor(viewport, mobile = false) {
  return browser.newContext({
    viewport, deviceScaleFactor: 1, colorScheme: "light", locale: "he-IL", timezoneId: "Asia/Jerusalem",
    isMobile: mobile, hasTouch: mobile,
  })
}
async function signIn(email, viewport = DESK) {
  const ctx = await contextFor(viewport)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/staff/login`)
  await page.fill("#email", email)
  await page.fill("#password", passwordFor(email))
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20_000 }), page.click('button[type="submit"]')])
  return page
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(400)
}
const shots = []
// 5.10: המדריך האינטראקטיבי (/training). לכל צילום נרשמים המיקום והטקסט של כל
// כפתור, קישור ושדה שנראים בו, ביחס לתמונה. ככה הנקודות הממוספרות על הצילום
// זזות יחד עם המסך, בכל פעם שמצלמים מחדש.
const hotspots = {}
async function recordHotspots(page, name, origin, size) {
  const items = await page.evaluate(({ ox, oy, w, h }) => {
    const SEL = 'button, a[href], select, textarea, summary, [role="button"], [role="tab"], input:not([type="hidden"])'
    const seen = new Set()
    const out = []
    for (const raw of document.querySelectorAll(SEL)) {
      // תיבת סימון או בחירה בתוך תווית: הנקודה על התווית, עם הטקסט שלה.
      const n = raw.matches('input[type="checkbox"], input[type="radio"]') ? raw.closest("label") || raw : raw
      if (seen.has(n)) continue
      seen.add(n)
      // כפתור בתוך תפריט סגור (<details>) מקבל מידות, אבל לא נראה בצילום.
      if (n.checkVisibility && !n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) continue
      const st = getComputedStyle(n)
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) continue
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
async function shot(page, name, target = null, opts = {}) {
  if (!want(name)) return
  await settle(page)
  const path = resolve(OUT, `${name}.png`)
  // פס "לשלוח" שנדבק לתחתית המסך מכסה תוכן בצילום של אזור ארוך.
  await page.addStyleTag({ content: ".qb-send, .req-foot { position: static !important; }" })
  if (target) {
    const el = typeof target === "string" ? page.locator(target).first() : target
    await el.scrollIntoViewIfNeeded()
    // שוליים מסביב לאזור, כדי שהכותרת לא תיחתך בקצה.
    const box = await el.evaluate((n) => {
      const r = n.getBoundingClientRect()
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
    })
    const vw = page.viewportSize().width
    const pad = 16
    const x = Math.max(0, box.x - pad)
    await page.screenshot({
      path,
      animations: "disabled",
      fullPage: true,
      clip: { x, y: Math.max(0, box.y - pad), width: Math.min(vw - x, box.width + pad * 2), height: box.height + pad * 2 },
    })
    await recordHotspots(page, name, { x, y: Math.max(0, box.y - pad) }, { width: Math.min(vw - x, box.width + pad * 2), height: box.height + pad * 2 })
  } else {
    await page.screenshot({ path, fullPage: opts.fullPage ?? false, animations: "disabled" })
    const vp = page.viewportSize()
    if (opts.fullPage) {
      const full = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
      await recordHotspots(page, name, { x: 0, y: 0 }, { width: vp.width, height: full.height })
    } else {
      const sc = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      await recordHotspots(page, name, sc, vp)
    }
  }
  shots.push(name)
  console.log(`✓ ${name}`)
}

// ------------------------------------------------------------------ הצילומים

// הכניסה בעמדה קובעת למכונאי את הליפט (set_my_lift). מחזירים בסוף למה שהיה.
const motiLift = (await (await admin(`/rest/v1/staff?id=eq.${STAFF["מוטי"]?.id}&select=lift`)).json())[0]?.lift ?? null

let failed = null
try {
  await cleanup()
  const day = await seed()

  // דניאל, במחשב
  const d = await signIn("test1@test.com")
  await d.goto(`${BASE}/staff`)
  await shot(d, "d1-board-arriving", 'section[aria-labelledby="g-arriving"]')
  await shot(d, "d2b-board-intake", 'section[aria-labelledby="g-intake"]')
  await shot(d, "d5-board-queue", 'section[aria-labelledby="g-queue"]')
  await shot(d, "d7-requeue", 'section[aria-labelledby="g-requeue"]')
  await shot(d, "d8-calls", 'section[aria-labelledby="g-calls"]')
  await shot(d, "d0-board-top")

  await d.goto(`${BASE}/staff/arrive/${day.b1.id}`)
  await shot(d, "d2-arrive-form", ".arrive-form")

  await d.goto(`${BASE}/staff/job/${day.intake.id}`)
  await shot(d, "d11-job-intake", ".intake-note")

  await d.goto(`${BASE}/staff/job/${day.toPrice.id}`)
  await shot(d, "d6-pricing", 'section[aria-labelledby="send-title"]')

  await d.goto(`${BASE}/staff/job/${day.done.id}`)
  await shot(d, "d9-job-card")

  await d.goto(`${BASE}/staff/floor`)
  await shot(d, "d3-floor-queue")
  await shot(d, "d10-floor-done", 'section:has(h2:text-is("הסתיים")), .chain-col:has(h2:text-is("הסתיים"))')

  // עמדות: מכשיר שמבקש להתחבר, כדי שיראו את "לאשר" ו"לא לאשר".
  // 044: פתיחת בקשה דורשת את מפתח השרת, כמו ש-lib/staff/station.ts שולח.
  const req = await rpc("request_station", { p_key: createHmac("sha256", process.env.STATION_SECRET ?? "").update("station-rpc").digest("hex") })
  const reqRow = (await (await admin(`/rest/v1/station_requests?code=eq.${req.code}&select=id&order=created_at.desc&limit=1`)).json())[0]
  if (reqRow) made.stationRequests.push(reqRow.id)
  await d.goto(`${BASE}/staff/stations`)
  await shot(d, "d4-stations-requests", 'section[aria-labelledby="g-station-req"]')
  await shot(d, "d4-stations-qr", 'section[aria-labelledby="qr-title"]')

  // אבי
  const a = await signIn("test3@test.com")
  await a.goto(`${BASE}/staff/dashboard`)
  await shot(a, "a1-dashboard")

  // המסכים התלויים
  const wall = await signIn("screen2@test.com", { width: 1280, height: 720 })
  await wall.goto(`${BASE}/wall`)
  await wall.waitForTimeout(10_500) // הטלוויזיה מתחלפת כל 10 שניות; השנייה היא "בטיפול"
  await shot(wall, "s1-wall")
  const lobby = await signIn("screen1@test.com", { width: 1280, height: 720 })
  await lobby.goto(`${BASE}/lobby`)
  await shot(lobby, "s2-lobby")

  // המכונאי, בעמדה (טלפון ליד ליפט 2, שפנוי ביום ההדגמה)
  const m = await (await contextFor(PHONE, true)).newPage()
  await m.goto(`${BASE}/station`)
  await m.click("text=לבקש מדניאל לחבר")
  await m.waitForSelector(".station-req-code")
  await m.click("text=דניאל כאן? לאשר עם הקוד שלו")
  await m.waitForSelector(".here-q")
  await m.click('.here-approve button:text-is("ליפט 2")')
  await shot(m, "m0-station-request", null, { fullPage: true })
  // דניאל מאשר מהלוח (את הקוד שלו לא מקלידים בצילום)
  const code = (await m.textContent(".station-req-code")).trim()
  const open = (await rpc("open_station_requests", {}, day.daniel)) ?? []
  const asked = open.find((x) => x.code === code)
  if (!asked) throw new Error(`station request ${code} not found`)
  made.stationRequests.push(asked.id)
  await rpc("approve_station_request", { p_id: asked.id, p_lift: 2 }, day.daniel)
  await m.waitForSelector("text=מי עובד כאן עכשיו?", { timeout: 20_000 })
  const paired = (await (await admin(`/rest/v1/station_requests?id=eq.${asked.id}&select=station_id`)).json())[0]
  if (paired?.station_id) made.stations.push(paired.station_id)
  await shot(m, "m1-station-names", null, { fullPage: true })

  await m.click('.station-name:has-text("מוטי")')
  await m.waitForSelector(".pin-pad")
  await shot(m, "m2-pin", null, { fullPage: true })
  for (const digit of String(process.env.STATION_DEMO_PIN ?? "")) await m.click(`.pin-key[aria-label="${digit}"]`)
  await m.waitForURL(/\/staff\/lift/, { timeout: 20_000 })
  await shot(m, "m3-lift-queue", null, { fullPage: true })

  await m.click('button:text-is("למשוך לליפט 2")')
  await m.waitForSelector("text=להתחיל אבחון")
  await shot(m, "m4-diagnose-first", null, { fullPage: true })
  await m.locator("text=להתחיל אבחון").first().click()
  await m.waitForURL(/\/staff\/inspect\//)
  await shot(m, "m5-inspect", null, { fullPage: true })

  // האבחון הסתיים (את תשעת הפריטים לא מסמנים בצילום)
  await patch("job_cards", `id=eq.${day.queued.id}`, { inspected_at: ago(1) })
  await m.goto(`${BASE}/staff/lift`)
  await shot(m, "m6-lift-working", null, { fullPage: true })
  await m.click("button.gem-link")
  await m.waitForTimeout(600)
  await shot(m, "m9-mentor")
  await m.click('button[aria-label="סגירה, חזרה לעמדה"]')

  // שני ממצאים: אחד אצל דניאל (טיוטה), ואחד שנשלח ומחכה ללקוח. אז הכפתור הראשי
  // הוא "להוריד מהליפט לחניה": הליפט לא מחכה לתשובה.
  const extra = (f) =>
    insert("findings", {
      job_card_id: day.queued.id, source: "voice", model: "gemini-2.5-pro", created_at: ago(9),
      warranty_original: "12 חודשים", warranty_aftermarket: "6 חודשים", labor_hours: 1,
      part_diff: "מקורי: של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.", ...f,
    })
  const fx1 = await extra({ status: "draft", title: "מסנן אוויר", summary: "מסנן אוויר סתום.", urgency: "yellow", customer_text: "מסנן האוויר סתום.", price_original: 120, price_aftermarket: 80 })
  const fx2 = await extra({ status: "sent", title: "נורת בלם אחורית", summary: "נורת בלם שמאלית שרופה.", urgency: "yellow", customer_text: "נורת הבלם השמאלית שרופה.", price_original: 60, price_aftermarket: 40, sent_at: ago(6) })
  await patch("job_cards", `id=eq.${day.queued.id}`, { status: "waiting_approval" })
  await m.goto(`${BASE}/staff/lift`)
  await shot(m, "m7-waiting", null, { fullPage: true })

  // הלקוח אישר, דניאל טיפל בטיוטה: נשאר רק "סיימתי". אחרי הלחיצה הליפט מתפנה.
  await patch("findings", `id=eq.${fx1.id}`, { status: "cancelled" })
  await patch("findings", `id=eq.${fx2.id}`, { status: "approved" })
  await patch("job_cards", `id=eq.${day.queued.id}`, { status: "in_progress" })
  await m.goto(`${BASE}/staff/lift`)
  await m.click('button:has-text("סיימתי את העבודה")')
  await m.waitForTimeout(1500)
  await shot(m, "m8-done", null, { fullPage: true })

  // הלקוח, בטלפון: אישור הקבלה, ואישור ממצאים.
  const c = await (await contextFor(PHONE, true)).newPage()
  await c.goto(`${BASE}/approve/${day.intakeToken}`)
  await shot(c, "c0-intake-approve", null, { fullPage: true })
  await c.goto(`${BASE}/approve/${day.requestToken}`)
  await shot(c, "c1-approve", null, { fullPage: true })
} catch (e) {
  failed = e
  console.error("✗", e.message)
} finally {
  // רק כשכל הצילומים רצו: רשימה חלקית הייתה מוחקת נקודות של מסכים שלא צולמו הפעם.
  if (!failed && Object.keys(hotspots).length) {
    const file = resolve(OUT, "..", "hotspots.json")
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
    writeFileSync(file, JSON.stringify({ ...prev, ...hotspots }, null, 1))
    console.log(`נקודות: ${Object.keys(hotspots).length} מסכים`)
  }
  await browser.close()
  await cleanup()
  if (STAFF["מוטי"]) await patch("staff", `id=eq.${STAFF["מוטי"].id}`, { lift: motiLift }).catch(() => {})
  const left = await (await admin(`/rest/v1/job_cards?notes=like.${encodeURIComponent("מדריך*")}&select=id`)).json()
  console.log(`\n${shots.length} צילומים · נוקה: ${left.length === 0 ? "כן" : `נשארו ${left.length}`}`)
}
process.exit(failed ? 1 : 0)
