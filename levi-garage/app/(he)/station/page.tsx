import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"
import { STATION_COOKIE } from "@/lib/staff/station"
import { PinPad } from "@/components/staff/pin-pad"
import { StationRequest } from "@/components/staff/station-request"
import { stationSwitch } from "./actions"

export const metadata: Metadata = { title: "עמדה | מוסך לוי ובניו", robots: { index: false, follow: false } }

// המסך של מכשיר העמדה (ליפט או עמדת האבחון). מי שעומד מולו נוגע בשם שלו,
// מקיש קוד, ונכנס לדף הליפט. אין כאן מייל ואין סיסמה.

type Info = { label: string; lift: number | null; mechanics: { id: string; name: string; has_pin: boolean }[] }

const ERRORS: Record<string, (left?: string) => string> = {
  pin: (left) => `הקוד לא נכון.${left && left !== "0" ? ` נשארו ${left} ניסיונות לפני נעילה.` : ""}`,
  locked: () => "יותר מדי ניסיונות. הקוד נעול ל-15 דקות. דניאל יכול לאפס אותו.",
  no_pin: () => "עוד לא נקבע לך קוד. דניאל קובע אותו במסך העמדות.",
  who: () => "המשתמש הזה לא פעיל. לפנות לדניאל.",
  signin: () => "הכניסה נכשלה. לנסות שוב, או לקרוא לדניאל.",
  station: () => "העמדה בוטלה. מנהל העבודה צריך לצמד את המכשיר מחדש.",
  config: () => "הכניסה בעמדות עוד לא מוגדרת בשרת.",
}

export default async function StationPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; e?: string; left?: string }>
}) {
  const { who, e, left } = await searchParams
  const jar = await cookies()
  const token = jar.get(STATION_COOKIE)?.value

  if (!token) {
    return (
      <main className="station">
        <div className="station-box">
          <h1>המכשיר הזה עוד לא עמדה</h1>
          <p>
            מחברים כל מכשיר פעם אחת: לוחצים כאן, ודניאל מאשר מהלוח שלו איזה ליפט זה. אחרי זה המכונאים נכנסים כאן בשם וקוד.
          </p>
          {e && ERRORS[e] && <p className="staff-error" role="alert">{ERRORS[e]()}</p>}
          <StationRequest />
          <p className="station-alt">
            או: <Link href="/staff/login">מנהל העבודה נכנס כאן</Link> ומצמד את המכשיר ממסך &quot;עמדות&quot;.
          </p>
        </div>
      </main>
    )
  }

  const supabase = await createClient()
  const { data } = await supabase.rpc("station_info", { p_token: token })
  const info = data as Info | null
  const current = await getStaff()

  if (!info) {
    return (
      <main className="station">
        <div className="station-box">
          <h1>העמדה בוטלה</h1>
          <p>צריך לחבר את המכשיר מחדש: לוחצים כאן, ודניאל מאשר מהלוח שלו.</p>
          <StationRequest />
          <p className="station-alt">
            או: <Link href="/staff/login">מנהל העבודה נכנס כאן</Link> ומצמד את המכשיר ממסך &quot;עמדות&quot;.
          </p>
        </div>
      </main>
    )
  }

  const chosen = who ? info.mechanics.find((m) => m.id === who) : undefined

  return (
    <main className="station">
      <div className="station-box wide">
        <p className="station-where">{info.label}</p>

        {current && current.role === "mechanic" ? (
          <>
            <h1>מחובר עכשיו: {current.full_name}</h1>
            <div className="station-actions">
              <Link className="btn big" href="/staff/lift">להמשיך</Link>
              <form action={stationSwitch}>
                <button className="btn quiet big" type="submit">החלפת עובד</button>
              </form>
            </div>
          </>
        ) : chosen ? (
          <>
            <h1>{chosen.name}, הקוד שלך</h1>
            {e && ERRORS[e] && <p className="staff-error" role="alert">{ERRORS[e](left)}</p>}
            <PinPad key={`${chosen.id}-${e ?? ""}`} staffId={chosen.id} name={chosen.name} />
            <Link className="station-back" href="/station">זה לא אני</Link>
          </>
        ) : (
          <>
            <h1>מי עובד כאן עכשיו?</h1>
            <ul className="station-names">
              {info.mechanics.map((m) => (
                <li key={m.id}>
                  <Link className="station-name" href={`/station?who=${m.id}`}>
                    {m.name}
                    {!m.has_pin && <small>אין קוד עדיין</small>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  )
}
