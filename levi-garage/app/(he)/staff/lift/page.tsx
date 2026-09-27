import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { CaptureButton } from "@/components/staff/capture-button"
import { PricePick, type PickItem } from "@/components/staff/price-pick"
import { callManager, lowerCar, takeCar } from "../actions"
import { TopBar } from "@/components/staff/top-bar"
import { elapsed } from "@/lib/staff/format"
import { ACTIVE, queueOf } from "@/lib/staff/queue"
import { StationIdle } from "@/components/staff/station-idle"

export const metadata: Metadata = { title: "הליפט שלי | מוסך לוי ובניו", robots: { index: false, follow: false } }

// דף העמדה של המכונאי (רועי, 28.9). הליפט הוא המשאב היקר, ולכן הדף בנוי סביב
// שאלה אחת: מה הליפט הזה עושה עכשיו.
//
//   ליפט פנוי — הבא בתור, וכפתור אחד למשוך אותו.
//   רכב שעוד לא אובחן — רק "להתחיל אבחון". האבחון נעשה כאן, על הליפט.
//   רכב שאובחן — מה מותר לבצע (תקנה 8), צילום ודיבור, ממצא מהמחירון,
//     "דניאל, בוא", "סיימתי", ו"להוריד מהליפט" כשמחכים ללקוח ואין מה לעשות.

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
  parked_at: string | null
  outside_at: string | null
  priority_at: string | null
}

type Finding = {
  id: number
  job_card_id: number
  title: string | null
  summary: string | null
  status: string
  approvals: { part_choice: string | null } | { part_choice: string | null }[] | null
}

type Line = { job_card_id: number; title: string; part_choice: string }

