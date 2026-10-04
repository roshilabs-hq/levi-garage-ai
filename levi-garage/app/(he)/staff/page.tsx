import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { elapsed, fmtStamp, fmtTime, minutesSince } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { StationRequests } from "@/components/staff/station-requests"
import { Since } from "@/components/staff/since"
import { decideDiscount, markIntakeSigned, markSafetyReported, requeueCar, resendIntakeRequest, resolveCall, sendRemindersNow, setJobStatus } from "./actions"
import { approvedWaitingForUs, awaitingIntake, placeLabel } from "@/lib/staff/queue"
import { clockOf, heat } from "@/lib/staff/stages"

export const metadata: Metadata = { title: "לוח היום | מוסך לוי ובניו", robots: { index: false, follow: false } }

// לוח היום של דניאל, מסודר לפי מה שדוחף עכשיו ולא לפי סדר הכניסה:
// קודם מי שתקוע ומחכה ללקוח, אחר כך מי שמוכן למסירה, אחר כך מי שבעבודה,
// ובסוף מי שעוד לא הגיע. בכל שורה כתוב מה הצעד הבא.

function Plate({ value }: { value: string }) {
  return <span className="plate-chip num" dir="ltr">{value}</span>
}

// צירוף ב-Supabase חוזר כאובייקט או כמערך, לפי איך שהקשר מוגדר. זה מיישר.
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function carName(c: { vehicle_make: string | null; vehicle_model: string | null; vehicle_year?: number | null }) {
  const name = [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ")
  return (name || "רכב") + (c.vehicle_year ? `, ${c.vehicle_year}` : "")
}

// מה קרה בלחיצה על "לשלוח עכשיו": נשלחו.דולגו.נכשלו.היו
function reminderRunNote(raw: string | undefined) {
  if (!raw || !/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return null
  const [sent, skipped, failed, due] = raw.split(".").map(Number)
  if (due === 0) return "אין תזכורות לשלוח: לכל התורים של מחר כבר נשלחה תזכורת, או שאין תורים."
  const parts = [`נשלחו ${sent}`]
  if (skipped) parts.push(`${skipped} לא נשלחו (הלקוח לא כתב לנו בוואטסאפ ב-14 הימים האחרונים)`)
  if (failed) parts.push(`${failed} נכשלו, ואפשר לנסות שוב`)
  return `תזכורות למחר: ${parts.join(" · ")}.`
}

// "לשלוח שוב" מקבוצת "מחכים לאישור הלקוח" (1.2.0): נשארים בלוח, והתוצאה כאן.
const INTAKE_RESENT: Record<string, string> = {
  sent: "הקישור לאישור ההצעה נשלח שוב ללקוח: במייל אם יש, ובוואטסאפ (אם עברו 10 דקות מהשליחה הקודמת).",
  consent: "הלקוח לא הסכים לעדכונים בוואטסאפ ובמייל: להדפיס את ההצעה ולהחתים אותו.",
  failed: "השליחה נכשלה. לנסות שוב, או להדפיס ולהחתים.",
}

const QUOTE_OUTCOME: Record<string, string> = {
  sent: "הצעת המחיר נשלחה ללקוח במייל",
  noemail: "המייל עוד לא מחובר: להדפיס את ההצעה",
  failed: "המייל עם ההצעה לא יצא: לשלוח שוב מהכרטיס, או להדפיס",
  print: "ההצעה הודפסה",
}

export default async function StaffBoard({
  searchParams,
}: {
  searchParams: Promise<{ reminders?: string; received?: string; quote?: string; intake?: string; intake_resent?: string }>
}) {
  const staff = await requireStaff()
  const supabase = await createClient()
  const { reminders, received, quote, intake: intakeSent, intake_resent: intakeResent } = await searchParams
  const runNote = reminderRunNote(reminders)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const twoWeeks = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000)

  const [{ data: cards }, { data: booked }, { data: later }, { data: drafts }, { data: calls }, { data: safety }, { data: pending }] = await Promise.all([
    supabase
      .from("job_cards")
      .select("id, plate, vehicle_make, vehicle_model, vehicle_year, status, lift, opened_at, lift_since, status_since, customer_name, customer_phone, parked_at, outside_at, priority_at, work_done_at, work_approved_at")
      .not("status", "in", "(delivered,cancelled)")
      .order("opened_at", { ascending: true }),
    supabase
      .from("bookings")
      .select("id, plate, customer_name, service, drop_off_at, status, vehicle_make, vehicle_model, whatsapp_consent")
      .gte("drop_off_at", today.toISOString())
      .lt("drop_off_at", tomorrow.toISOString())
      .in("status", ["booked", "rescheduled"])
      .order("drop_off_at", { ascending: true }),
    // לקוח שמגיע לפני המועד שלו צריך את אותו כפתור. בלי זה, תור של מחר לא
    // היה נגיש מהלוח בכלל, והיה צריך לחכות למחר כדי לפתוח לו כרטיס.
    supabase
      .from("bookings")
      .select("id, plate, customer_name, service, drop_off_at, status, vehicle_make, vehicle_model, whatsapp_consent")
      .gte("drop_off_at", tomorrow.toISOString())
      .lt("drop_off_at", twoWeeks.toISOString())
      .in("status", ["booked", "rescheduled"])
      .order("drop_off_at", { ascending: true })
      .limit(40),
    // הממצאים שמחכים לדניאל. זה התור שהמחקר מצא שהוא צוואר הבקבוק האמיתי:
    // שישה מכונאים מול מנהל עבודה אחד. אדום קודם, ובתוך צבע — הוותיק קודם.
    supabase
      .from("findings")
      .select("id, title, summary, urgency, safety, red_list, source, created_at, media(kind), job_cards!inner(id, plate, vehicle_make, vehicle_model, lift)")
      .eq("status", "draft")
      .order("created_at", { ascending: true }),
    // "בוא לעמדה" ו"סיימתי" שעוד לא טופלו.
    supabase
      .from("help_calls")
      .select("id, kind, lift, created_at, job_card_id, job_cards(plate, vehicle_make, vehicle_model), staff:requested_by(full_name)")
      .is("resolved_at", null)
      .order("created_at", { ascending: true }),
    // ליקוי בטיחותי שהלקוח דחה ועוד לא דווח (תקנה 6: תוך יום עבודה מהמסירה).
    supabase
      .from("findings")
      .select("id, title, summary, job_cards!inner(id, plate, status, delivered_at, customer_name)")
      .eq("status", "declined")
      .eq("safety", true)
      .is("safety_reported_at", null),
    // קישורים שנשלחו ועוד לא נענו. אחרי 30 דקות יוצאת תזכורת לבד (018);
    // אחרי שעה — דניאל מתקשר. זה ההבדל בין ליפט מת לבין שיחה של דקה.
    supabase
      .from("findings")
      .select("id, title, summary, approvals!inner(sent_at, nudged_at, decision), job_cards!inner(id, plate, customer_name, customer_phone)")
      .eq("status", "sent")
      .is("approvals.decision", null),
  ])

  const all = cards ?? []
  const waiting = all.filter((c) => c.status === "waiting_approval")
  // המכונאי סיים וצריך שדניאל ישלח. זה תור שלנו, לא של הלקוח, ולכן הוא
  // מופיע בנפרד: זה הזמן היחיד בשרשרת שאנחנו לבד אשמים בו.
  const toSend = all.filter((c) => c.status === "waiting_quote")
  const ready = all.filter((c) => c.status === "ready")
  // רק מה שבאמת בעבודה: על ליפט, בתור או בחוץ. רכב בחניה כבר מופיע בקבוצה של הצעד הבא
  // שלו ("הלקוח אישר", "גמור, מחכה לבדיקה"), ובסבב 2.10 הוא הופיע פעמיים (ממצא 13).
  // 036: הלקוח עוד לא אישר את הצעת הקבלה. בחניה, מחוץ לתור, ובקבוצה משלו.
  const intake = all.filter(awaitingIntake)
  const working = all.filter(
    (c) => (c.status === "open" || c.status === "in_progress") && !c.parked_at && !c.work_done_at && !awaitingIntake(c),
  )
  const arriving = booked ?? []

  // הקישור האחרון לכל רכב שמחכה לאישור הקבלה: מתי נשלח, ואם הלקוח דחה.
  const { data: intakeReqs } = intake.length
    ? await supabase
        .from("quote_requests")
        .select("job_card_id, sent_at, decided_at, decision, expires_at")
        .eq("kind", "intake")
        .in("job_card_id", intake.map((c) => c.id))
        .order("sent_at", { ascending: false })
    : { data: [] }
  const intakeOf = new Map<number, { sent_at: string; decision: string | null; expires_at: string }>()
  for (const r of intakeReqs ?? []) if (!intakeOf.has(r.job_card_id)) intakeOf.set(r.job_card_id, r)

  // איזה תור כבר קיבל תזכורת. מכונאי ומנהל רואים (RLS); מסך תלוי לא מגיע לכאן.
  const bookingIds = [...arriving, ...(later ?? [])].map((b) => b.id)
  const { data: reminded } = bookingIds.length
    ? await supabase.from("customer_notices").select("booking_id, status").eq("kind", "reminder").in("booking_id", bookingIds)
    : { data: [] }
  const reminderOf = new Map((reminded ?? []).map((n) => [n.booking_id, n.status]))
  // 3.10 (ממצא 10): בלי הסכמה לוואטסאפ לא יוצאת תזכורת, ודניאל צריך לדעת את זה מראש.
  const reminderTag = (b: { id: number; whatsapp_consent?: boolean | null }, ahead = false) =>
    reminderOf.get(b.id) === "sent"
      ? " · ✓ נשלחה תזכורת"
      : reminderOf.get(b.id) === "skipped"
        ? " · בלי תזכורת (לא כתב לנו)"
        : ahead && !b.whatsapp_consent
          ? " · בלי וואטסאפ: אין תזכורת"
          : ""
  const canRemind = staff.role === "owner" || staff.role === "manager"
  // התזכורת יוצאת לבד בערב. כפתור "לשלוח עכשיו" מוצג רק כשיש למי לשלוח;
  // אחרת דניאל לוחץ ומקבל "אין מה לשלוח", וזה נראה כמו תקלה.
  const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowBooked = (later ?? []).filter((b) => new Date(b.drop_off_at) < dayAfter)
  // רק מי שהסכים לוואטסאפ יקבל. התור של מי שלא הסכים לא נספר (ממצא 10).
  const remindable = tomorrowBooked.filter((b) => b.whatsapp_consent)
  const remindLeft = remindable.filter((b) => !["sent", "skipped"].includes(reminderOf.get(b.id) ?? "")).length
  // הלקוח ענה, והרכב עדיין בחניה: מחזירים לתור (דניאל, לא המכונאי).
  const backToQueue = all.filter(approvedWaitingForUs)
  const HOUR = 60 * 60 * 1000
  // לפי רכב, לא לפי ממצא (027): לקוח אחד, שיחה אחת, גם אם יש שלושה ממצאים.
  type CallJob = { id: number; plate: string; customer_name: string | null; customer_phone: string | null }
  const callRows = new Map<number, { job: CallJob; titles: string[]; sent_at: string; nudged: boolean }>()
  for (const f of pending ?? []) {
    const a = one(f.approvals)
    const job = one(f.job_cards)
    if (!a || !job || Date.now() - new Date(a.sent_at).getTime() <= HOUR) continue
    const row = callRows.get(job.id) ?? { job, titles: [] as string[], sent_at: a.sent_at, nudged: false }
    row.titles.push(f.title || f.summary || "ממצא")
    if (a.sent_at < row.sent_at) row.sent_at = a.sent_at
    row.nudged = row.nudged || Boolean(a.nudged_at)
    callRows.set(job.id, row)
  }
  const toCall = [...callRows.values()].sort((x, y) => x.sent_at.localeCompare(y.sent_at))

  // ממצאים שמחכים לדניאל, מקובצים לפי רכב: שורה אחת, ושליחה אחת ללקוח מהכרטיס.
  type QueueJob = { id: number; plate: string; vehicle_make: string | null; vehicle_model: string | null; lift: number | null }
  type QueueRow = { job: QueueJob; items: NonNullable<typeof drafts> }
  const queueRows = new Map<number, QueueRow>()
  for (const f of drafts ?? []) {
    const job = one(f.job_cards)
    if (!job) continue
    const row: QueueRow = queueRows.get(job.id) ?? { job, items: [] }
    row.items.push(f)
    queueRows.set(job.id, row)
  }
  const queue = [...queueRows.values()].sort(
    (a, b) =>
      Number(b.items.some((f) => f.urgency === "red")) - Number(a.items.some((f) => f.urgency === "red")) ||
      a.items[0].created_at.localeCompare(b.items[0].created_at),
  )

  // חריגות (רועי, 30.9: רכב חיכה 7 שעות לליפט, ובלוח לא הופיע כלום). אותם ספים כמו
  // בצבעים של מסך הסדנה. רכב שמחכה ללקוח כבר מופיע ב"להתקשר", ומחכה לדניאל ב"ממצאים".
  const overdue = all
    .filter((c) => c.status !== "waiting_approval" && c.status !== "waiting_quote" && !c.parked_at && !awaitingIntake(c))
    .map((c) => {
      const clock = clockOf(c)
      const minutes = minutesSince(clock.iso)
      return { c, clock, minutes, level: heat(minutes, clock.limit) }
    })
    .filter((x) => x.level !== "ok")
    .sort((a, b) => b.minutes / b.clock.limit - a.minutes / a.clock.limit)

  // 042: בקשות הנחה מעל 10% מדניאל. רק אבי רואה אותן, ורק הוא מחליט.
  const { data: discountAsks } =
    staff.role === "owner"
      ? await supabase
          .from("findings")
          .select(
            "id, title, summary, job_card_id, list_price_original, list_price_aftermarket, discount_request_pct, discount_request_reason, discount_request_at, job_cards(plate, vehicle_make, vehicle_model), requester:discount_request_by(full_name)",
          )
          .not("discount_request_at", "is", null)
          .eq("status", "draft")
          .order("discount_request_at", { ascending: true })
      : { data: [] }
  const shekel = (n: number | null) => (n === null ? "" : `${Math.round(Number(n)).toLocaleString("he-IL")} ש"ח`)
  const off = (n: number | null, pct: number | null) => (n === null ? null : Math.round((Number(n) * (100 - Number(pct ?? 0))) / 100))

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="board" />
      <AutoRefresh seconds={30} live />

      <header className="board-head">
        <h1>לוח היום</h1>
        <p>
          כל רכב שנמצא אצלנו עכשיו, ומה הצעד הבא בכל אחד. איפה כל אחד עומד פיזית, ב<Link href="/staff/floor">מפת המוסך</Link>.
        </p>
        {canRemind && (
          <Link className="btn quiet board-walkin" href="/staff/walkin">
            + רכב בלי תור
          </Link>
        )}
      </header>

      {received && (
        <p className={`staff-note ${quote === "failed" ? "notice-failed" : "notice-sent"}`} role="status">
          ✓ <span className="num" dir="ltr">{received}</span> התקבל.{" "}
          {intakeSent === "link"
            ? "הקישור לאישור ההצעה נשלח ללקוח. הרכב מחכה בחניה, ונכנס לתור כשהלקוח מאשר."
            : intakeSent === "failed"
              ? "הקישור לאישור לא נשלח: לשלוח שוב מהקבוצה \"מחכים לאישור הלקוח\"."
              : // 1.2.0: מאז 036 כל רכב מחכה לאישור הקבלה. בלי קישור, הלקוח חותם על העותק המודפס.
                "הרכב מחכה בחניה עד שהלקוח חותם על העותק המודפס. אחרי החתימה: \"חתם על העותק המודפס\" בקבוצה \"מחכים לאישור הלקוח\"."}
          {quote && QUOTE_OUTCOME[quote] ? ` ${QUOTE_OUTCOME[quote]}.` : ""}
        </p>
      )}

      {intakeResent && INTAKE_RESENT[intakeResent] && (
        <p className={`staff-note ${intakeResent === "sent" ? "notice-sent" : "notice-failed"}`} role="status">
          {INTAKE_RESENT[intakeResent]}
        </p>
      )}

      {canRemind && <StationRequests />}

      {(discountAsks ?? []).length > 0 && (
        <section className="board-group hot discounts" id="discounts" aria-labelledby="g-discounts">
          <h2 id="g-discounts">דניאל מבקש הנחה: לאשר?</h2>
          <p className="board-why">מעל 10% זו ההחלטה שלך. עד שתענה, הממצא לא נשלח ללקוח. הסיבה נרשמת ונשארת פנימית.</p>
          <ul className="board-rows">
            {(discountAsks ?? []).map((f) => {
              const job = one(f.job_cards)
              const who = one(f.requester)
              const pct = Number(f.discount_request_pct)
              return (
                <li key={f.id}>
                  {job && <Plate value={job.plate} />}
                  <div>
                    <b>
                      {f.title || f.summary || "ממצא"} · הנחה {pct}%
                    </b>
                    <span className="staff-meta">
                      מקורי {shekel(f.list_price_original)} ← {shekel(off(f.list_price_original, pct))}
                      {f.list_price_aftermarket !== null ? ` · חלופי ${shekel(f.list_price_aftermarket)} ← ${shekel(off(f.list_price_aftermarket, pct))}` : ""}
                    </span>
                    <span className="staff-meta">
                      {who?.full_name ?? "דניאל"}: &quot;{f.discount_request_reason}&quot; · לפני{" "}
                      <Since iso={f.discount_request_at as string} initial={elapsed(f.discount_request_at as string)} />
                    </span>
                  </div>
                  <div className="board-actions">
                    <form action={decideDiscount}>
                      <input type="hidden" name="finding_id" value={f.id} />
                      <input type="hidden" name="job_id" value={f.job_card_id} />
                      <input type="hidden" name="approve" value="1" />
                      <button className="btn" type="submit">לאשר {pct}%</button>
                    </form>
                    <form action={decideDiscount}>
                      <input type="hidden" name="finding_id" value={f.id} />
                      <input type="hidden" name="job_id" value={f.job_card_id} />
                      <input type="hidden" name="approve" value="0" />
                      <button className="btn quiet" type="submit">לא</button>
                    </form>
                    <Link className="btn quiet" href={`/staff/job/${f.job_card_id}`}>הכרטיס</Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {overdue.length > 0 && (
        <section className="board-group hot late" aria-labelledby="g-late">
          <h2 id="g-late">חריגות</h2>
          <p className="board-why">רכבים שעברו את הזמן שלהם בשלב הנוכחי. כתום: עבר את הזמן. אדום: פי שניים.</p>
          <ul className="board-rows">
            {overdue.map(({ c, clock, level }) => (
              <li key={c.id} className={`late-${level}`}>
                <Plate value={c.plate} />
                <div>
                  <b>
                    <span className={`light-dot ${level === "late" ? "red" : "yellow"}`} aria-hidden />
                    {clock.label} כבר <Since iso={clock.iso} initial={elapsed(clock.iso)} />
                  </b>
                  <span className="staff-meta">
                    {carName(c)} ·{" "}
                    {c.status === "ready"
                      ? "מוכן ולא נאסף: להתקשר ללקוח"
                      : c.lift
                        ? `ליפט ${c.lift}: לבדוק עם המכונאי מה מעכב`
                        : "בתור לליפט: לבדוק מי יתפנה, או להעלות לליפט פנוי"}
                  </span>
                </div>
                <Link className="btn quiet" href={c.lift || c.status === "ready" ? `/staff/job/${c.id}` : "/staff/floor"}>
                  {c.lift || c.status === "ready" ? "הכרטיס" : "למפה"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(calls ?? []).length > 0 && (
        <section className="board-group hot calls" aria-labelledby="g-calls">
          <h2 id="g-calls">קוראים לך</h2>
          <ul className="board-rows">
            {(calls ?? []).map((c) => {
              const job = one(c.job_cards)
              const who = one(c.staff)
              return (
                <li key={c.id}>
                  {job && <Plate value={job.plate} />}
                  <div>
                    <b>
                      {c.kind === "done" ? "גמור, מחכה לבדיקה שלך" : "צריך אותך בעמדה"}
                      {c.kind === "done" ? " · בחניה" : c.lift ? ` · ליפט ${c.lift}` : " · בחניה"}
                    </b>
                    <span className="staff-meta">
                      {who?.full_name ?? "מכונאי"}
                      {c.kind === "done" && c.lift ? ` · מליפט ${c.lift}` : ""} · לפני <Since iso={c.created_at} initial={elapsed(c.created_at)} />
                    </span>
                  </div>
                  <div className="board-actions">
                    <Link className="btn quiet" href={`/staff/job/${c.job_card_id}`}>הכרטיס</Link>
                    {/* "סיימתי": פעולה אחת שעושה את כל העבודה — מוכן, הודעה ללקוח, וסגירת
                        הקריאה (ב-setJobStatus). "טופל" רק העלים את ההתראה (סבב 2.10, ממצא 15). */}
                    {canRemind && c.kind === "done" && (
                      <form action={setJobStatus}>
                        <input type="hidden" name="job_id" value={c.job_card_id} />
                        <input type="hidden" name="status" value="ready" />
                        <button className="btn" type="submit">בדקתי · הרכב מוכן</button>
                      </form>
                    )}
                    {canRemind && c.kind !== "done" && (
                      <form action={resolveCall}>
                        <input type="hidden" name="call_id" value={c.id} />
                        <button className="btn" type="submit">הגעתי</button>
                      </form>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {backToQueue.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-requeue">
          <h2 id="g-requeue">הלקוח אישר: להחזיר לתור</h2>
          <p className="board-why">הרכבים האלה הורדו לחניה כדי לא לתפוס ליפט. הלקוח ענה, והם חוזרים לראש התור — המכונאי הבא שיתפנה ימשוך.</p>
          <ul className="board-rows">
            {backToQueue.map((c) => (
              <li key={c.id}>
                <Plate value={c.plate} />
                <div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {c.customer_name || "ללא שם"} · בחניה <Since iso={c.parked_at!} initial={elapsed(c.parked_at!)} />
                  </span>
                </div>
                {canRemind && (
                  <form action={requeueCar}>
                    <input type="hidden" name="job_id" value={c.id} />
                    <button className="btn" type="submit">להחזיר לתור</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {toCall.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-call">
          <h2 id="g-call">שעה בלי תשובה: להתקשר</h2>
          <p className="board-why">הלקוח קיבל קישור, ואחרי חצי שעה גם תזכורת. שיחה של דקה עכשיו חוסכת שעה של רכב שמחכה.</p>
          <ul className="board-rows">
            {toCall.map(({ job, titles, sent_at, nudged }) => (
              <li key={job.id}>
                <Plate value={job.plate} />
                <div>
                  <b>{titles.length === 1 ? titles[0] : `${titles.length} ממצאים: ${titles.join(", ")}`}</b>
                  <span className="staff-meta">
                    {job.customer_name || "ללא שם"} · נשלח לפני <Since iso={sent_at} initial={elapsed(sent_at)} />
                    {nudged ? " · קיבל תזכורת" : ""}
                  </span>
                </div>
                <div className="board-actions">
                  {job.customer_phone && (
                    <a className="btn" href={`tel:${job.customer_phone}`} dir="ltr">{job.customer_phone}</a>
                  )}
                  <Link className="btn quiet" href={`/staff/job/${job.id}`}>הכרטיס</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-queue">
          <h2 id="g-queue">ממצאים שמחכים לך</h2>
          <p className="board-why">שורה לכל רכב. בכרטיס: עבודה מהמחירון לכל ממצא, ושליחה אחת ללקוח. אדום קודם.</p>
          <ul className="board-rows">
            {queue.map(({ job, items }) => {
              const red = items.some((f) => f.urgency === "red")
              const noPhoto = items.some((f) => (f.urgency === "red" || f.safety) && !(f.media ?? []).some((m) => m.kind === "photo"))
              const first = items[0]
              return (
                <li key={job.id} className={`urgency-${red ? "red" : "yellow"}`}>
                  <Plate value={job.plate} />
                  <div>
                    <b>
                      <span className={`light-dot ${red ? "red" : "yellow"}`} aria-hidden />
                      {items.length === 1 ? first.title || first.summary || "ממצא" : `${items.length} ממצאים`}
                      {items.some((f) => f.safety) ? " · בטיחות" : ""}
                      {items.some((f) => f.red_list) ? " · רשימה אדומה" : ""}
                      {noPhoto && <span className="missing-photo">חסרה תמונה</span>}
                    </b>
                    <span className="staff-meta">
                      {carName(job)}
                      {items.length > 1 ? ` · ${items.map((f) => f.title || "ממצא").join(", ")}` : ""} · מחכה{" "}
                      <Since iso={first.created_at} initial={elapsed(first.created_at)} />
                    </span>
                  </div>
                  <Link className="btn" href={`/staff/job/${job.id}#send-title`}>לתמחר ולשלוח</Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {(safety ?? []).length > 0 && (
        <section className="board-group hot" aria-labelledby="g-safety">
          <h2 id="g-safety">ליקוי בטיחותי שלא תוקן: לדווח</h2>
          <p className="board-why">הלקוח דחה תיקון בטיחותי. לפי תקנה 6 מדווחים לרשות הרישוי עד יום עבודה אחרי מסירת הרכב.</p>
          <ul className="board-rows">
            {(safety ?? []).map((f) => {
              const job = one(f.job_cards)!
              return (
                <li key={f.id}>
                  <Plate value={job.plate} />
                  <div>
                    <b>{f.title || f.summary || "ליקוי בטיחותי"}</b>
                    <span className="staff-meta">
                      {job.customer_name || "ללא שם"} ·{" "}
                      {job.delivered_at ? `נמסר ${fmtStamp(job.delivered_at)} · לדווח עד יום העבודה הבא` : "הרכב עוד אצלנו"}
                    </span>
                  </div>
                  {canRemind && (
                    <form action={markSafetyReported}>
                      <input type="hidden" name="finding_id" value={f.id} />
                      <button className="btn quiet" type="submit">דווח</button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="board-counts" aria-label="סיכום">
        <span className={toSend.length ? "hot" : ""}>
          <b className="num">{toSend.length}</b> {toSend.length === 1 ? "מחכה לשליחה" : "מחכים לשליחה"}
        </span>
        <span className={waiting.length + intake.length ? "hot" : ""}>
          <b className="num">{waiting.length + intake.length}</b> {waiting.length + intake.length === 1 ? "מחכה ללקוח" : "מחכים ללקוח"}
        </span>
        <span>
          {/* הסיכום סופר כל רכב בטיפול, גם בחניה; הרשימה למטה מראה רק את מי שלא מופיע בקבוצה אחרת. */}
          <b className="num">{all.filter((c) => (c.status === "open" || c.status === "in_progress") && !awaitingIntake(c)).length}</b> בעבודה
        </span>
        <span>
          <b className="num">{ready.length}</b> {ready.length === 1 ? "מוכן" : "מוכנים"}
        </span>
        <span>
          <b className="num">{arriving.length}</b> {arriving.length === 1 ? "עוד לא הגיע" : "עוד לא הגיעו"}
        </span>
      </div>

      {/* "מחכים שנשלח ללקוח" ירד ב-30.9: אותם רכבים בדיוק מופיעים למעלה, ב"ממצאים שמחכים לך",
          שורה לכל רכב. שתי קבוצות לאותו דבר היו חלק מה"בלאגן". */}

      {intake.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-intake">
          <h2 id="g-intake">מחכים לאישור הלקוח על הצעת הקבלה</h2>
          <p className="board-why">
            הרכב בחניה ולא עולה לליפט עד שהלקוח מאשר. קישור נשלח אליו בוואטסאפ ובמייל. לקוח שחתם על העותק המודפס: &quot;חתם&quot;.
          </p>
          <ul className="board-rows">
            {intake.map((c) => {
              const r = intakeOf.get(c.id)
              const declined = r?.decision === "declined"
              return (
                <li key={c.id} className={declined ? "late-late" : undefined}>
                  <Plate value={c.plate} />
                  <div>
                    <b>
                      {declined ? <span className="light-dot red" aria-hidden /> : null}
                      {declined ? "הלקוח לא אישר: להתקשר אליו" : carName(c)}
                    </b>
                    <span className="staff-meta">
                      {c.customer_name || "ללא שם"}
                      {declined && c.customer_phone ? (
                        <>
                          {" · "}
                          <a href={`tel:${c.customer_phone}`} className="num" dir="ltr">{c.customer_phone}</a>
                        </>
                      ) : null}
                      {" · "}
                      {r && !declined ? (
                        <>
                          קישור נשלח <Since iso={r.sent_at} initial={elapsed(r.sent_at)} />
                        </>
                      ) : !r ? (
                        "חותם על עותק מודפס"
                      ) : (
                        carName(c)
                      )}
                    </span>
                  </div>
                  {canRemind && (
                    <form action={markIntakeSigned}>
                      <input type="hidden" name="job_id" value={c.id} />
                      <button className="btn" type="submit">חתם על העותק המודפס</button>
                    </form>
                  )}
                  {canRemind && !declined && (
                    <form action={resendIntakeRequest}>
                      <input type="hidden" name="job_id" value={c.id} />
                      <input type="hidden" name="from" value="board" />
                      <button className="btn quiet" type="submit">{r ? "לשלוח שוב" : "לשלוח קישור"}</button>
                    </form>
                  )}
                  <Link className="btn quiet" href={`/staff/job/${c.id}`}>הכרטיס</Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-waiting">
          <h2 id="g-waiting">מחכים לתשובת הלקוח</h2>
          <p className="board-why">הקישור אצל הלקוח, וממתינים לתשובה שלו. אם עבר זמן, זה המקום להרים טלפון.</p>
          <ul className="board-rows">
            {waiting.map((c) => (
              <li key={c.id}>
                <Plate value={c.plate} />
                <div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {c.customer_name || "ללא שם"}
                    {c.lift ? ` · ליפט ${c.lift}` : ""} · מחכה לתשובה{" "}
                    <Since iso={c.status_since} initial={elapsed(c.status_since)} />
                  </span>
                </div>
                <Link className="btn quiet" href={`/staff/job/${c.id}`}>מה נשלח</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready.length > 0 && (
        <section className="board-group" aria-labelledby="g-ready">
          <h2 id="g-ready">מוכנים למסירה</h2>
          <p className="board-why">הרכב גמור. אחרי שהלקוח לוקח אותו, לוחצים "נמסר".</p>
          <ul className="board-rows">
            {ready.map((c) => (
              <li key={c.id}>
                <Plate value={c.plate} />
                <div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {c.customer_name || "ללא שם"} · מוכן כבר{" "}
                    <Since iso={c.status_since} initial={elapsed(c.status_since)} />
                  </span>
                </div>
                <form action={setJobStatus}>
                  <input type="hidden" name="job_id" value={c.id} />
                  <input type="hidden" name="status" value="delivered" />
                  <button className="btn" type="submit">נמסר</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="board-group" aria-labelledby="g-working">
        <h2 id="g-working">בעבודה</h2>
        {working.length === 0 ? (
          <p className="staff-empty">אין כרגע רכב בעבודה.</p>
        ) : (
          <ul className="board-rows">
            {working.map((c) => (
              <li key={c.id}>
                <Plate value={c.plate} />
                <div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {placeLabel(c)} · נכנס ב-{fmtTime(c.opened_at)} · כבר{" "}
                    <Since iso={c.opened_at} initial={elapsed(c.opened_at)} />
                  </span>
                </div>
                <Link className="btn quiet" href={`/staff/job/${c.id}`}>הכרטיס</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="board-group" aria-labelledby="g-arriving">
        <h2 id="g-arriving">תורים להיום</h2>
        {arriving.length === 0 ? (
          <p className="staff-empty">כל מי שהיה אמור להגיע היום, הגיע.</p>
        ) : (
          <>
            <p className="board-why">כשהרכב מגיע: "קבלת רכב". בוחרים את השירות מהמחירון, והצעת המחיר הראשונה יוצאת ללקוח במייל. הלקוח מאשר בדלפק, והרכב עובר לחניה, לתור של הליפטים.</p>
            <ul className="board-rows arriving">
              {arriving.map((b) => (
                <li key={b.id}>
                  <Plate value={b.plate} />
                  <div>
                    <b>{b.customer_name || "ללא שם"}</b>
                    <span className="staff-meta">
                      {fmtTime(b.drop_off_at)} · {b.service || "ללא שירות"}
                      {b.vehicle_make ? ` · ${carName(b)}` : ""}
                      {reminderTag(b)}
                    </span>
                  </div>
                  <Link className="btn" href={`/staff/arrive/${b.id}`}>קבלת רכב</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {(later ?? []).length > 0 && (
        <section className="board-group" aria-labelledby="g-later">
          <h2 id="g-later">תורים בימים הקרובים</h2>
          <p className="board-why">לקוח שהגיע לפני המועד שלו: אותו כפתור, והכרטיס נפתח עם כל הפרטים מהתור.</p>
          {canRemind && remindable.length > 0 && (
            <form action={sendRemindersNow} className="board-remind">
              <p className="board-why">תזכורת בוואטסאפ יוצאת לבד כל ערב, לכל מי שיש לו תור מחר והסכים לעדכונים בוואטסאפ.</p>
              {remindLeft > 0 ? (
                <button className="btn quiet" type="submit">
                  לשלוח עכשיו את התזכורות למחר ({remindLeft})
                </button>
              ) : (
                !runNote && <p className="staff-note">✓ התזכורות למחר כבר יצאו, לכל {remindable.length === 1 ? "התור" : `${remindable.length} התורים`} שהסכימו.</p>
              )}
            </form>
          )}
          {runNote && <p className="staff-note" role="status">{runNote}</p>}
          <ul className="board-rows arriving">
            {(later ?? []).map((b) => (
              <li key={b.id}>
                <Plate value={b.plate} />
                <div>
                  <b>{b.customer_name || "ללא שם"}</b>
                  <span className="staff-meta">
                    {fmtStamp(b.drop_off_at)} · {b.service || "ללא שירות"}
                    {b.vehicle_make ? ` · ${carName(b)}` : ""}
                    {reminderTag(b, true)}
                  </span>
                </div>
                <Link className="btn quiet" href={`/staff/arrive/${b.id}`}>הגיע מוקדם</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
