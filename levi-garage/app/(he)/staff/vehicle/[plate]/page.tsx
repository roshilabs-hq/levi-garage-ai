import type { Metadata } from "next"
import Link from "next/link"

import { partLabel } from "@/lib/staff/quote"
import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { fmtDate } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"

export const metadata: Metadata = { title: "היסטוריית רכב | מוסך לוי ובניו", robots: { index: false, follow: false } }

// "הכול בראש של אבי" הופך לדף אחד: כל ביקור של הרכב, מה נמצא, ומה הלקוח אישר.
// זה גם מה שמאפשר למכונאי אחר לטפל ברכב כשאבי לא במוסך.

const shekel = (n: number) => `${Number(n || 0).toLocaleString("he-IL")} ש"ח`

const statusLabel: Record<string, string> = {
  open: "נפתח",
  in_progress: "בעבודה",
  waiting_quote: "מחכה לשליחה ללקוח",
  waiting_approval: "ממתין לאישור",
  ready: "מוכן",
  delivered: "נמסר",
  cancelled: "בוטל",
}

export default async function VehiclePage({ params }: { params: Promise<{ plate: string }> }) {
  const staff = await requireStaff()
  const { plate } = await params
  const digits = plate.replace(/\D/g, "")
  const supabase = await createClient()

  const [{ data: visits }] = await Promise.all([
    supabase.from("vehicle_history").select("*").eq("plate", digits).order("opened_at", { ascending: false }),
  ])

  const first = visits?.[0]
  const total = (visits ?? []).reduce((s, v) => s + Number(v.approved_total || 0), 0)

  // הממצאים עצמם, כדי לראות מה נאמר ולא רק כמה זה עלה
  const { data: findings } = await supabase
    .from("findings")
    .select("id, summary, status, created_at, job_card_id, price_aftermarket, approvals(decision, price_chosen, part_choice)")
    .in("job_card_id", (visits ?? []).map((v) => v.job_card_id))
    .order("created_at", { ascending: false })

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="other" />

      <header className="staff-top">
        <div>
          <Link className="staff-back" href="/staff">לוח היום</Link>
          <h1>
            <span className="plate-chip num" dir="ltr">{digits}</span>{" "}
            {first ? [first.vehicle_make, first.vehicle_model].filter(Boolean).join(" ") : "רכב"}
            {first?.vehicle_year ? `, ${first.vehicle_year}` : ""}
          </h1>
          <p>
            {(visits ?? []).length} ביקורים · סך אישורים {shekel(total)}
          </p>
        </div>
      </header>

      <section className="staff-section" aria-labelledby="visits-title">
        <h2 id="visits-title">ביקורים</h2>
        {(visits ?? []).length === 0 ? (
          <p className="staff-empty">הרכב הזה עוד לא היה אצלנו.</p>
        ) : (
          <ul className="history">
            {(visits ?? []).map((v) => (
              <li key={v.job_card_id}>
                <div className="history-head">
                  <b>{fmtDate(v.opened_at)}</b>
                  <span className={`staff-status status-${v.status}`}>{statusLabel[v.status] ?? v.status}</span>
                  <Link className="staff-back" href={`/staff/job/${v.job_card_id}`}>הכרטיס</Link>
                </div>
                <p className="staff-meta">
                  {v.findings} ממצאים · {v.approved} אושרו
                  {Number(v.declined) > 0 ? ` · ${v.declined} נדחו` : ""}
                  {Number(v.approved_total) > 0 ? ` · ${shekel(v.approved_total)}` : ""}
                </p>
                <ul className="history-findings">
                  {(findings ?? [])
                    .filter((f) => f.job_card_id === v.job_card_id)
                    .map((f) => {
                      const a = Array.isArray(f.approvals) ? f.approvals[0] : f.approvals
                      return (
                        <li key={f.id}>
                          <span>{f.summary}</span>
                          {a?.decision && (
                            <b className={a.decision === "approved" ? "ok" : "no"}>
                              {a.decision === "approved"
                                ? ["אושר", partLabel(a.part_choice, f.price_aftermarket), shekel(Number(a.price_chosen))].filter(Boolean).join(" · ")
                                : "נדחה"}
                            </b>
                          )}
                        </li>
                      )
                    })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
