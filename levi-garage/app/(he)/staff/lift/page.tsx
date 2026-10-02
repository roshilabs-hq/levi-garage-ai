import type { Metadata } from "next"
import Link from "next/link"

import { partLabel } from "@/lib/staff/quote"
import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { CaptureButton } from "@/components/staff/capture-button"
import { PricePick, type PickItem } from "@/components/staff/price-pick"
import { callManager, lowerCar, takeCar } from "../actions"
import { TopBar } from "@/components/staff/top-bar"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { elapsed } from "@/lib/staff/format"
import { ACTIVE, queueOf } from "@/lib/staff/queue"
import { StationIdle } from "@/components/staff/station-idle"
import { AnswerCall } from "@/components/staff/answer-call"
import { Mentor } from "@/components/staff/mentor"

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
  price_aftermarket: number | null
  approvals: { part_choice: string | null } | { part_choice: string | null }[] | null
}

type Line = { job_card_id: number; title: string; part_choice: string; price_aftermarket: number | null }

const part = (c: string | null | undefined, aftermarket: number | null | undefined) => {
  const label = partLabel(c, aftermarket)
  return label ? ` · ${label}` : ""
}
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
            <li key={i}>✓ {l.title}{part(l.part_choice, l.price_aftermarket)}</li>
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
  answerers,
}: {
  card: Card
  lines: Line[]
  findings: Finding[]
  calls: { id: number; kind: string; created_at: string }[]
  pick: PickItem[]
  answerers: { id: string; full_name: string }[]
}) {
  const approved = findings.filter((f) => f.status === "approved")
  const waiting = findings.filter((f) => f.status === "sent")
  const declined = findings.filter((f) => f.status === "declined")
  const drafts = findings.filter((f) => f.status === "draft")
  const helpCall = calls.find((c) => c.kind === "help")
  const doneCall = calls.find((c) => c.kind === "done")
  const holding = waiting.length + drafts.length
  const allowed = lines.length + approved.length
  const names = (list: Finding[]) => list.map((f) => f.title || f.summary || "ממצא").join(", ")

  // מה עושים עכשיו, במשפט אחד (רועי, 30.9: "מה עושים שם? כאן הלכתי לאיבוד").
  // סבב 2.10, ממצא 8: הכפתור הגדול הוא תמיד הפעולה של המשפט הזה.
  const finish = allowed > 0 && holding === 0 && !doneCall
  const now = doneCall
    ? "סיימת. דניאל יודע, והוא ימסור את הרכב."
    : allowed === 0
      ? "אין עדיין עבודה מאושרת. להוריד לחניה, והליפט עובר לבא בתור."
      : holding > 0
        ? `לעבוד על מה שמסומן ✓, ואז להוריד לחניה: ${whereFindings(waiting.length, drafts.length)}.`
        : "לעבוד על מה שמסומן ✓, ואז \"סיימתי\". הליפט מתפנה מיד."

  return (
    <li className="lift-car">
      <Head card={card} />

      <p className="lift-now">
        <b>עכשיו:</b> {now}
      </p>

      <div className="gate">
        <h3>מה מותר לבצע</h3>
        {lines.length + approved.length === 0 ? (
          <p className="staff-meta">עוד אין עבודה מאושרת.</p>
        ) : (
          <ul className="gate-ok">
            {lines.map((l, i) => (
              <li key={`l${i}`}>✓ {l.title}{part(l.part_choice, l.price_aftermarket)} · אושר בקבלה</li>
            ))}
            {approved.map((f) => (
              <li key={f.id}>✓ {f.title || f.summary}{part(choiceOf(f), f.price_aftermarket)} · הלקוח אישר</li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <p className="gate-wait">
            ⏳ <b>מחכה ללקוח</b> ({waiting.length}): {names(waiting)}. לא לגעת עד שמאשר.
          </p>
        )}
        {drafts.length > 0 && (
          <p className="gate-wait">
            📝 <b>אצל דניאל</b> ({drafts.length}): {names(drafts)}. הוא שולח ללקוח הודעה אחת. לא לגעת.
          </p>
        )}
        {declined.length > 0 && (
          <ul className="gate-no">
            {declined.map((f) => (
              <li key={f.id}>✗ {f.title || f.summary}: הלקוח לא אישר. לא לבצע.</li>
            ))}
          </ul>
        )}
      </div>

      {/* הפעולה של עכשיו: כפתור אחד, גדול. "סיימתי" כשהכול מאושר, ואחרת להוריד לחניה —
          הליפט לא מחכה לתשובה של לקוח, ודניאל יחזיר את הרכב לתור כשיאשר. */}
      {finish ? (
        <form action={callManager}>
          <input type="hidden" name="job_id" value={card.id} />
          <input type="hidden" name="kind" value="done" />
          <button className="lift-primary" type="submit">סיימתי את העבודה</button>
        </form>
      ) : (
        !doneCall && (
          <form action={lowerCar}>
            <input type="hidden" name="job_id" value={card.id} />
            <button className="lift-primary" type="submit">להוריד מהליפט לחניה</button>
          </form>
        )
      )}

      {/* ממצא נוסף: משני, כי הוא לא הצעד של עכשיו. */}
      <CaptureButton jobId={card.id} size="small" quiet label="ממצא נוסף: צילום ודיווח" />
      <PricePick jobId={card.id} items={pick} />

      <div className="lift-calls">
        <form action={callManager}>
          <input type="hidden" name="job_id" value={card.id} />
          <input type="hidden" name="kind" value="help" />
          <button className="btn quiet big" type="submit" disabled={Boolean(helpCall)}>
            {helpCall ? `דניאל בדרך · קראת לפני ${elapsed(helpCall.created_at)}` : "דניאל, בוא לעמדה"}
          </button>
        </form>
        <Mentor jobId={card.id} compact />
      </div>
      {helpCall && <AnswerCall callId={helpCall.id} answerers={answerers} />}

      {/* מחכים לחלק, גם כשהכול מאושר: אפשר תמיד להוריד לחניה. */}
      {finish && (
        <form action={lowerCar} className="lift-lower">
          <input type="hidden" name="job_id" value={card.id} />
          <button className="btn quiet" type="submit">מחכים לחלק? להוריד לחניה</button>
        </form>
      )}
      <Link className="lift-link" href={`/staff/job/${card.id}`}>הכרטיס המלא</Link>
    </li>
  )
}

/**
 * איפה עומדים הממצאים, במילים. כשחלק אצל הלקוח וחלק אצל דניאל, לכתוב את שניהם:
 * "2 ממצאים מחכים לתשובת הלקוח" כשאחד מהם עוד אצל דניאל היה לא נכון (צילומי המדריך, 2.10).
 */
function whereFindings(atCustomer: number, atDaniel: number) {
  const n = (k: number) => (k === 1 ? "ממצא אחד" : `${k} ממצאים`)
  const customer = atCustomer ? `${n(atCustomer)} ${atCustomer === 1 ? "מחכה" : "מחכים"} לתשובת הלקוח` : ""
  const daniel = atDaniel ? `${n(atDaniel)} אצל דניאל` : ""
  return [customer, daniel].filter(Boolean).join(", ו")
}

export default async function LiftPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const staff = await requireStaff()
  const { done } = await searchParams
  const supabase = await createClient()
  const atDiag = staff.lift === null

  const [{ data: cards }, { data: priceList }] = await Promise.all([
    supabase
      .from("job_cards")
      .select("id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, status, lift, inspected_at, opened_at, parked_at, outside_at, priority_at, work_done_at, work_approved_at")
      .in("status", [...ACTIVE])
      .order("opened_at", { ascending: true }),
    supabase.from("price_list").select("id, title, price_original, fixed_price").eq("active", true).order("sort"),
  ])
  // מי יכול לאשר "הגעתי" על המסך הזה (026): רק שמות של מי שיש לו קוד.
  const { data: answerers } = await supabase.rpc("call_answerers")

  const all = (cards ?? []) as Card[]
  const mine = atDiag ? [] : all.filter((c) => c.lift === staff.lift)
  const queue = queueOf(all)
  const toInspect = queue.filter((c) => !c.inspected_at)

  const ids = [...new Set([...mine, ...queue].map((c) => c.id))]
  const [{ data: lines }, { data: findings }, { data: calls }] = ids.length
    ? await Promise.all([
        supabase.from("quote_items").select("job_card_id, title, part_choice, price_aftermarket").in("job_card_id", ids),
        supabase
          .from("findings")
          .select("id, job_card_id, title, summary, status, price_aftermarket, approvals(part_choice)")
          .in("job_card_id", ids)
          .neq("status", "cancelled"),
        supabase.from("help_calls").select("id, job_card_id, kind, created_at").in("job_card_id", ids).is("resolved_at", null),
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
      <AutoRefresh seconds={30} live />

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

      {done !== undefined && mine.length === 0 && (
        <p className="staff-note notice-sent" role="status">
          <span>
            ✓ {done ? <bdi className="num">{done}</bdi> : "הרכב"} ירד לחניה. דניאל יבדוק ויסמן &quot;מוכן&quot;. הליפט פנוי.
          </span>
        </p>
      )}

      {!atDiag && mine.length > 0 && (
        <ul className="lift-list">
          {mine.map((c) =>
            c.inspected_at ? (
              <Car key={c.id} card={c} lines={linesOf(c.id)} findings={findingsOf(c.id)} calls={callsOf(c.id)} pick={pick} answerers={(answerers ?? []) as { id: string; full_name: string }[]} />
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
