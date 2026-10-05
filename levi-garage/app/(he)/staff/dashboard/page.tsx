import type { Metadata } from "next"

import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/staff/session"
import { OPENING } from "@/lib/hours"
import { customerResponse, discountsSince, israel, liftDeadMinutesPerDay, readyByFour, writtenApprovals, type Approval, type Discounted, type Move } from "@/lib/staff/metrics"
import { TopBar } from "@/components/staff/top-bar"

export const metadata: Metadata = { title: "מדדים | מוסך לוי ובניו", robots: { index: false, follow: false } }

// המדדים שהלקוח עצמו קבע, ומה שהמערכת באמת יודעת לומר על כל אחד.
// חלק נמדדים כאן מנתוני אמת, וחלק לא. במקום להמציא מספר, כתוב מה חסר כדי
// למדוד אותם. זה עדיף על דשבורד שנראה מלא ולא אומר כלום.
//
// מ-28.9 נוספו שלושה, מהנתונים החדשים: כל תזוזה של רכב נרשמת (job_moves),
// וכל הנחה נרשמת עם סיבה ושם (020). כך אפשר סוף-סוף למדוד את הכאב שבגללו
// הפרויקט קיים — ליפט שעומד ומחכה לתשובה של בן אדם.

const shekel = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("he-IL")} ש"ח`
const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100))
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

// רשומות של בדיקות אוטומטיות ושל צילומי המדריכים לא נספרות. "שבוע הדגמה" כן נספר,
// ומסומן למעלה, כדי שלא ייראה כמו נתונים אמיתיים.
const isTestRow = (notes: string | null | undefined) => Boolean(notes && (notes.startsWith("רשומת בדיקה") || notes.startsWith("מדריך")))
const DEMO = "שבוע הדגמה"

