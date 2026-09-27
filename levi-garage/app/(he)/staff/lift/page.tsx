import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { CaptureButton } from "@/components/staff/capture-button"
import { callManager, setMyLift, takeCar } from "../actions"
import { TopBar } from "@/components/staff/top-bar"
import { elapsed } from "@/lib/staff/format"

export const metadata: Metadata = { title: "הליפט שלי | מוסך לוי ובניו", robots: { index: false, follow: false } }

// דף המכונאי. מה שהוא צריך לדעת ליד הרכב, ושלושה כפתורים גדולים:
//   "צילום ודיווח" — ממצא חדש, בלי מחיר ובלי הקלדה (המחיר מהמחירון, אצל דניאל).
//   "דניאל, בוא לעמדה" — כשאין לו יד פנויה אפילו לזה.
//   "סיימתי" — דניאל בודק ומסמן מוכן.
// ומה מותר לבצע: רק מה שבהצעה או שאושר (תקנה 8). "מחכה ללקוח" ו"נדחה" כתובים
// גדול, כדי שאף אחד לא יתחיל תיקון שהלקוח לא אישר.

type Card = {
  id: number
  plate: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  engine_code: string | null
  status: string
  lift: number | null
  inspected_at: string | null
  opened_at: string
}

type Finding = {
  id: number
  job_card_id: number
  title: string | null
  summary: string | null
  status: string
  approvals: { part_choice: string | null } | { part_choice: string | null }[] | null
}

const partName = (c: string | null | undefined) => (c === "aftermarket" ? "חלק חלופי" : "חלק מקורי")
const choiceOf = (f: Finding) => (Array.isArray(f.approvals) ? f.approvals[0] : f.approvals)?.part_choice

