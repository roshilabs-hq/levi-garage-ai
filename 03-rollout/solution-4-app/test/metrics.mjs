// בודק את החישובים של מסך המדדים (levi-garage/lib/staff/metrics.ts, 1.2.0) עם
// נתונים ידועים מראש: לכל מקרה, מה המסך אמור להציג. בלי מסד ובלי רשת.
//
// הרצה: node 03-rollout/solution-4-app/test/metrics.mjs
// (node 24 מריץ את קובץ ה-TypeScript ישירות.)

import {
  customerResponse,
  discountsSince,
  israel,
  liftDeadMinutesPerDay,
  openMinutesBetween,
  readyByFour,
  writtenApprovals,
} from "../../../levi-garage/lib/staff/metrics.ts"

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

// שעות הפתיחה, כמו ב-levi-garage/lib/hours.ts
const OPENING = [
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "17:00" },
  { open: "07:00", close: "12:00" },
  null,
]

// 2026-10-04 הוא יום ראשון. שעון ישראל באוקטובר: UTC+3.

// ---------- שעון ישראל ושעות פתיחה ----------
ok("16:30 בישראל = 13:30Z", israel("2026-10-04T13:30:00Z").minutes === 16 * 60 + 30)
ok("01:30 בישראל נספר ביום הבא (לא בתאריך של UTC)", israel("2026-10-04T22:30:00Z").date === "2026-10-05")
ok("לילה על הליפט: רק 30 דק' לפני הסגירה ו-60 אחרי הפתיחה", openMinutesBetween("2026-10-04T13:30:00Z", "2026-10-05T05:00:00Z", OPENING) === 90)
ok("שבת לא נספרת", openMinutesBetween("2026-10-10T06:00:00Z", "2026-10-10T12:00:00Z", OPENING) === 0)
ok("שישי נסגר ב-12:00", openMinutesBetween("2026-10-09T08:00:00Z", "2026-10-09T12:00:00Z", OPENING) === 60)

// ---------- ליפט מת (KPI 2) ----------
const moves = [
  { job_card_id: 1, place: "lot", status: "open", moved_at: "2026-10-04T05:00:00Z" },
  { job_card_id: 1, place: "lift", status: "in_progress", moved_at: "2026-10-04T05:10:00Z" },
  { job_card_id: 1, place: "lift", status: "waiting_approval", moved_at: "2026-10-04T06:00:00Z" },
  { job_card_id: 1, place: "parked", status: "waiting_approval", moved_at: "2026-10-04T07:00:00Z" },
  { job_card_id: 2, place: "lift", status: "waiting_approval", moved_at: "2026-10-05T06:00:00Z" },
  { job_card_id: 2, place: "lift", status: "in_progress", moved_at: "2026-10-05T06:20:00Z" },
]
const since = "2026-09-05T00:00:00Z"
ok("60 + 20 דקות על פני 2 ימים = 40 ביום", liftDeadMinutesPerDay(moves, "2026-10-05T10:00:00Z", since, OPENING) === 40)
const withQuote = [...moves, { job_card_id: 3, place: "lift", status: "waiting_quote", moved_at: "2026-10-05T07:00:00Z" }, { job_card_id: 3, place: "lift", status: "in_progress", moved_at: "2026-10-05T07:30:00Z" }]
ok("גם המתנה לדניאל (מחכה לשליחה) על ליפט נספרת: +30", liftDeadMinutesPerDay(withQuote, "2026-10-05T10:00:00Z", since, OPENING) === 55)
const overnight = [{ job_card_id: 4, place: "lift", status: "waiting_approval", moved_at: "2026-10-04T13:30:00Z" }]
ok("רכב שנשאר על הליפט בלילה: רק שעות הפתיחה (90, לא 930)", liftDeadMinutesPerDay(overnight, "2026-10-05T05:00:00Z", since, OPENING) === 90)
ok("בלי תזוזות: אין נתונים", liftDeadMinutesPerDay([], "2026-10-05T05:00:00Z", since, OPENING) === null)

