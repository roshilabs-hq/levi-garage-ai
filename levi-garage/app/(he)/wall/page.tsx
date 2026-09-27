import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireScreen } from "@/lib/staff/session"
import { elapsed, fmtMinutes, fmtTime, minutesSince } from "@/lib/staff/format"
import { clockOf, heat, heatOf, stageLabel, TOO_LONG, type Stage } from "@/lib/staff/stages"
import { placeLabel } from "@/lib/staff/queue"
import { Since } from "@/components/staff/since"
import { Rotator } from "@/components/staff/rotator"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { ThemeToggle } from "@/components/site/theme-toggle"

export const metadata: Metadata = { title: "לוח הסדנה | מוסך לוי ובניו", robots: { index: false, follow: false } }

// המסך שתלוי בסדנה, בכתובת קבועה: /wall. אותם נתונים של מפת המוסך, אבל שלב אחד בכל פעם על כל
// רוחב המסך: כך ארבע-עשרה קוביות נכנסות בלי לגלול, וכל אחת נקראת מהצד
// השני של השטח. אין כאן אף כפתור — זה מסך שמסתכלים בו.
//
// מה לא מופיע כאן, בכוונה: שמות לקוחות, טלפונים ומחירים. מכונאי עובד על
// רכב ולא על אדם, והמסך הזה נראה גם דרך דלת פתוחה.

const STAGES: Stage[] = ["booked", "working", "waiting", "done"]

type Card = {
  id: number
  plate: string
  vehicle_make: string | null
  vehicle_model: string | null
  status: string
  lift: number | null
  lift_since: string | null
  status_since: string
  inspected_at: string | null
  opened_at: string
  parked_at: string | null
  outside_at: string | null
  priority_at: string | null
}

