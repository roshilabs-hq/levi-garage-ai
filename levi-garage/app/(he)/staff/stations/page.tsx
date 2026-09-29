import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"

import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/staff/session"
import { STATION_COOKIE } from "@/lib/staff/station"
import { fmtStamp } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { PairQr } from "@/components/staff/pair-qr"
import { pairStation, revokeStation, setStaffPin, unpairThisDevice } from "../../station/actions"

export const metadata: Metadata = { title: "עמדות | מוסך לוי ובניו", robots: { index: false, follow: false } }

// ניהול העמדות הקבועות: לצמד מכשיר לליפט, לבטל מכשיר שאבד, ולקבוע קוד לכל מכונאי.

const MSG: Record<string, string> = {
  lift: "צריך לבחור ליפט או את עמדת האבחון.",
  failed: "הצימוד נכשל. לנסות שוב.",
  pin: "הקוד הוא 6 ספרות בדיוק.",
}

export default async function StationsPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const staff = await requireManager()
  const { e, ok } = await searchParams
  const supabase = await createClient()
  const [{ data: stations }, { data: team }] = await Promise.all([
    supabase.from("stations").select("id, label, lift, created_at, last_used_at, revoked_at").is("revoked_at", null).order("label"),
    supabase.rpc("staff_pin_status"),
  ])
  const pairedHere = Boolean((await cookies()).get(STATION_COOKIE)?.value)

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="stations" />

      <header className="staff-top">
        <div>
          <h1>עמדות</h1>
          <p>בכל ליפט ובעמדת האבחון יש מכשיר קבוע. המכונאי נוגע בשם שלו ומקיש קוד של 6 ספרות — ככה ידוע מי טיפל ובמה.</p>
        </div>
      </header>

      {e && MSG[e] && <p className="staff-error" role="alert">{MSG[e]}</p>}
      {ok === "pin" && <p className="staff-note notice-sent" role="status">הקוד נקבע.</p>}

      <section className="staff-section" aria-labelledby="qr-title">
        <h2 id="qr-title">לחבר טלפון או טאבלט לעמדה</h2>
        <p className="staff-meta">
          בוחרים ליפט, ומופיע קוד QR. סורקים אותו במכשיר שליד הליפט, והוא הופך לעמדה — בלי להתחבר עליו עם הסיסמה שלך.
        </p>
        <PairQr />
        <p className="pair-examiner">
          <b>לבוחנים:</b> אין כאן ארבעה ליפטים, אבל יש לכם טלפון. המחשב הוא דניאל, והטלפון הוא הליפט: בוחרים ליפט, סורקים, נוגעים בשם של
          מכונאי ומקישים את הקוד ממסמך ההגשה. בלי טלפון — אותו קישור בחלון גלישה בסתר. לצילום של תקלה, יש <Link href="/staff/demo-photos">תמונות להדגמה</Link> לצלם מהמסך.
        </p>
      </section>

      <section className="staff-section" aria-labelledby="pair-title">
        <h2 id="pair-title">או: לצמד את המכשיר הזה</h2>
        <p className="staff-meta">
          כשאתה עומד עם המכשיר עצמו ליד הליפט. אחרי הצימוד המשתמש שלך מתנתק מהמכשיר, והוא נשאר עמדה: הקוד של המכונאים עובד רק ממכשיר
          מצומד.
        </p>
        <form action={pairStation} className="pair-form">
          <select name="lift" defaultValue="" required aria-label="איזו עמדה">
            <option value="" disabled>איזו עמדה?</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>ליפט {n}</option>
            ))}
            <option value="diag">עמדת האבחון</option>
          </select>
          <button className="btn" type="submit">לצמד</button>
        </form>
        {pairedHere && (
          <form action={unpairThisDevice} className="pair-form">
            <span className="staff-meta">המכשיר הזה מצומד לעמדה.</span>
            <button className="btn quiet" type="submit">להסיר מהמכשיר הזה</button>
          </form>
        )}
      </section>

      <section className="staff-section" aria-labelledby="st-title">
        <h2 id="st-title">עמדות פעילות</h2>
        {(stations ?? []).length === 0 ? (
          <p className="staff-empty">עוד אין עמדות.</p>
        ) : (
          <ul className="board-rows">
            {(stations ?? []).map((s) => (
              <li key={s.id}>
                <div>
                  <b>{s.label}</b>
                  <span className="staff-meta">
                    צומד {fmtStamp(s.created_at)} · {s.last_used_at ? `כניסה אחרונה ${fmtStamp(s.last_used_at)}` : "עוד לא נכנסו ממנה"}
                  </span>
                </div>
                <form action={revokeStation}>
                  <input type="hidden" name="station_id" value={s.id} />
                  <button className="btn quiet" type="submit">ביטול</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="staff-section" aria-labelledby="pin-title">
        <h2 id="pin-title">קודים של המכונאים</h2>
        <p className="staff-meta">6 ספרות. אחרי 5 טעויות הקוד ננעל ל-15 דקות, וקביעה מחדש משחררת אותו.</p>
        <ul className="board-rows">
          {((team ?? []) as { id: string; full_name: string; has_pin: boolean; locked_until: string | null }[]).map((m) => (
            <li key={m.id}>
              <div>
                <b>{m.full_name}</b>
                <span className="staff-meta">
                  {m.locked_until ? `נעול עד ${fmtStamp(m.locked_until)}` : m.has_pin ? "יש קוד" : "אין קוד עדיין"}
                </span>
              </div>
              <form action={setStaffPin} className="pin-set">
                <input type="hidden" name="staff_id" value={m.id} />
                <input name="pin" inputMode="numeric" pattern="\d{6}" maxLength={6} required dir="ltr" aria-label={`קוד חדש ל${m.full_name}`} placeholder="6 ספרות" autoComplete="off" />
                <button className="btn quiet" type="submit">{m.has_pin ? "קוד חדש" : "לקבוע"}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