const partName = (c: string | null | undefined) => (c === "aftermarket" ? "חלק חלופי" : "חלק מקורי")
const choiceOf = (f: Finding) => (Array.isArray(f.approvals) ? f.approvals[0] : f.approvals)?.part_choice
const carName = (c: Card) =>
  ([c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "רכב") + (c.vehicle_year ? `, ${c.vehicle_year}` : "")

function Head({ card }: { card: Card }) {
  return (
    <div className="lift-car-head">
      <span className="plate-chip num" dir="ltr">{card.plate}</span>
      <div>
        <b>{carName(card)}</b>
        {card.engine_code && <span className="staff-meta"> מנוע {card.engine_code}</span>}
      </div>
    </div>
  )
}

/** רכב שעלה לליפט ועוד לא אובחן: זה הדבר היחיד שאפשר לעשות בו. */
function DiagnoseFirst({ card, lines }: { card: Card; lines: Line[] }) {
  return (
    <li className="lift-car">
      <Head card={card} />
      <div className="gate">
        <h3>הלקוח אישר בקבלה</h3>
        <ul className="gate-ok">
          {lines.map((l, i) => (
            <li key={i}>✓ {l.title} · {partName(l.part_choice)}</li>
          ))}
        </ul>
      </div>
      <Link className="btn big lift-diagnose" href={`/staff/inspect/${card.id}`}>להתחיל אבחון</Link>
      <p className="staff-meta">תשעה פריטים ברמזור. מה שלא תקין — צילום ודיבור. בלי אבחון לא מתחילים לעבוד.</p>
    </li>
  )
}

function Car({
  card,
  lines,
  findings,
  calls,
  pick,
}: {
  card: Card
  lines: Line[]
  findings: Finding[]
  calls: { kind: string; created_at: string }[]
  pick: PickItem[]
}) {
  const approved = findings.filter((f) => f.status === "approved")
  const waiting = findings.filter((f) => f.status === "sent")
  const declined = findings.filter((f) => f.status === "declined")
  const drafts = findings.filter((f) => f.status === "draft")
  const helpCall = calls.find((c) => c.kind === "help")
  const doneCall = calls.find((c) => c.kind === "done")

  return (
    <li className="lift-car">
      <Head card={card} />

      <div className="gate">
        <h3>מה מותר לבצע</h3>
        {lines.length + approved.length === 0 ? (
          <p className="staff-meta">עוד אין עבודה מאושרת.</p>
        ) : (
          <ul className="gate-ok">
            {lines.map((l, i) => (
              <li key={`l${i}`}>✓ {l.title} · {partName(l.part_choice)} · אושר בקבלה</li>
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

      <CaptureButton jobId={card.id} />
      <PricePick jobId={card.id} items={pick} />

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

      {/* הליפט לא מחכה לתשובה של לקוח. דניאל יחזיר את הרכב לתור כשיאשר. */}
      <form action={lowerCar} className={waiting.length + drafts.length > 0 ? "lift-lower hot" : "lift-lower"}>
        <input type="hidden" name="job_id" value={card.id} />
        {waiting.length + drafts.length > 0 && (
          <p className="staff-meta">סיימת את מה שמאושר ומחכים ללקוח? להוריד לחניה, והליפט עובר לבא בתור.</p>
        )}
        <button className="btn quiet" type="submit">להוריד מהליפט לחניה</button>
      </form>

      <Link className="lift-link" href={`/staff/job/${card.id}`}>הכרטיס המלא</Link>
    </li>
  )
}

export default async function LiftPage() {
  const staff = await requireStaff()
  const supabase = await createClient()
  const atDiag = staff.lift === null

  const [{ data: cards }, { data: priceList }] = await Promise.all([
    supabase
      .from("job_cards")
      .select("id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, status, lift, inspected_at, opened_at, parked_at, outside_at, priority_at")
      .in("status", [...ACTIVE])
      .order("opened_at", { ascending: true }),
    supabase.from("price_list").select("id, title, price_original, fixed_price").eq("active", true).order("sort"),
  ])

  const all = (cards ?? []) as Card[]
  const mine = atDiag ? [] : all.filter((c) => c.lift === staff.lift)
  const queue = queueOf(all)
  const toInspect = queue.filter((c) => !c.inspected_at)

  const ids = [...new Set([...mine, ...queue].map((c) => c.id))]
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

  const linesOf = (id: number) => ((lines ?? []) as Line[]).filter((l) => l.job_card_id === id)
  const findingsOf = (id: number) => ((findings ?? []) as Finding[]).filter((f) => f.job_card_id === id)
  const callsOf = (id: number) => (calls ?? []).filter((c) => c.job_card_id === id)
  const pick = (priceList ?? []) as PickItem[]

  return (
    <main className="staff-wrap lift-page">
      {staff.role === "mechanic" && <StationIdle />}
      <TopBar staff={staff} current="lift" />

      <header className="staff-top">
        <div>
          <h1>{staff.lift ? `ליפט ${staff.lift}` : "עמדת אבחון"}</h1>
          <p>
            {atDiag
              ? "אבחון מחשב וחשמל לרכב שלא צריך להרים. רוב האבחונים נעשים על הליפט."
              : "הרכב שעל הליפט שלך, ומה מותר לבצע בו. ממצא חדש: צילום ודיבור, או מהמחירון. בלי מחירים — הם מהמחירון."}
          </p>
        </div>
      </header>

      {!atDiag && mine.length > 0 && (
        <ul className="lift-list">
          {mine.map((c) =>
            c.inspected_at ? (
              <Car key={c.id} card={c} lines={linesOf(c.id)} findings={findingsOf(c.id)} calls={callsOf(c.id)} pick={pick} />
            ) : (
              <DiagnoseFirst key={c.id} card={c} lines={linesOf(c.id)} />
            ),
          )}
        </ul>
      )}

      {!atDiag && (
        <section className="staff-section" aria-labelledby="queue-title">
          <h2 id="queue-title">{mine.length ? "הבא בתור" : `ליפט ${staff.lift} פנוי · הבא בתור`}</h2>
          {queue.length === 0 ? (
            <p className="staff-empty">אין רכב שמחכה לליפט. כשדניאל מקבל רכב בדלפק, הוא מופיע כאן.</p>
          ) : (
            <ol className="lift-queue">
              {queue.slice(0, 4).map((c, i) => (
                <li key={c.id} className={i === 0 ? "next" : ""}>
                  <span className="plate-chip num" dir="ltr">{c.plate}</span>
                  <div>
                    <b>{carName(c)}</b>
                    <span className="staff-meta">
                      {linesOf(c.id).map((l) => l.title).join(", ") || "טיפול"}
                      {c.priority_at ? " · דניאל הקדים" : ` · הגיע לפני ${elapsed(c.opened_at)}`}
                      {!c.inspected_at ? " · לפני אבחון" : ""}
                    </span>
                  </div>
                  {i === 0 &&
                    (mine.length === 0 ? (
                      <form action={takeCar}>
                        <input type="hidden" name="job_id" value={c.id} />
                        <button className="btn big" type="submit">למשוך לליפט {staff.lift}</button>
                      </form>
                    ) : (
                      <span className="staff-meta">כשהליפט יתפנה</span>
                    ))}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {atDiag && (
        <section className="staff-section" aria-labelledby="inspect-title">
          <h2 id="inspect-title">בתור, עוד לא אובחנו</h2>
          {toInspect.length === 0 ? (
            <p className="staff-empty">אין כרגע רכב שמחכה לאבחון.</p>
          ) : (
            <ul className="lift-list">
              {toInspect.map((c) => (
                <li key={c.id} className="lift-car">
                  <Head card={c} />
                  <span className="staff-meta">הגיע לפני {elapsed(c.opened_at)}</span>
                  <Link className="btn big" href={`/staff/inspect/${c.id}`}>להתחיל אבחון</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}
