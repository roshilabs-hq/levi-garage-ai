import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { elapsed, fmtMinutes, fmtTime, minutesSince } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { Since } from "@/components/staff/since"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { TOO_LONG, stageLabel, type Stage } from "@/lib/staff/stages"
import { assignLift, openJobCard, setJobStatus } from "../actions"

export const metadata: Metadata = { title: "מפת המוסך | מוסך לוי ובניו", robots: { index: false, follow: false } }

// שרשרת היום, משמאל לימין של העין: מוזמן, בטיפול, מחכה ללקוח, הסתיים.
//
// הרעיון שמחזיק את המסך: **רכב יושב בשלב אחד בלבד**, ובכל שלב רץ עליו שעון
// אחד שסופר מאז שנכנס אליו. אין "איפה זה רשום" ואין שני מקומות שסותרים זה
// את זה, ולכן אפשר להסתכל על המסך רגע אחד ולדעת מה תקוע.
//
// כל מעבר הוא כפתור אחד, ובכוונה לא יותר: במוסך לוחצים עם אצבע מלוכלכת,
// בלי לקרוא. הכפתורים הם טפסי שרת, ולכן הם עובדים גם לפני ש-JavaScript נטען.

const LIFTS = [1, 2, 3, 4] as const

const STAGES: Stage[] = ["booked", "working", "waiting", "done"]

type Card = {
  id: number
  plate: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  status: string
  lift: number | null
  opened_at: string
  lift_since: string | null
  status_since: string
  customer_name: string | null
}