// ---------- מוכן עד 16:00 (KPI 1) ----------
const cards = [
  { id: 1, opened_at: "2026-10-04T05:00:00Z", ready_at: "2026-10-04T10:00:00Z" }, // 13:00
  { id: 2, opened_at: "2026-10-04T05:00:00Z", ready_at: "2026-10-04T12:59:00Z" }, // 15:59
  { id: 3, opened_at: "2026-10-04T05:00:00Z", ready_at: "2026-10-04T13:00:00Z" }, // 16:00, מאוחר
  { id: 4, opened_at: "2026-10-04T05:00:00Z", ready_at: "2026-10-05T06:00:00Z" }, // למחרת
  { id: 5, opened_at: "2026-10-04T05:00:00Z", ready_at: null },
]
const r = readyByFour(cards)
ok("2 מתוך 4 מוכנים עד 16:00, באותו יום", r.onTime === 2 && r.total === 4, JSON.stringify(r))
ok("16:30 בדצמבר (UTC+2) הוא מאוחר", readyByFour([{ id: 1, opened_at: "2026-12-01T06:00:00Z", ready_at: "2026-12-01T14:30:00Z" }]).onTime === 0)

// ---------- זמן תשובה ----------
const approvals = [
  { id: 1, request_id: 10, sent_at: "2026-10-04T05:00:00Z", decided_at: "2026-10-04T05:20:00Z", expires_at: "2026-10-11T05:00:00Z" },
  { id: 2, request_id: 10, sent_at: "2026-10-04T05:00:00Z", decided_at: "2026-10-04T05:20:00Z", expires_at: "2026-10-11T05:00:00Z" },
  { id: 3, request_id: 11, sent_at: "2026-10-04T06:00:00Z", decided_at: "2026-10-04T06:40:00Z", expires_at: "2026-10-11T06:00:00Z" },
  { id: 4, request_id: 12, sent_at: "2026-10-04T07:00:00Z", decided_at: null, expires_at: "2026-10-11T07:00:00Z" },
  { id: 5, request_id: 12, sent_at: "2026-10-04T07:00:00Z", decided_at: null, expires_at: "2026-10-11T07:00:00Z" },
  { id: 6, request_id: 13, sent_at: "2026-09-20T07:00:00Z", decided_at: null, expires_at: "2026-09-27T07:00:00Z" },
]
const cr = customerResponse(approvals, "2026-10-04T09:00:00Z", OPENING)
ok("ממוצע לפי הודעה (20 ו-40) = 30", cr.avg === 30, JSON.stringify(cr))
ok("רכב אחד ממתין (שני ממצאים באותה הודעה), וקישור שפג לא נספר", cr.waiting === 1, JSON.stringify(cr))

// ---------- אישור בכתב (KPI 5) ----------
const w = writtenApprovals([{ work_approved_via: "link" }, { work_approved_via: "print" }, { work_approved_via: "counter" }, { work_approved_via: null }])
ok("2 מתוך 3 אישורים בכתב ('counter' הוא רק סימון של דניאל)", w.written === 2 && w.total === 3, JSON.stringify(w))

// ---------- הנחות ----------
const rows = [
  { status: "approved", discount_reason: "עיכוב שלנו", list_price_original: 1000, list_price_aftermarket: null, approval: { part_choice: "original", price_chosen: 900, decided_at: "2026-10-02T08:00:00Z" } },
  { status: "approved", discount_reason: "לקוח ותיק", list_price_original: 1000, list_price_aftermarket: 600, approval: { part_choice: "aftermarket", price_chosen: 480, decided_at: "2026-10-03T08:00:00Z" } },
  { status: "declined", discount_reason: "x", list_price_original: 500, list_price_aftermarket: null, approval: { part_choice: "original", price_chosen: null, decided_at: "2026-10-03T08:00:00Z" } },
  { status: "approved", discount_reason: "חודש קודם", list_price_original: 1000, list_price_aftermarket: null, approval: { part_choice: "original", price_chosen: 900, decided_at: "2026-09-30T20:00:00Z" } }, // 23:00 בישראל, 30.9
  { status: "approved", discount_reason: "בלי מחירון", list_price_original: null, list_price_aftermarket: null, approval: { part_choice: "original", price_chosen: 300, decided_at: "2026-10-03T08:00:00Z" } },
]
const d = discountsSince(rows, "2026-10-01T00:00:00Z")
ok("הנחות מאז 1.10: 100 + 120 = 220, בשתי הנחות", d.sum === 220 && d.count === 2, JSON.stringify(d))
ok("הנחה שאושרה לפני החלון לא נספרת", !d.reasons.includes("חודש קודם"))
ok("ממצא בלי מחיר מחירון לא נספר כהנחה", !d.reasons.includes("בלי מחירון"))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
