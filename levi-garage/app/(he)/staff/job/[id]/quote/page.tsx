import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { PlateLogo } from "@/components/brand/plate-logo"
import { requireStaff } from "@/lib/staff/session"
import { GARAGE, choiceAndPrice, hours, money, totals, type QuoteOption, type QuoteSnapshot } from "@/lib/staff/quote"
import { reissueQuote } from "../../../actions"
import { AutoPrint, PrintButton } from "@/components/staff/auto-print"

export const metadata: Metadata = { title: "הצעת מחיר | מוסך לוי ובניו", robots: { index: false, follow: false } }

// הצעת המחיר, להדפסה בדלפק. זה "המסמך המודפס" של ס' 132(ב), ללקוח שאין לו
// מייל או שמעדיף נייר. אותו מקור בדיוק כמו המייל (quote_snapshot).

const TZ = "Asia/Jerusalem"
const dateFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" })

function Option({ o, status }: { o: QuoteOption; status: string }) {
  const two = o.price_aftermarket !== null && o.price_aftermarket !== undefined
  return (
    <section className="pq-item">
      <h3>{o.title}</h3>
      <p className="pq-status">{status}</p>
      <table>
        <thead>
          <tr>
            <th>סוג</th>
            <th>מחיר כולל מע"מ</th>
            <th>אחריות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{two ? "חלק מקורי" : "מחיר"}</td>
            <td>{money(o.price_original)}</td>
            <td>{o.warranty_original}</td>
          </tr>
          {two && (
            <tr>
              <td>חלק חלופי</td>
              <td>{money(o.price_aftermarket)}</td>
              <td>{o.warranty_aftermarket}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p>שעות עבודה צפויות: {hours(o.labor_hours)}</p>
      {o.part_diff && <p>ההבדל בין סוגי החלקים: {o.part_diff}</p>}
      {o.single_reason && <p>{o.single_reason}</p>}
    </section>
  )
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ print?: string; first?: string; then?: string; intake?: string }>
}) {
  const staff = await requireStaff()
  const { id } = await params
  const { print, first, then, intake } = await searchParams
  const jobId = Number(id)
  if (!Number.isFinite(jobId)) notFound()

  const supabase = await createClient()
  const { data } = await supabase.rpc("quote_snapshot", { p_job_id: jobId })
  const s = data as QuoteSnapshot | null
  if (!s) notFound()

  const t = totals(s)
  const canIssue = staff.role === "owner" || staff.role === "manager"

  return (
    <main className="print-quote">
      <AutoPrint when={print === "1" || first === "1"} />
      <div className="pq-tools no-print">
        {/* מהקבלה: אחרי ההדפסה דניאל חוזר ללוח, ללקוח הבא (30.9). */}
        {then === "board" ? (
          <Link className="btn" href={`/staff?received=${encodeURIComponent(s.job.plate)}&quote=print&intake=${["link", "paper", "failed"].includes(intake ?? "") ? intake : "paper"}`}>סיימתי להדפיס · חזרה ללוח</Link>
        ) : (
          <Link className="staff-back" href={`/staff/job/${jobId}`}>חזרה לכרטיס</Link>
        )}
        {first === "1" && <p className="staff-note">ללקוח אין מייל, ולכן ההצעה הראשונה מודפסת. לתת לו אותה ביד.</p>}
        {canIssue && (
          <form action={reissueQuote}>
            <input type="hidden" name="job_id" value={jobId} />
            <input type="hidden" name="channel" value="print" />
            <button className="btn" type="submit">לרשום גרסה ולהדפיס</button>
          </form>
        )}
        <PrintButton />
      </div>

      <header className="pq-head">
        <div>
          <PlateLogo className="pq-logo" height={46} mono />
          <span>{GARAGE.address} · {GARAGE.phone}</span>
        </div>
        <div>
          <h1>הצעת מחיר</h1>
          <span>מספר {s.job.id} · {dateFmt.format(new Date())}</span>
        </div>
      </header>

      <p className="pq-car">
        {s.job.customer || "לקוח"} · {[s.job.vehicle, s.job.year].filter(Boolean).join(" ") || "רכב"} · מספר רישוי{" "}
        <b dir="ltr">{s.job.plate}</b>
        {s.job.odometer_km ? ` · ${Number(s.job.odometer_km).toLocaleString("he-IL")} ק"מ בקבלה` : ""}
      </p>

      {s.lines.map((l, i) => (
        <Option key={`l${i}`} o={l} status={`סוכם בקבלה: ${choiceAndPrice(l.part_choice, l.price_aftermarket, l.price)}`} />
      ))}
      {s.findings.map((f) => (
        <Option
          key={f.id}
          o={f}
          status={
            f.status === "approved"
              ? `אושר: ${choiceAndPrice(f.part_choice, f.price_aftermarket, f.price)}`
              : f.status === "declined"
                ? "לא אושר. לא נבצע."
                : "ממתין לתשובת הלקוח"
          }
        />
      ))}

      <p className="pq-total">
        סה"כ לפי מה שסוכם ואושר: <b>{money(t.total)}</b> כולל מע"מ
        {t.pending ? ` · ${t.pending} ממתינים לתשובה, לא נכללים` : ""}
      </p>

      <footer className="pq-foot">
        <p>
          ההצעה ניתנת לפי חוק רישוי שירותים ומקצועות בענף הרכב, התשע"ו-2016. לכל חלק הוצע יותר מסוג אחד כשהדבר אפשרי,
          עם הסבר על ההבדל, שעות העבודה הצפויות והאחריות. לא נבצע עבודה שלא מופיעה בהצעה או בעדכון שאושר.
        </p>
        <div className="pq-sign">
          <span>{GARAGE.manager}, {GARAGE.managerTitle}</span>
          <span>חתימת הלקוח: ____________________</span>
        </div>
        <p className="pq-demo">אתר הדגמה לפרויקט גמר. העסק, האנשים והמחירים בדויים.</p>
      </footer>
    </main>
  )
}
