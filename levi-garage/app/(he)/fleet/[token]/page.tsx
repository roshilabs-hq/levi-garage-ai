import type { Metadata } from "next"

import { createClient } from "@/lib/supabase/server"
import { fmtDate } from "@/lib/staff/format"

export const metadata: Metadata = { title: "הצי שלכם | מוסך לוי ובניו", robots: { index: false, follow: false } }

// מה שמנהל הצי רואה. בלי התחברות, בלי סיסמה, ובלי גישה לשום לקוח אחר:
// הקישור הקבוע הוא המפתח, והפונקציה במסד מחזירה רק את הרכבים של החברה שלו.

type Row = {
  fleet_name: string
  plate: string
  nickname: string | null
  vehicle: string | null
  last_visit: string | null
  status: string | null
  visits: number
  approved_total: number
  month_total: number
}

const shekel = (n: number) => `${Number(n || 0).toLocaleString("he-IL")} ש"ח`
const date = (iso: string | null) => (iso ? fmtDate(iso) : "עוד לא היה אצלנו")

const inGarage = (status: string | null) => status !== null && !["delivered", "cancelled"].includes(status)

export default async function FleetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc("fleet_view", { p_token: token })
  const rows = (data ?? []) as Row[]

  if (rows.length === 0) {
    return (
      <main className="approve">
        <div className="approve-box">
          <h1>הקישור לא בתוקף</h1>
          <p>אפשר להתקשר אלינו ונשלח קישור חדש: 055-3048489.</p>
        </div>
      </main>
    )
  }

  const month = rows.reduce((s, r) => s + Number(r.month_total || 0), 0)
  const here = rows.filter((r) => inGarage(r.status))
  const monthName = new Date().toLocaleDateString("he-IL", { month: "long", year: "numeric" })

  return (
    <main className="staff-wrap fleet-portal">
      <header className="staff-top">
        <div>
          <p className="approve-from">מוסך לוי ובניו</p>
          <h1>{rows[0].fleet_name}</h1>
          <p>{rows.length} רכבים בחשבון שלכם</p>
        </div>
      </header>

      <section className="fleet-summary" aria-label="סיכום החודש">
        <div>
          <span>אושר על ידכם ב{monthName}</span>
          <b className="num">{shekel(month)}</b>
        </div>
        <div>
          <span>אצלנו עכשיו</span>
          <b className="num">{here.length}</b>
        </div>
      </section>

      <section className="staff-section" aria-labelledby="fleet-cars">
        <h2 id="fleet-cars">הרכבים</h2>
        <ul className="fleet-cars portal">
          {rows.map((r) => (
            <li key={r.plate}>
              <div className="fleet-car-row">
                <span className="plate-chip num" dir="ltr">{r.plate}</span>
                <div>
                  <b>{r.nickname || r.vehicle || "רכב"}</b>
                  <span className="staff-meta">
                    {r.vehicle && r.nickname ? `${r.vehicle} · ` : ""}
                    ביקור אחרון {date(r.last_visit)} · {r.visits} ביקורים
                  </span>
                </div>
                {inGarage(r.status) && <span className="staff-status status-waiting_approval">אצלנו</span>}
              </div>
              {Number(r.month_total) > 0 && (
                <p className="staff-meta">אושר החודש: <b className="num">{shekel(r.month_total)}</b></p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="approve-small">
        הסכומים כאן הם מה שאישרתם, כולל מע"מ, ולא חשבונית. החשבונית החודשית נשלחת בנפרד.
        שאלה על רכב מסוים? 055-3048489.
      </p>
    </main>
  )
}
