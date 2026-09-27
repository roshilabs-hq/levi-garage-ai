import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { elapsed, fmtStamp, fmtTime } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { Since } from "@/components/staff/since"
import { openJobCard, sendRemindersNow, setJobStatus } from "./actions"

export const metadata: Metadata = { title: "לוח היום | מוסך לוי ובניו", robots: { index: false, follow: false } }

// לוח היום של דניאל, מסודר לפי מה שדוחף עכשיו ולא לפי סדר הכניסה:
// קודם מי שתקוע ומחכה ללקוח, אחר כך מי שמוכן למסירה, אחר כך מי שבעבודה,
// ובסוף מי שעוד לא הגיע. בכל שורה כתוב מה הצעד הבא.

function Plate({ value }: { value: string }) {
  return <span className="plate-chip num" dir="ltr">{value}</span>
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

  const [{ data: cards }, { data: booked }, { data: later }] = await Promise.all([
    supabase
      .from("job_cards")
      .select("id, plate, vehicle_make, vehicle_model, vehicle_year, status, lift, opened_at, lift_since, status_since, customer_name")
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

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="board" />

      <header className="board-head">
        <h1>לוח היום</h1>
        <p>
          כל רכב שנמצא אצלנו עכשיו, ומה הצעד הבא בכל אחד. איפה כל אחד עומד פיזית, ב<Link href="/staff/floor">מפת המוסך</Link>.
        </p>
      </header>

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
            <p className="board-why">כשהרכב מגיע בפועל, בוחרים ליפט ולוחצים. הכרטיס נפתח מעצמו, בלי להקליד כלום.</p>
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
                  <form action={openJobCard} className="board-arrive">
                    <label className="sr-only" htmlFor={`lift-${b.id}`}>ליפט</label>
                    <select id={`lift-${b.id}`} name="lift" defaultValue={staff.lift ?? ""}>
                      <option value="">בלי ליפט</option>
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>ליפט {n}</option>
                      ))}
                    </select>
                    <input type="hidden" name="booking_id" value={b.id} />
                    <button className="btn" type="submit">הגיע</button>
                  </form>
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
          {canRemind && (
            <form action={sendRemindersNow} className="board-remind">
              <p className="board-why">תזכורת בוואטסאפ יוצאת לבד כל ערב, לכל מי שיש לו תור מחר.</p>
              <button className="btn quiet" type="submit">לשלוח עכשיו את התזכורות למחר</button>
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
                <form action={openJobCard} className="board-arrive">
                  <label className="sr-only" htmlFor={`lift-${b.id}`}>ליפט</label>
                  <select id={`lift-${b.id}`} name="lift" defaultValue={staff.lift ?? ""}>
                    <option value="">בלי ליפט</option>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>ליפט {n}</option>
                    ))}
                  </select>
                  <input type="hidden" name="booking_id" value={b.id} />
                  <button className="btn quiet" type="submit">הגיע מוקדם</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
