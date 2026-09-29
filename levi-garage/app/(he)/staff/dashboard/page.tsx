import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { hourInIsrael } from "@/lib/staff/format"
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

function minutesBetween(a: string, b: string) {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000)
}


export default async function DashboardPage() {
  const staff = await requireStaff()
  const supabase = await createClient()

  const since = new Date()
  since.setDate(since.getDate() - 30)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [{ data: cards }, { data: approvals }, { data: findings }, { data: fleetTotals }, { data: moves }, { data: discounted }, { data: nudges }] = await Promise.all([
    supabase.from("job_cards").select("id, status, opened_at, ready_at, delivered_at").gte("opened_at", since.toISOString()),
    supabase.from("approvals").select("id, sent_at, decided_at, decision, price_chosen").gte("sent_at", since.toISOString()),
    supabase.from("findings").select("id, status, sent_at").gte("created_at", since.toISOString()),
    supabase.from("fleet_vehicles").select("plate, fleets(name)").eq("active", true),
    supabase.from("job_moves").select("job_card_id, place, status, moved_at").gte("moved_at", since.toISOString()).order("moved_at"),
    supabase
      .from("findings")
      .select("id, status, discount_pct, discount_reason, list_price_original, list_price_aftermarket, approvals(part_choice, price_chosen, decided_at)")
      .gt("discount_pct", 0)
      .gte("created_at", monthStart.toISOString()),
    supabase.from("customer_notices").select("status").eq("kind", "nudge").gte("created_at", since.toISOString()),
  ])

  // 6. ליפט שעומד ומחכה ללקוח: כל קטע זמן שבו הרכב היה על ליפט וסטטוס
  // "מחכה לאישור", עד התזוזה הבאה (או עד עכשיו). מחולק בימים שבהם הייתה תזוזה.
  const byJob = new Map<number, { place: string; status: string; moved_at: string }[]>()
  for (const m of moves ?? []) {
    const list = byJob.get(m.job_card_id) ?? []
    list.push(m)
    byJob.set(m.job_card_id, list)
  }
  let liftWaitMin = 0
  const days = new Set<string>()
  for (const list of byJob.values()) {
    list.forEach((m, i) => {
      days.add(m.moved_at.slice(0, 10))
      if (m.place === "lift" && m.status === "waiting_approval") {
        const end = list[i + 1]?.moved_at ?? new Date().toISOString()
        liftWaitMin += minutesBetween(m.moved_at, end)
      }
    })
  }
  const liftWaitPerDay = days.size ? liftWaitMin / days.size : null

  // 7. הנחות החודש: מה הלקוח קיבל, מול מחיר המחירון של החלק שבחר.
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const given = (discounted ?? [])
    .map((f) => ({ f, a: one(f.approvals) }))
    .filter((x) => x.f.status === "approved" && x.a?.price_chosen)
  const discountSum = given.reduce((sum, { f, a }) => {
    const list = a!.part_choice === "aftermarket" ? f.list_price_aftermarket : f.list_price_original
    return sum + Math.max(0, Number(list ?? 0) - Number(a!.price_chosen))
  }, 0)
  const reasons = [...new Set(given.map(({ f }) => f.discount_reason).filter(Boolean))].slice(0, 3)

  // 8. תזכורות ללקוח שלא ענה 30 דקות
  const nudgesSent = (nudges ?? []).filter((n) => n.status === "sent").length

  // 1. רכבים שנמסרו עד 16:00
  const delivered = (cards ?? []).filter((c) => c.delivered_at)
  const onTime = delivered.filter((c) => hourInIsrael(c.delivered_at!) < 16)

  // 2. כמה זמן הליפט ממתין לתשובת הלקוח
  const decided = (approvals ?? []).filter((a) => a.decided_at)
  const waitMinutes = decided.map((a) => minutesBetween(a.sent_at, a.decided_at!))
  const avgWait = waitMinutes.length ? waitMinutes.reduce((s, m) => s + m, 0) / waitMinutes.length : null
  const stillWaiting = (approvals ?? []).filter((a) => !a.decided_at)

  // 5. אישורים בכתב
  const sent = (findings ?? []).filter((f) => f.sent_at)
  const inWriting = decided.length

  // 4. מה נצבר לציים החודש
  const fleetPlates = new Set((fleetTotals ?? []).map((f) => f.plate))
  const monthApproved = decided
    .filter((a) => a.decision === "approved" && new Date(a.decided_at!) >= monthStart)
    .reduce((s, a) => s + Number(a.price_chosen || 0), 0)

  const measured = [
    {
      title: "רכבים שנמסרו עד 16:00",
      target: "היעד: כל הרכבים",
      value: delivered.length === 0 ? "אין עדיין מסירות" : `${onTime.length} מתוך ${delivered.length}`,
      note: delivered.length === 0 ? "המדד יתחיל לרוץ ברגע שיימסר הרכב הראשון דרך המערכת." : `${pct(onTime.length, delivered.length)}% מהמסירות ב-30 הימים האחרונים.`,
    },
    {
      title: "זמן תשובה של לקוח",
      target: "מהשליחה ועד שהלקוח ענה",
      value: avgWait === null ? "אין עדיין נתונים" : avgWait < 1 ? "פחות מדקה בממוצע" : `${Math.round(avgWait)} דקות בממוצע`,
      note:
        stillWaiting.length > 0
          ? `${stillWaiting.length === 1 ? "רכב אחד ממתין" : `${stillWaiting.length} רכבים ממתינים`} לתשובה כרגע. אחרי 30 דקות יוצאת ללקוח תזכורת, ואחרי שעה דניאל רואה "להתקשר".`
          : "אין כרגע רכב שממתין לתשובה.",
    },
    {
      title: "אישורים בכתב",
      target: "היעד: אפס ויכוחים בקופה",
      value: sent.length === 0 ? "אין עדיין שליחות" : `${inWriting} מתוך ${sent.length}`,
      note:
        sent.length === 0
          ? "כל הודעה שנשלחת ללקוח נשמרת עם הנוסח המדויק, מה שנבחר, וחותמת זמן."
          : `${pct(inWriting, sent.length)}% מההודעות שנשלחו כבר הוכרעו, והנוסח נשמר.`,
    },
  ]

  measured.unshift({
    title: "ליפט שעומד ומחכה ללקוח",
    target: "לפני: 2–3 שעות ביום · היעד: קרוב לאפס",
    value: liftWaitPerDay === null ? "אין עדיין נתונים" : liftWaitPerDay < 1 ? "פחות מדקה ביום" : `${Math.round(liftWaitPerDay)} דקות ביום`,
    note:
      liftWaitPerDay === null
        ? "נמדד מכל תזוזה של רכב: כמה זמן עמד על ליפט בזמן שחיכה לאישור. יתחיל לרוץ עם הרכב הראשון."
        : "רכב שמחכה ללקוח אמור לרדת לחניה. כל דקה כאן היא ליפט שלא עבד.",
  })
  measured.push(
    {
      title: "הנחות החודש",
      target: "לפני: 2,000–2,500 ש\"ח בחודש · היעד: חצי",
      value: given.length === 0 ? "אין הנחות החודש" : shekel(discountSum),
      note:
        given.length === 0
          ? "כל הנחה נרשמת: כמה, למה ומי נתן. דניאל עד 10%, מעל זה רק אבי."
          : `${given.length} הנחות שהלקוח קיבל.${reasons.length ? ` הסיבות: ${reasons.join(" · ")}.` : ""}`,
    },
    {
      title: "תזכורות ללקוחות",
      target: "לקוח שלא ענה 30 דקות",
      value: nudgesSent === 0 ? "לא נשלחו" : `${nudgesSent} נשלחו`,
      note: "תזכורת אחת לכל קישור, רק בין 7:00 ל-19:00. אחרי שעה בלי תשובה דניאל רואה \"להתקשר\".",
    },
  )

  const notMeasured = [
    {
      title: "שיחות והודעות אחרי 17:00",
      target: "היעד: אפס",
      why: "השיחות מגיעות לטלפון האישי של אבי, והמערכת לא רואה אותן. נמדוד את זה כשבוט הוואטסאפ של המוסך יענה במקומו, כי אז נדע כמה פניות הוא סגר לבד.",
    },
    {
      title: "חוב פתוח של הציים",
      target: "היעד: ירידה של 50%, וגבייה תוך 30 עד 40 יום",
      why: `אנחנו יודעים מה אושר, לא מה חויב ומה שולם. החשבוניות יוצאות בתוכנה הישנה. מה שכן ידוע: ${shekel(monthApproved)} אושרו החודש, ו-${fleetPlates.size} רכבי צי רשומים אצלנו.`,
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
          <p>המדדים שאבי קבע, ומה שהמערכת יודעת לומר על כל אחד. 30 ימים אחרונים (ההנחות: מתחילת החודש).</p>
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