function Car({
  card,
  lines,
  findings,
  calls,
  canTake,
}: {
  card: Card
  lines: { title: string; part_choice: string }[]
  findings: Finding[]
  calls: { kind: string; created_at: string }[]
  canTake?: boolean
}) {
  const approved = findings.filter((f) => f.status === "approved")
  const waiting = findings.filter((f) => f.status === "sent")
  const declined = findings.filter((f) => f.status === "declined")
  const drafts = findings.filter((f) => f.status === "draft")
  const helpCall = calls.find((c) => c.kind === "help")
  const doneCall = calls.find((c) => c.kind === "done")

  return (
    <li className="lift-car">
      <div className="lift-car-head">
        <span className="plate-chip num" dir="ltr">{card.plate}</span>
        <div>
          <b>
            {[card.vehicle_make, card.vehicle_model].filter(Boolean).join(" ") || "רכב"}
            {card.vehicle_year ? `, ${card.vehicle_year}` : ""}
          </b>
          {card.engine_code && <span className="staff-meta"> מנוע {card.engine_code}</span>}
        </div>
      </div>

      <div className="gate">
        <h3>מה מותר לבצע</h3>
        {lines.length + approved.length === 0 ? (
          <p className="staff-meta">עוד אין עבודה מאושרת.</p>
        ) : (
          <ul className="gate-ok">
            {lines.map((l, i) => (
              <li key={`l${i}`}>✓ {l.title} · {partName(l.part_choice)}</li>
            ))}
            {approved.map((f) => (
              <li key={f.id}>✓ {f.title || f.summary} · {partName(choiceOf(f))} · הלקוח אישר</li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <ul className="gate-wait">
            {waiting.map((f) => (
              <li key={f.id}>⏳ {f.title || f.summary}: מחכה לאישור הלקוח. לא לגעת עד שמאשר.</li>
            ))}
          </ul>
        )}
        {drafts.length > 0 && (
          <ul className="gate-wait">
            {drafts.map((f) => (
              <li key={f.id}>📝 {f.title || f.summary}: אצל דניאל, עוד לא נשלח ללקוח.</li>
            ))}
          </ul>
        )}
        {declined.length > 0 && (
          <ul className="gate-no">
            {declined.map((f) => (
              <li key={f.id}>✗ {f.title || f.summary}: הלקוח לא אישר. לא לבצע.</li>
            ))}
          </ul>
        )}
      </div>

      {canTake ? (
        <form action={takeCar} className="lift-take">
          <input type="hidden" name="job_id" value={card.id} />
          <button className="btn" type="submit">קח לליפט שלי</button>
        </form>
      ) : (
        <>
          <CaptureButton jobId={card.id} />
          <div className="lift-calls">
            <form action={callManager}>
              <input type="hidden" name="job_id" value={card.id} />
              <input type="hidden" name="kind" value="help" />
              <button className="btn quiet big" type="submit" disabled={Boolean(helpCall)}>
                {helpCall ? `דניאל בדרך · קראת לפני ${elapsed(helpCall.created_at)}` : "דניאל, בוא לעמדה"}
              </button>
            </form>
            <form action={callManager}>
              <input type="hidden" name="job_id" value={card.id} />
              <input type="hidden" name="kind" value="done" />
              <button className="btn quiet big" type="submit" disabled={Boolean(doneCall) || waiting.length > 0 || drafts.length > 0}>
                {doneCall ? "דניאל יודע שסיימת" : "סיימתי את העבודה"}
              </button>
            </form>
          </div>
        </>
      )}

      <Link className="lift-link" href={`/staff/job/${card.id}`}>הכרטיס המלא</Link>
    </li>
  )
}

export default async function LiftPage() {
  const staff = await requireStaff()
  const supabase = await createClient()

  const { data: cards } = await supabase
    .from("job_cards")
    .select("id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, status, lift, inspected_at, opened_at")
    .in("status", ["open", "in_progress", "waiting_quote", "waiting_approval"])
    .order("opened_at", { ascending: true })

  const all = (cards ?? []) as Card[]
  const ids = all.map((c) => c.id)
  const [{ data: lines }, { data: findings }, { data: calls }] = ids.length
    ? await Promise.all([
        supabase.from("quote_items").select("job_card_id, title, part_choice").in("job_card_id", ids),
        supabase
          .from("findings")
          .select("id, job_card_id, title, summary, status, approvals(part_choice)")
          .in("job_card_id", ids)
          .neq("status", "cancelled"),
        supabase.from("help_calls").select("job_card_id, kind, created_at").in("job_card_id", ids).is("resolved_at", null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const linesOf = (id: number) => (lines ?? []).filter((l) => l.job_card_id === id)
  const findingsOf = (id: number) => ((findings ?? []) as Finding[]).filter((f) => f.job_card_id === id)
  const callsOf = (id: number) => (calls ?? []).filter((c) => c.job_card_id === id)

  const atDiag = staff.lift === null
  const toInspect = all.filter((c) => !c.inspected_at && c.status === "open")
  const mine = staff.lift ? all.filter((c) => c.lift === staff.lift) : []
  const unassigned = all.filter((c) => c.lift === null && c.inspected_at && c.status !== "waiting_approval")

  return (
    <main className="staff-wrap lift-page">
      <TopBar staff={staff} current="lift" />

      <header className="staff-top">
        <div>
          <h1>{staff.lift ? `ליפט ${staff.lift}` : "עמדת אבחון"}</h1>
          <p>
            {atDiag
              ? "כל רכב שמתקבל עובר כאן בדיקת כניסה: תשעה פריטים, וצילום ודיבור לכל מה שלא תקין."
              : "הרכב שעל הליפט שלך, ומה מותר לבצע בו. ממצא חדש: צילום ודיבור. בלי מחירים — דניאל מתמחר."}
          </p>
        </div>

        {/* במוסך יש 4 ליפטים ויותר מכונאים מזה, והעמדה מתחלפת במהלך היום. */}
        <form action={setMyLift} className="lift-picker">
          <label htmlFor="my-lift">איפה אני עובד עכשיו</label>
          <select id="my-lift" name="lift" defaultValue={staff.lift ?? ""}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>ליפט {n}</option>
            ))}
            <option value="">עמדת אבחון</option>
          </select>
          <button className="btn quiet" type="submit">עדכון</button>
        </form>
      </header>

      {atDiag && (
        <section className="staff-section" aria-labelledby="inspect-title">
          <h2 id="inspect-title">ממתינים לבדיקת כניסה</h2>
          {toInspect.length === 0 ? (
            <p className="staff-empty">אין כרגע רכב שמחכה לבדיקה. כשדניאל מקבל רכב בדלפק, הוא מופיע כאן.</p>
          ) : (
            <ul className="lift-list">
              {toInspect.map((c) => (
                <li key={c.id} className="lift-car">
                  <div className="lift-car-head">
                    <span className="plate-chip num" dir="ltr">{c.plate}</span>
                    <div>
                      <b>
                        {[c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "רכב"}
                        {c.vehicle_year ? `, ${c.vehicle_year}` : ""}
                      </b>
                      <span className="staff-meta"> · התקבל לפני {elapsed(c.opened_at)}</span>
                    </div>
                  </div>
                  <Link className="btn big" href={`/staff/inspect/${c.id}`}>להתחיל בדיקת כניסה</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!atDiag &&
        (mine.length > 0 ? (
          <ul className="lift-list">
            {mine.map((c) => (
              <Car key={c.id} card={c} lines={linesOf(c.id)} findings={findingsOf(c.id)} calls={callsOf(c.id)} />
            ))}
          </ul>
        ) : (
          <p className="staff-empty">אין כרגע רכב על ליפט {staff.lift}. כשדניאל מעלה רכב לליפט הזה, הוא יופיע כאן.</p>
        ))}

      {!atDiag && unassigned.length > 0 && (
        <section className="staff-section" aria-labelledby="unassigned-title">
          <h2 id="unassigned-title">עברו בדיקת כניסה ומחכים לליפט</h2>
          <ul className="lift-list">
            {unassigned.map((c) => (
              <Car key={c.id} card={c} lines={linesOf(c.id)} findings={findingsOf(c.id)} calls={callsOf(c.id)} canTake />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