// PostgREST מחזיר עד 1,000 שורות בכל פעם. 30 יום של תזוזות הם בערך 3,000, ולכן
// שולפים בעמודים. עד 1.2.0 הרשימה נחתכה, ורכב "נתקע" על הליפט עד עכשיו.
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error("dashboard query failed")
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export default async function DashboardPage() {
  // 1.2.0: המדדים של אבי ודניאל. מכונאים לא צריכים אותם.
  const staff = await requireManager()
  const supabase = await createClient()

  const now = new Date().toISOString()
  const nowMs = new Date(now).getTime()
  const since = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString()
  // יומיים לפני החלון: כדי לדעת איפה עמד רכב שזז לפני תחילת החלון.
  const before = new Date(nowMs - 32 * 24 * 60 * 60 * 1000).toISOString()
  const twoMonths = new Date(nowMs - 62 * 24 * 60 * 60 * 1000).toISOString()

  type ApprovalRow = Approval & { decision: string | null; price_chosen: number | null; findings: { job_card_id: number } | { job_card_id: number }[] | null }
  type DiscRow = { job_card_id: number; status: string; discount_reason: string | null; list_price_original: number | null; list_price_aftermarket: number | null; approvals: Discounted["approval"] | Discounted["approval"][] }

  const [tests, demo, moves, readyCards, openedCards, approvals, discounted, nudges] = await Promise.all([
    all<{ id: number; notes: string | null }>((a, b) => supabase.from("job_cards").select("id, notes").or(`notes.like."רשומת בדיקה*",notes.like."מדריך*"`).range(a, b)),
    supabase.from("job_cards").select("id", { count: "exact", head: true }).like("notes", `${DEMO}*`).gte("opened_at", since),
    all<Move>((a, b) => supabase.from("job_moves").select("job_card_id, place, status, moved_at").gte("moved_at", before).order("moved_at").order("id").range(a, b)),
    all<{ id: number; opened_at: string; ready_at: string | null; notes: string | null }>((a, b) =>
      supabase.from("job_cards").select("id, opened_at, ready_at, notes").gte("ready_at", since).range(a, b),
    ),
    all<{ id: number; work_approved_via: string | null; notes: string | null }>((a, b) =>
      supabase.from("job_cards").select("id, work_approved_via, notes").gte("opened_at", since).range(a, b),
    ),
    all<ApprovalRow>((a, b) =>
      supabase.from("approvals").select("id, request_id, sent_at, decided_at, expires_at, decision, price_chosen, findings(job_card_id)").gte("sent_at", since).range(a, b),
    ),
    all<DiscRow>((a, b) =>
      supabase
        .from("findings")
        .select("job_card_id, status, discount_reason, list_price_original, list_price_aftermarket, approvals(part_choice, price_chosen, decided_at)")
        .gt("discount_pct", 0)
        .gte("created_at", twoMonths)
        .range(a, b),
    ),
    all<{ status: string }>((a, b) => supabase.from("customer_notices").select("status").eq("kind", "nudge").gte("created_at", since).range(a, b)),
  ])

  const testIds = new Set(tests.map((t) => t.id))
  const real = <T extends { job_card_id: number }>(rows: T[]) => rows.filter((r) => !testIds.has(r.job_card_id))
  const hasDemo = (demo.count ?? 0) > 0

  // KPI 2: ליפט מת, בשעות הפתיחה בלבד (lib/staff/metrics.ts).
  const liftWaitPerDay = liftDeadMinutesPerDay(real(moves), now, since, OPENING)
  // KPI 1: מוכן עד 16:00, באותו יום.
  const ready = readyByFour(readyCards.filter((c) => !isTestRow(c.notes)))
  // זמן תשובה, לפי הודעה.
  const approvalsReal = approvals.filter((a) => !testIds.has(one(a.findings)?.job_card_id ?? -1))
  const response = customerResponse(approvalsReal, now, OPENING)
  // KPI 5: אישורים בכתב.
  const written = writtenApprovals(openedCards.filter((c) => !isTestRow(c.notes)))
  // הנחות ב-30 הימים האחרונים, לפי מתי הלקוח אישר.
  const disc = discountsSince(
    real(discounted).map((f) => ({ ...f, approval: one(f.approvals) })),
    since,
  )
  const nudgesSent = nudges.filter((n) => n.status === "sent").length
  const nudgesSkipped = nudges.filter((n) => n.status === "skipped").length
  // אושר החודש בקישורי אישור (שעון ישראל).
  const month = israel(now).date.slice(0, 7)
  const monthApproved = approvalsReal
    .filter((a) => a.decision === "approved" && a.decided_at && israel(a.decided_at).date.slice(0, 7) === month)
    .reduce((s, a) => s + Number(a.price_chosen || 0), 0)

  const measured = [
    {
      title: "ליפט שעומד ומחכה",
      target: "לפני: 2–3 שעות ביום · היעד: פחות מ-30 דקות",
      value: liftWaitPerDay === null ? "אין עדיין נתונים" : liftWaitPerDay < 1 ? "פחות מדקה ביום" : `${Math.round(liftWaitPerDay)} דקות ביום`,
      note:
        liftWaitPerDay === null
          ? "נמדד מכל תזוזה של רכב: כמה זמן עמד על ליפט בזמן שחיכה ללקוח או לדניאל, בשעות הפתיחה. יתחיל לרוץ עם הרכב הראשון."
          : "רכב שמחכה ללקוח או לשליחה עומד על ליפט במקום לרדת לחניה. נספר רק בשעות הפתיחה. המתנה לחלק עוד לא נרשמת בנפרד.",
    },
    {
      title: "מוכנים עד 16:00, באותו יום",
      target: "היעד: 15 מתוך 15",
      value: ready.total === 0 ? "אין עדיין רכבים מוכנים" : `${ready.onTime} מתוך ${ready.total}`,
      note:
        ready.total === 0
          ? "נמדד מהרגע שדניאל מסמן \"הרכב מוכן\". יתחיל לרוץ עם הרכב הראשון."
          : `${pct(ready.onTime, ready.total)}% מהרכבים היו מוכנים לפני 16:00 ביום שבו התקבלו. מתי הלקוח אוסף זה לא בשליטת המוסך.`,
    },
    {
      title: "זמן תשובה של לקוח",
      target: "מהשליחה ועד שהלקוח ענה, בשעות הפתיחה",
      value: response.avg === null ? "אין עדיין נתונים" : response.avg < 1 ? "פחות מדקה בממוצע" : `${Math.round(response.avg)} דקות בממוצע`,
      note:
        response.waiting > 0
          ? `${response.waiting === 1 ? "הודעה אחת ממתינה" : `${response.waiting} הודעות ממתינות`} לתשובה כרגע. אחרי 30 דקות יוצאת ללקוח תזכורת, ואחרי שעה דניאל רואה "להתקשר".`
          : "אין כרגע הודעה שממתינה לתשובה.",
    },
    {
      title: "אישורים בכתב",
      target: "היעד: אפס ויכוחים בקופה",
      value: written.total === 0 ? "אין עדיין אישורים" : `${written.written} מתוך ${written.total}`,
      note:
        written.total === 0
          ? "כל הצעה מאושרת בקישור של הלקוח, או בחתימה על עותק מודפס. שתיהן נשמרות עם התאריך והשעה."
          : `${pct(written.written, written.total)}% מההצעות שאושרו ב-30 הימים האחרונים אושרו בכתב, בקישור או בחתימה.`,
    },
    {
      title: "הנחות ב-30 יום",
      target: "לפני: 2,000–2,500 ש\"ח בחודש · היעד: חצי",
      value: disc.count === 0 ? "אין הנחות" : shekel(disc.sum),
      note:
        disc.count === 0
          ? "כל הנחה נרשמת: כמה, למה ומי נתן. דניאל עד 10%, מעל זה רק אבי."
          : `${disc.count === 1 ? "הנחה אחת שהלקוח קיבל" : `${disc.count} הנחות שהלקוחות קיבלו`}.${disc.reasons.length ? ` הסיבות: ${disc.reasons.join(" · ")}.` : ""} מה שניתן בקופה מחוץ למערכת לא נראה כאן.`,
    },
    {
      title: "תזכורות ללקוחות",
      target: "לקוח שלא ענה 30 דקות",
      value: nudgesSent === 0 ? "לא נשלחו" : `${nudgesSent} נשלחו`,
      note: `תזכורת אחת לכל קישור, רק בין 7:00 ל-19:00.${nudgesSkipped ? ` ${nudgesSkipped} לא נשלחו, כי הלקוח לא הסכים לוואטסאפ או לא כתב לנו.` : ""}`,
    },
  ]

  const notMeasured = [
    {
      title: "שיחות והודעות אחרי 17:00",
      target: "היעד: אפס",
      why: "מאז 25.9 בוט הוואטסאפ עונה ללקוחות על שעות, מחירים, תורים ו\"מה המצב של הרכב שלי?\", גם בערב. מה שעוד חסר למדידה: הבוט עונה אבל לא סופר כמה פניות סגר לבד. זה השלב הבא בבוט.",
    },
    {
      title: "חוב פתוח של הציים",
      target: "היעד: ירידה של 50%, וגבייה תוך 30 עד 40 יום",
      why: `אנחנו יודעים מה אושר, לא מה חויב ומה שולם. החשבוניות יוצאות בתוכנה הישנה. מה שכן ידוע: ${shekel(monthApproved)} אושרו החודש בקישורי אישור. פורטל לציים הוסר ב-29.9, ונשאר לשלב הבא.`,
    },
    {
      title: "המוסך עובד בלי אבי",
      target: "היעד: פחות מ-3 שיחות אליו ביומיים",
      why: "המדד הזה נמדד בחיים ולא במסך: כמה פעמים מישהו התקשר לאבי. מה שהמערכת כן משנה הוא שדניאל יכול לשלוח מחיר בעצמו, ושההיסטוריה של הרכב פתוחה לכל מכונאי.",
    },
  ]

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="dashboard" />

      <header className="board-head">
        <div>
          <h1>מדדים</h1>
          <p>המדדים שאבי קבע, ומה שהמערכת יודעת לומר על כל אחד. 30 ימים אחרונים, בשעון ישראל.</p>
          {hasDemo && <p className="staff-note notice-failed">כולל {DEMO}: נתונים מדומים להמחשה, לא פעילות אמיתית של המוסך.</p>}
        </div>
      </header>

      <section className="staff-section" aria-labelledby="measured-title">
        <h2 id="measured-title">נמדד מנתוני אמת</h2>
        <ul className="kpis">
          {measured.map((k) => (
            <li key={k.title} className="kpi">
              <span className="kpi-title">{k.title}</span>
              <b className="kpi-value">{k.value}</b>
              <span className="kpi-target">{k.target}</span>
              <p className="kpi-note">{k.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="staff-section" aria-labelledby="not-measured-title">
        <h2 id="not-measured-title">עדיין לא נמדד, וזו הסיבה</h2>
        <ul className="kpis honest">
          {notMeasured.map((k) => (
            <li key={k.title} className="kpi">
              <span className="kpi-title">{k.title}</span>
              <span className="kpi-target">{k.target}</span>
              <p className="kpi-note">{k.why}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="lift-hint">
        המספרים כאן מגיעים מהכרטיסים ומהאישורים במערכת, ולא מהערכה.
        כל עוד המוסך עובד גם בנייר, הם מתארים רק את מה שעבר דרך המערכת.
      </p>
    </main>
  )
}