const carName = (c: { vehicle_make: string | null; vehicle_model: string | null }) =>
  [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "רכב"

function Cube({ card }: { card: Card }) {
  const { iso, label } = clockOf(card)
  return (
    <li className={`cube ${heatOf(card)}`}>
      <span className="cube-plate num" dir="ltr">
        {card.plate}
      </span>
      <b>{carName(card)}</b>
      <span className="cube-clock">
        {label} <Since iso={iso} initial={elapsed(iso)} />
      </span>
      <small>{placeLabel(card)}</small>
    </li>
  )
}

const hours = (m: number) => (m % 60 ? `${m / 60}`.replace(".5", "½") : `${m / 60}`)

/**
 * המקרא של הצבעים, בצורת רמזור: אדום למעלה, ירוק למטה, כמו ברחוב, כדי שמזהים
 * אותו מהצד השני של הסדנה בלי לקרוא. עד 27.9 זה היה משפט אחד, והוא גם הטעה:
 * "אדום מעבר לכפול (4 שע׳ על ליפט)" — כש-4 שעות הן בכלל הסף של הכתום.
 */
function TrafficLight() {
  return (
    <div className="traffic" role="group" aria-label="מה אומרים הצבעים">
      <span className="traffic-box" aria-hidden>
        <i className="lamp late" />
        <i className="lamp warn" />
        <i className="lamp ok" />
      </span>
      <ul className="traffic-legend">
        <li><b>חריגה</b> פי 2 מהזמן ({hours(TOO_LONG.lift * 2)} שע׳ על ליפט, {hours(TOO_LONG.customer * 2)} שע׳ אצל הלקוח)</li>
        <li><b>עבר את הזמן</b> ({hours(TOO_LONG.lift)} שע׳ על ליפט, {hours(TOO_LONG.customer)} שע׳ אצל הלקוח)</li>
        <li><b>בזמן</b></li>
      </ul>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="wall-empty">{text}</p>
}

export default async function WallPage() {
  const viewer = await requireScreen("wall")
  const supabase = await createClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  const [{ data: cards }, { data: booked }] = await Promise.all([
    supabase
      .from("job_cards")
      .select("id, plate, vehicle_make, vehicle_model, status, lift, lift_since, status_since, inspected_at, opened_at, parked_at, outside_at, priority_at")
      .not("status", "in", "(delivered,cancelled)")
      .order("status_since", { ascending: true }),
    supabase
      .from("bookings")
      .select("id, plate, service, drop_off_at, vehicle_make, vehicle_model")
      .gte("drop_off_at", today.toISOString())
      .lt("drop_off_at", tomorrow.toISOString())
      .in("status", ["booked", "rescheduled"])
      .order("drop_off_at", { ascending: true }),
  ])

  const all = (cards ?? []) as Card[]
  const arriving = booked ?? []
  const working = all.filter((c) => c.status === "open" || c.status === "in_progress")
  const waiting = all.filter((c) => c.status === "waiting_quote" || c.status === "waiting_approval")
  const done = all.filter((c) => c.status === "ready")

  const counts: Record<Stage, number> = {
    booked: arriving.length,
    working: working.length,
    waiting: waiting.length,
    done: done.length,
  }

  return (
    <main className="wall">
      <AutoRefresh seconds={45} />

      <Rotator labels={STAGES.map((s) => `${stageLabel[s]} ${counts[s]}`)} seconds={10}>
        <section aria-label={stageLabel.booked}>
          <h1>
            מוזמנים להיום <span className="num">{arriving.length}</span>
          </h1>
          {arriving.length === 0 ? (
            <Empty text="כולם הגיעו." />
          ) : (
            <ul className="cubes">
              {arriving.map((b) => {
                const diff = minutesSince(b.drop_off_at)
                return (
                  <li key={b.id} className={`cube ${diff > 10 ? heat(diff, 10) : "ok"}`}>
                    <span className="cube-plate num" dir="ltr">
                      {b.plate}
                    </span>
                    <b>{carName(b)}</b>
                    <span className="cube-clock">
                      {diff > 0 ? `מאחר ${fmtMinutes(diff)}` : `בעוד ${fmtMinutes(-diff)}`}
                    </span>
                    <small>
                      {fmtTime(b.drop_off_at)} · {b.service || "ללא שירות"}
                    </small>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-label={stageLabel.working}>
          <h1>
            בטיפול <span className="num">{working.length}</span>
          </h1>
          {working.length === 0 ? (
            <Empty text="אין רכב בעבודה." />
          ) : (
            <ul className="cubes">
              {working.map((c) => (
                <Cube key={c.id} card={c} />
              ))}
            </ul>
          )}
        </section>

        <section aria-label={stageLabel.waiting}>
          <h1>
            מחכים לתשובה <span className="num">{waiting.length}</span>
          </h1>
          {waiting.length === 0 ? (
            <Empty text="אף אחד לא מחכה. כל הליפטים עובדים." />
          ) : (
            <ul className="cubes">
              {waiting.map((c) => (
                <Cube key={c.id} card={c} />
              ))}
            </ul>
          )}
        </section>

        <section aria-label={stageLabel.done}>
          <h1>
            הסתיים <span className="num">{done.length}</span>
          </h1>
          {done.length === 0 ? (
            <Empty text="עוד לא סיימנו רכב היום." />
          ) : (
            <ul className="cubes">
              {done.map((c) => (
                <Cube key={c.id} card={c} />
              ))}
            </ul>
          )}
        </section>
      </Rotator>

      <footer className="wall-foot">
        <TrafficLight />
        <span className="wall-foot-links">
          {/* המסך הזה תלוי מול חלון או מול מנורה, ולכן התאורה נקבעת עליו
              ולא לפי מה שהטלוויזיה חושבת. הבחירה נשמרת במכשיר. */}
          <ThemeToggle />
          {/* רק לאיש צוות שפתח את הלוח מהחשבון שלו. במסך התלוי הקישור הזה הוביל
              למפת המוסך, שמחזירה אותו מיד ל-/wall — נראה כמו כפתור שלא עושה כלום. */}
          {viewer.role !== "display" && <Link href="/staff/floor">מסך העבודה</Link>}
          <Link href="/staff/login">החלפת משתמש</Link>
        </span>
      </footer>
    </main>
  )
}