function carName(c: { vehicle_make: string | null; vehicle_model: string | null; vehicle_year?: number | null }) {
  const name = [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ")
  return (name || "רכב") + (c.vehicle_year ? `, ${c.vehicle_year}` : "")
}

function Plate({ value }: { value: string }) {
  return (
    <span className="plate-chip num" dir="ltr">
      {value}
    </span>
  )
}

/** בורר ליפט שמציע רק תאים פנויים, כדי שאי אפשר יהיה לשים שני רכבים על אחד. */
function LiftPicker({ free, name, defaultLift }: { free: number[]; name: string; defaultLift?: number | null }) {
  return (
    <select name={name} defaultValue={defaultLift ?? free[0] ?? ""} aria-label="ליפט">
      <option value="">בלי ליפט</option>
      {free.map((n) => (
        <option key={n} value={n}>
          ליפט {n}
        </option>
      ))}
    </select>
  )
}

export default async function FloorPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const staff = await requireStaff()

  // הטאב נבחר בכתובת ולא במצב בצד הלקוח, ולכן הוא עובד לפני ש-JavaScript
  // נטען, נשמר ברענון, וכל אחד יכול לשלוח לחבר קישור לשלב שהוא מדבר עליו.
  // בכוונה אין סרט נע כאן: המכונאי עומד ללחוץ, והחלפת טאב מתחת לאצבע
  // הייתה שולחת אותו ללחוץ על הרכב של מישהו אחר.
  const { stage } = await searchParams
  const only = STAGES.includes(stage as Stage) ? (stage as Stage) : null
  const show = (s: Stage) => only === null || only === s
  const colClass = only ? "chain-col solo" : "chain-col"
  const supabase = await createClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  const [{ data: cards }, { data: crew }, { data: booked }, { count: deliveredToday }] = await Promise.all([
    supabase
      .from("job_cards")
      .select(
        "id, plate, vehicle_make, vehicle_model, vehicle_year, status, lift, opened_at, lift_since, status_since, customer_name",
      )
      .not("status", "in", "(delivered,cancelled)")
      .order("opened_at", { ascending: true }),
    // מכונאי רואה רק את שורת הצוות של עצמו, ולכן השמות מופיעים לדניאל ולא לו.
    supabase.from("staff").select("id, full_name, lift").eq("active", true),
    supabase
      .from("bookings")
      .select("id, plate, customer_name, service, drop_off_at, vehicle_make, vehicle_model, vehicle_year")
      .gte("drop_off_at", today.toISOString())
      .lt("drop_off_at", tomorrow.toISOString())
      .in("status", ["booked", "rescheduled"])
      .order("drop_off_at", { ascending: true }),
    supabase
      .from("job_cards")
      .select("id", { count: "exact", head: true })
      .eq("status", "delivered")
      .gte("delivered_at", today.toISOString()),
  ])

  const all = (cards ?? []) as Card[]
  const arriving = booked ?? []

  const onLift = all.filter((c) => c.lift !== null && (c.status === "open" || c.status === "in_progress"))
  const noLift = all.filter((c) => c.lift === null && (c.status === "open" || c.status === "in_progress"))
  const waitingQuote = all.filter((c) => c.status === "waiting_quote")
  const waitingCustomer = all.filter((c) => c.status === "waiting_approval")
  const done = all.filter((c) => c.status === "ready")

  const busyBays = new Set(all.filter((c) => c.lift !== null).map((c) => c.lift as number))
  const free = LIFTS.filter((n) => !busyBays.has(n))
  const carAt = (n: number) => all.find((c) => c.lift === n)
  const mechanicAt = (n: number) => (crew ?? []).find((s) => s.lift === n)?.full_name

  const working = onLift.length + noLift.length
  const waiting = waitingQuote.length + waitingCustomer.length

  return (
    <main className="staff-wrap wide">
      <TopBar staff={staff} current="floor" />
      <AutoRefresh seconds={60} />

      <header className="board-head">
        <h1>מפת המוסך</h1>
        <p>
          כל רכב נמצא בשלב אחד בלבד, והשעון שלו סופר מאז שנכנס אליו. כל מעבר הוא לחיצה אחת. המסך מתרענן לבד.
        </p>
      </header>

      <nav className="tabs" aria-label="שלב">
        <Link href="/staff/floor" aria-current={only === null ? "page" : undefined}>
          הכול
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={`/staff/floor?stage=${s}`} aria-current={only === s ? "page" : undefined}>
            {stageLabel[s]}
          </Link>
        ))}
      </nav>

      {/* פס התאים. הוא היחיד שיודע להראות גם תא ריק, וזה מה שמניע את כל השרשרת. */}
      <ul className="strip" aria-label="הליפטים">
        {LIFTS.map((n) => {
          const car = carAt(n)
          const who = staff.role === "mechanic" ? (staff.lift === n ? "אני" : null) : mechanicAt(n)
          return (
            <li key={n} className={car ? "strip-bay busy" : "strip-bay"}>
              <b>ליפט {n}</b>
              {car ? (
                <>
                  <span className="num" dir="ltr">
                    {car.plate}
                  </span>
                  <small>{who ?? ""}</small>
                </>
              ) : (
                <span className="strip-free">פנוי</span>
              )}
            </li>
          )
        })}
      </ul>

      <div className={only ? "chain solo" : "chain"}>
        {/* ---------- 1. מוזמנים להיום ---------- */}
        {show("booked") && (
        <section className={colClass} aria-labelledby="c1">
          <div className="chain-head">
            <h2 id="c1">מוזמנים להיום</h2>
            <span className="chain-count num">{arriving.length}</span>
          </div>
          <p className="chain-why">הרכב מגיע לקבלה, דניאל מנתב אותו לתא, ולוחץ. הכרטיס נפתח מעצמו.</p>

          {arriving.length === 0 ? (
            <p className="chain-empty">כולם הגיעו.</p>
          ) : (
            <ul className="chain-cards">
              {arriving.map((b) => {
                const diff = minutesSince(b.drop_off_at)
                return (
                  <li key={b.id} className="chain-card">
                    <div className="chain-card-top">
                      <Plate value={b.plate} />
                      <span className={diff > 10 ? "chain-when hot" : "chain-when"}>
                        {diff > 0 ? `מאחר ${fmtMinutes(diff)}` : `בעוד ${fmtMinutes(-diff)}`}
                      </span>
                    </div>
                    <b>{b.customer_name || "ללא שם"}</b>
                    <span className="staff-meta">
                      {fmtTime(b.drop_off_at)} · {b.service || "ללא שירות"}
                      {b.vehicle_make ? ` · ${carName(b)}` : ""}
                    </span>
                    <form action={openJobCard} className="chain-do">
                      <input type="hidden" name="booking_id" value={b.id} />
                      <LiftPicker free={[...free]} name="lift" />
                      <button className="btn" type="submit">
                        התקבל
                      </button>
                    </form>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        )}

        {/* ---------- 2. בטיפול ---------- */}
        {show("working") && (
        <section className={colClass} aria-labelledby="c2">
          <div className="chain-head">
            <h2 id="c2">בטיפול</h2>
            <span className="chain-count num">{working}</span>
          </div>
          <p className="chain-why">מכאן והלאה הזמן נספר. מי שעל ליפט נמדד מרגע שעלה, ומי שממתין נמדד מרגע שהגיע.</p>

          {working === 0 ? (
            <p className="chain-empty">אין רכב בעבודה.</p>
          ) : (
            <ul className="chain-cards">
              {onLift.map((c) => (
                <li key={c.id} className="chain-card">
                  <div className="chain-card-top">
                    <Plate value={c.plate} />
                    <span className="chain-tag">ליפט {c.lift}</span>
                  </div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">{c.customer_name || "ללא שם"}</span>
                  <p className="chain-clock">
                    בעבודה{" "}
                    <Since
                      iso={c.lift_since ?? c.status_since}
                      initial={elapsed(c.lift_since ?? c.status_since)}
                      className={minutesSince(c.lift_since ?? c.status_since) > TOO_LONG.lift ? "hot" : ""}
                    />
                  </p>
                  <div className="chain-do two">
                    <form action={setJobStatus}>
                      <input type="hidden" name="job_id" value={c.id} />
                      <input type="hidden" name="status" value="waiting_quote" />
                      <button className="btn" type="submit">
                        סיימתי, צריך אישור
                      </button>
                    </form>
                    <form action={setJobStatus}>
                      <input type="hidden" name="job_id" value={c.id} />
                      <input type="hidden" name="status" value="ready" />
                      <button className="btn quiet" type="submit">
                        סיום טיפול
                      </button>
                    </form>
                  </div>
                  <Link className="chain-link" href={`/staff/job/${c.id}`}>
                    הכרטיס
                  </Link>
                </li>
              ))}

              {noLift.map((c) => (
                <li key={c.id} className="chain-card pale">
                  <div className="chain-card-top">
                    <Plate value={c.plate} />
                    <span className="chain-tag wait">ממתין לתא</span>
                  </div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">{c.customer_name || "ללא שם"}</span>
                  <p className="chain-clock">
                    ממתין{" "}
                    <Since
                      iso={c.status_since}
                      initial={elapsed(c.status_since)}
                      className={minutesSince(c.status_since) > TOO_LONG.noLift ? "hot" : ""}
                    />
                  </p>
                  {free.length > 0 ? (
                    <form action={assignLift} className="chain-do">
                      <input type="hidden" name="job_id" value={c.id} />
                      <LiftPicker free={[...free]} name="lift" />
                      <button className="btn" type="submit">
                        העלה
                      </button>
                    </form>
                  ) : (
                    <p className="chain-note">אין ליפט פנוי. הוא יעלה כשמישהו יסיים.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        )}

        {/* ---------- 3. מחכים לתשובה ---------- */}
        {show("waiting") && (
        <section className={colClass} aria-labelledby="c3">
          <div className="chain-head">
            <h2 id="c3">מחכים לתשובה</h2>
            <span className="chain-count num">{waiting}</span>
          </div>
          <p className="chain-why">
            הליפט תפוס, ואנחנו לא עובדים. ברגע שהלקוח עונה, הרכב חוזר לבד ל"בטיפול".
          </p>

          {waiting === 0 ? (
            <p className="chain-empty">אף אחד לא מחכה.</p>
          ) : (
            <ul className="chain-cards">
              {waitingQuote.map((c) => (
                <li key={c.id} className="chain-card">
                  <div className="chain-card-top">
                    <Plate value={c.plate} />
                    <span className="chain-tag us">אצלנו</span>
                  </div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {c.customer_name || "ללא שם"}
                    {c.lift ? ` · ליפט ${c.lift}` : ""}
                  </span>
                  <p className="chain-clock">
                    מחכה לשליחה{" "}
                    <Since
                      iso={c.status_since}
                      initial={elapsed(c.status_since)}
                      className={minutesSince(c.status_since) > TOO_LONG.quote ? "hot" : ""}
                    />
                  </p>
                  <div className="chain-do two">
                    <Link className="btn" href={`/staff/job/${c.id}`}>
                      שלח ללקוח
                    </Link>
                    <form action={setJobStatus}>
                      <input type="hidden" name="job_id" value={c.id} />
                      <input type="hidden" name="status" value="in_progress" />
                      <button className="btn quiet" type="submit">
                        חזרה לעבודה
                      </button>
                    </form>
                  </div>
                </li>
              ))}

              {waitingCustomer.map((c) => (
                <li key={c.id} className="chain-card">
                  <div className="chain-card-top">
                    <Plate value={c.plate} />
                    <span className="chain-tag them">אצל הלקוח</span>
                  </div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">
                    {c.customer_name || "ללא שם"}
                    {c.lift ? ` · ליפט ${c.lift}` : ""}
                  </span>
                  <p className="chain-clock">
                    נשלח לפני{" "}
                    <Since
                      iso={c.status_since}
                      initial={elapsed(c.status_since)}
                      className={minutesSince(c.status_since) > TOO_LONG.customer ? "hot" : ""}
                    />
                  </p>
                  <Link className="btn quiet" href={`/staff/job/${c.id}`}>
                    מה נשלח
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        )}

        {/* ---------- 4. הסתיים ---------- */}
        {show("done") && (
        <section className={colClass} aria-labelledby="c4">
          <div className="chain-head">
            <h2 id="c4">הסתיים</h2>
            <span className="chain-count num">{done.length}</span>
          </div>
          <p className="chain-why">הליפט כבר התפנה. הרכב מחכה בחצר שהלקוח יגיע לקחת אותו.</p>

          {done.length === 0 ? (
            <p className="chain-empty">עוד לא סיימנו רכב היום.</p>
          ) : (
            <ul className="chain-cards">
              {done.map((c) => (
                <li key={c.id} className="chain-card">
                  <div className="chain-card-top">
                    <Plate value={c.plate} />
                  </div>
                  <b>{carName(c)}</b>
                  <span className="staff-meta">{c.customer_name || "ללא שם"}</span>
                  <p className="chain-clock">
                    מוכן{" "}
                    <Since
                      iso={c.status_since}
                      initial={elapsed(c.status_since)}
                      className={minutesSince(c.status_since) > TOO_LONG.ready ? "hot" : ""}
                    />
                  </p>
                  <form action={setJobStatus} className="chain-do">
                    <input type="hidden" name="job_id" value={c.id} />
                    <input type="hidden" name="status" value="delivered" />
                    <button className="btn" type="submit">
                      נמסר ללקוח
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* הבטחה שלא מומשה היא גרועה יותר מהבטחה שלא ניתנה, ולכן זה כתוב על המסך. */}
          <p className="chain-note">
            הודעת "הרכב מוכן" ללקוח <b>עוד לא יוצאת אוטומטית</b>. הערוץ מחכה לבוט הוואטסאפ.
          </p>
          {(deliveredToday ?? 0) > 0 && <p className="chain-note">נמסרו היום: {deliveredToday}</p>}
        </section>
        )}
      </div>

      {staff.role !== "mechanic" && (
        <p className="chain-note screens-note">
          המסכים התלויים: <a href="/wall" target="_blank" rel="noreferrer">/wall</a> בסדנה,{" "}
          <a href="/lobby" target="_blank" rel="noreferrer">/lobby</a> בחדר ההמתנה. מקלידים את הכתובת על המסך
          עצמו, נכנסים עם המשתמש של אותו מסך, ומשאירים. הם מתרעננים לבד.
        </p>
      )}

    </main>
  )
}
