import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { elapsed, fmtStamp, fmtTime } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { Since } from "@/components/staff/since"
import { markSafetyReported, requeueCar, resolveCall, sendRemindersNow, setJobStatus } from "./actions"
import { approvedWaitingForUs } from "@/lib/staff/queue"

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

export default async function StaffBoard({ searchParams }: { searchParams: Promise<{ reminders?: string }> }) {
  const staff = await requireStaff()
  const supabase = await createClient()
  const { reminders } = await searchParams
  const runNote = reminderRunNote(reminders)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const twoWeeks = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000)

  const [{ data: cards }, { data: booked }, { data: later }, { data: drafts }, { data: calls }, { data: safety }, { data: pending }] = await Promise.all([
    supabase
      .from("job_cards")
      .select("id, plate, vehicle_make, vehicle_model, vehicle_year, status, lift, opened_at, lift_since, status_since, customer_name, parked_at, outside_at, priority_at")
      .not("status", "in", "(delivered,cancelled)")
      .order("opened_at", { ascending: true }),
    supabase
      .from("bookings")
      .select("id, plate, customer_name, service, drop_off_at, status, vehicle_make, vehicle_model")
      .gte("drop_off_at", today.toISOString())
      .lt("drop_off_at", tomorrow.toISOString())
      .in("status", ["booked", "rescheduled"])
      .order("drop_off_at", { ascending: true }),
    // לקוח שמגיע לפני המועד שלו צריך את אותו כפתור. בלי זה, תור של מחר לא
    // היה נגיש מהלוח בכלל, והיה צריך לחכות למחר כדי לפתוח לו כרטיס.
    supabase
      .from("bookings")
      .select("id, plate, customer_name, service, drop_off_at, status, vehicle_make, vehicle_model")
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
  const working = all.filter((c) => c.status === "open" || c.status === "in_progress")
  const arriving = booked ?? []

  // איזה תור כבר קיבל תזכורת. מכונאי ומנהל רואים (RLS); מסך תלוי לא מגיע לכאן.
  const bookingIds = [...arriving, ...(later ?? [])].map((b) => b.id)
  const { data: reminded } = bookingIds.length
    ? await supabase.from("customer_notices").select("booking_id, status").eq("kind", "reminder").in("booking_id", bookingIds)
    : { data: [] }
  const reminderOf = new Map((reminded ?? []).map((n) => [n.booking_id, n.status]))
  const reminderTag = (id: number) =>
    reminderOf.get(id) === "sent" ? " · ✓ נשלחה תזכורת" : reminderOf.get(id) === "skipped" ? " · בלי תזכורת (לא כתב לנו)" : ""
  const canRemind = staff.role === "owner" || staff.role === "manager"
  // התזכורת יוצאת לבד בערב. כפתור "לשלוח עכשיו" מוצג רק כשיש למי לשלוח;
  // אחרת דניאל לוחץ ומקבל "אין מה לשלוח", וזה נראה כמו תקלה.
  const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowBooked = (later ?? []).filter((b) => new Date(b.drop_off_at) < dayAfter)
  const remindLeft = tomorrowBooked.filter((b) => !["sent", "skipped"].includes(reminderOf.get(b.id) ?? "")).length
  // הלקוח ענה, והרכב עדיין בחניה: מחזירים לתור (דניאל, לא המכונאי).
  const backToQueue = all.filter(approvedWaitingForUs)
  const HOUR = 60 * 60 * 1000
  const toCall = (pending ?? [])
    .map((f) => ({ f, a: one(f.approvals), job: one(f.job_cards) }))
    .filter((x) => x.a && x.job && Date.now() - new Date(x.a.sent_at).getTime() > HOUR)
    .sort((x, y) => x.a!.sent_at.localeCompare(y.a!.sent_at))
  const queue = [...(drafts ?? [])].sort(
    (a, b) => Number(b.urgency === "red") - Number(a.urgency === "red") || a.created_at.localeCompare(b.created_at),
  )

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="board" />
      <AutoRefresh seconds={30} live />

      <header className="board-head">
        <h1>לוח היום</h1>
        <p>
          כל רכב שנמצא אצלנו עכשיו, ומה הצעד הבא בכל אחד. איפה כל אחד עומד פיזית, ב<Link href="/staff/floor">מפת המוסך</Link>.
        </p>
      </header>

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
                      {c.kind === "done" ? "סיים את העבודה" : "צריך אותך בעמדה"}
                      {c.lift ? ` · ליפט ${c.lift}` : " · בחניה"}
                    </b>
                    <span className="staff-meta">
                      {who?.full_name ?? "מכונאי"} · לפני <Since iso={c.created_at} initial={elapsed(c.created_at)} />
                      {c.kind === "done" ? " · לבדוק ולסמן מוכן בכרטיס" : ""}
                    </span>
                  </div>
                  <div className="board-actions">
                    <Link className="btn quiet" href={`/staff/job/${c.job_card_id}`}>הכרטיס</Link>
                    {canRemind && (
                      <form action={resolveCall}>
                        <input type="hidden" name="call_id" value={c.id} />
                        <button className="btn" type="submit">{c.kind === "done" ? "טופל" : "הגעתי"}</button>
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
            {toCall.map(({ f, a, job }) => (
              <li key={f.id}>
                <Plate value={job!.plate} />
                <div>
                  <b>{f.title || f.summary || "ממצא"}</b>
                  <span className="staff-meta">
                    {job!.customer_name || "ללא שם"} · נשלח לפני <Since iso={a!.sent_at} initial={elapsed(a!.sent_at)} />
                    {a!.nudged_at ? " · קיבל תזכורת" : ""}
                  </span>
                </div>
                <div className="board-actions">
                  {job!.customer_phone && (
                    <a className="btn" href={`tel:${job!.customer_phone}`} dir="ltr">{job!.customer_phone}</a>
                  )}
                  <Link className="btn quiet" href={`/staff/job/${job!.id}#f-${f.id}`}>הכרטיס</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-queue">
          <h2 id="g-queue">ממצאים שמחכים לך</h2>
          <p className="board-why">בוחרים עבודה מהמחירון, והמחיר, השעות והאחריות מתמלאים. אדום קודם.</p>
          <ul className="board-rows">
            {queue.map((f) => {
              const job = one(f.job_cards)!
              return (
                <li key={f.id} className={`urgency-${f.urgency ?? "yellow"}`}>
                  <Plate value={job.plate} />
                  <div>
                    <b>
                      <span className={`light-dot ${f.urgency === "red" ? "red" : "yellow"}`} aria-hidden />
                      {f.title || f.summary || "ממצא"}
                      {f.safety ? " · בטיחות" : ""}
                      {f.red_list ? " · רשימה אדומה" : ""}
                      {(f.urgency === "red" || f.safety) && !(f.media ?? []).some((m) => m.kind === "photo") && (
                        <span className="missing-photo">חסרה תמונה</span>
                      )}
                    </b>
                    <span className="staff-meta">
                      {carName(job)} · {f.source === "intake" ? "אבחון" : f.source === "pricelist" ? "מהמחירון" : job.lift ? `ליפט ${job.lift}` : "בלי ליפט"} · מחכה{" "}
                      <Since iso={f.created_at} initial={elapsed(f.created_at)} />
                    </span>
                  </div>
                  <Link className="btn" href={`/staff/job/${job.id}#f-${f.id}`}>לתמחר ולשלוח</Link>
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
        <span className={waiting.length ? "hot" : ""}>
          <b className="num">{waiting.length}</b> {waiting.length === 1 ? "מחכה ללקוח" : "מחכים ללקוח"}
        </span>
        <span>
          <b className="num">{working.length}</b> בעבודה
        </span>
        <span>
          <b className="num">{ready.length}</b> {ready.length === 1 ? "מוכן" : "מוכנים"}
        </span>
        <span>
          <b className="num">{arriving.length}</b> {arriving.length === 1 ? "עוד לא הגיע" : "עוד לא הגיעו"}
        </span>
      </div>

      {toSend.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-tosend">
          <h2 id="g-tosend">מחכים שנשלח ללקוח</h2>
          <p className="board-why">המכונאי סיים. עד שלא נשלח מחיר, הרכב תקוע והליפט תפוס בגללנו.</p>
          <ul className="board-rows">
            {toSend.map((c) => (
              <li key={c.id}>
                <Plate value={c.plate} />
                <div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {c.customer_name || "ללא שם"}
                    {c.lift ? ` · ליפט ${c.lift}` : ""} · מחכה{" "}
                    <Since iso={c.status_since} initial={elapsed(c.status_since)} />
                  </span>
                </div>
                <Link className="btn" href={`/staff/job/${c.id}`}>שלח ללקוח</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="board-group hot" aria-labelledby="g-waiting">
          <h2 id="g-waiting">מחכים לתשובת הלקוח</h2>
          <p className="board-why">הליפט תפוס עד שהלקוח עונה. אם עבר זמן, זה המקום להרים טלפון.</p>
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
                    {c.lift ? `ליפט ${c.lift}` : "בלי ליפט"} · נכנס ב-{fmtTime(c.opened_at)} · כבר{" "}
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
                      {reminderTag(b.id)}
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
          {canRemind && tomorrowBooked.length > 0 && (
            <form action={sendRemindersNow} className="board-remind">
              <p className="board-why">תזכורת בוואטסאפ יוצאת לבד כל ערב, לכל מי שיש לו תור מחר.</p>
              {remindLeft > 0 ? (
                <button className="btn quiet" type="submit">
                  לשלוח עכשיו את התזכורות למחר ({remindLeft})
                </button>
              ) : (
                !runNote && <p className="staff-note">✓ התזכורות למחר כבר יצאו, לכל {tomorrowBooked.length === 1 ? "התור" : `${tomorrowBooked.length} התורים`}.</p>
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
                    {reminderTag(b.id)}
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
