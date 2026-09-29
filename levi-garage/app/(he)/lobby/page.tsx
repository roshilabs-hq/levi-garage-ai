import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { PlateLogo } from "@/components/brand/plate-logo"
import { requireScreen } from "@/lib/staff/session"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { ThemeToggle } from "@/components/site/theme-toggle"

export const metadata: Metadata = { title: "הרכבים שלנו היום | מוסך לוי ובניו", robots: { index: false, follow: false } }

// המסך בחדר ההמתנה. כתובת קבועה, /lobby, ומתחברים אליה פעם אחת עם המשתמש
// של המסך. אין טוקן: דניאל כבר יודע להתחבר, וקישור סודי גרר אחריו טבלה,
// הנפקה, ביטול ומסך ניהול — הכול כדי להחליף דבר שהוא עושה ממילא.
//
// המשתמש הזה הוא לא דניאל, וזה העיקר: המסך נשאר מחובר כל היום בחדר ציבורי,
// ולכן הזהות שעליו יודעת לפתוח את הדף הזה ותו לא. היא לא קוראת job_cards,
// לא bookings ולא findings — is_staff במסד לא מכירה בה — וכל מה שמגיע אליה
// עובר דרך lobby_view, שמחזירה שלוש ספרות אחרונות ודגם.
//
// מה במפורש לא כאן:
//   · שם, טלפון, מספר רישוי מלא, מחירים.
//   · "ממתין לאישור הלקוח" — זה היה מכריז מול חדר מלא אנשים שאדם מסוים
//     התבקש לשלם ועוד לא אישר. במסד הוא ממופה ל"בעבודה" ממילא.
//   · שעונים. העיכוב שלנו לא מוצג לאדם שנפגע ממנו, בלי הסבר ובלי מי שיענה.

type Row = { plate_last3: string; vehicle: string | null; state: "working" | "ready" }

export default async function LobbyPage() {
  await requireScreen("lobby")
  const supabase = await createClient()
  const { data } = await supabase.rpc("lobby_view")
  const rows = (data ?? []) as Row[]

  const ready = rows.filter((r) => r.state === "ready")
  const working = rows.filter((r) => r.state === "working")

  return (
    <main className="lobby">
      <AutoRefresh seconds={30} />

      <header className="lobby-head">
        <h1><PlateLogo className="lobby-logo" height={64} /></h1>
        <p>הרכבים שאצלנו עכשיו, לפי שלוש הספרות האחרונות של מספר הרישוי.</p>
      </header>

      {rows.length === 0 ? (
        <p className="lobby-empty">אין כרגע רכבים במוסך.</p>
      ) : (
        <div className="lobby-grid">
          <section aria-labelledby="l-ready">
            <h2 id="l-ready">מוכן לאיסוף</h2>
            {ready.length === 0 ? (
              <p className="lobby-empty">עוד אף רכב לא סיים.</p>
            ) : (
              <ul className="lobby-cars">
                {ready.map((r) => (
                  <li key={r.plate_last3 + r.vehicle} className="lobby-car ready">
                    <span className="num" dir="ltr">
                      ···{r.plate_last3}
                    </span>
                    <b>{r.vehicle || "רכב"}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="l-working">
            <h2 id="l-working">בעבודה</h2>
            {working.length === 0 ? (
              <p className="lobby-empty">אין כרגע רכב בעבודה.</p>
            ) : (
              <ul className="lobby-cars">
                {working.map((r) => (
                  <li key={r.plate_last3 + r.vehicle} className="lobby-car">
                    <span className="num" dir="ltr">
                      ···{r.plate_last3}
                    </span>
                    <b>{r.vehicle || "רכב"}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <footer className="lobby-foot">
        הרכב שלכם לא ברשימה, או שיש שאלה? הצוות בדלפק ישמח לעזור.
        {/* קטן ואפור בכוונה: זה לצוות שמתקין את המסך, לא ללקוחות שיושבים מולו. */}
        <span className="lobby-tools">
          <ThemeToggle compact />
          <Link className="lobby-switch" href="/staff/login">
            החלפת משתמש
          </Link>
        </span>
      </footer>
    </main>
  )
}
