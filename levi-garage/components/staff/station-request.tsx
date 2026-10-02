"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import {
  approveHere,
  pollStationRequest,
  requestStation,
  stationApprovers,
  type HereResult,
  type StationReqState,
} from "@/app/(he)/station/actions"

// "חיבור הפוך" (032): מכשיר שעוד לא עמדה מבקש מדניאל להתחבר, ומציג מספר קצר.
// דניאל רואה את אותו מספר בלוח שלו, בוחר ליפט ומאשר — והמסך הזה מתחבר לבד.
// אף אחד לא רץ עם הטאבלט לדלפק, ולא מקלידים סיסמה של מנהל על מכשיר בליפט.

const POLL_MS = 3000

export function StationRequest() {
  const router = useRouter()
  const [state, setState] = useState<StationReqState | null>(null)
  const [asking, start] = useTransition()

  // בקשה פתוחה מלפני רענון הדף: ממשיכים אותה, לא פותחים חדשה.
  useEffect(() => {
    let live = true
    pollStationRequest().then((s) => live && setState(s.status === "retry" ? { status: "none" } : s))
    return () => {
      live = false
    }
  }, [])

  const waiting = state?.status === "pending"
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(async () => {
      if (document.hidden) return
      const s = await pollStationRequest()
      if (s.status !== "retry") setState(s)
    }, POLL_MS)
    return () => clearInterval(t)
  }, [waiting])

  const approved = state?.status === "approved"
  useEffect(() => {
    if (approved) router.refresh()
  }, [approved, router])

  const ask = () => start(async () => setState(await requestStation()))

  if (!state) return <p className="station-wait" role="status">בודקים…</p>

  if (state.status === "approved") {
    return (
      <p className="station-wait" role="status">
        ✓ מחובר: <b>{state.label}</b>. עוד רגע רשימת השמות.
      </p>
    )
  }

  if (state.status === "pending") {
    return (
      <div className="station-req" role="status" aria-live="polite">
        <p className="station-req-label">המספר של המכשיר הזה</p>
        <p className="station-req-code num" dir="ltr">
          {state.code}
        </p>
        <p>
          אצל דניאל בלוח היום מופיע עכשיו <b>&quot;מכשיר {state.code} מבקש להיות עמדה&quot;</b>. הוא בוחר איזה ליפט זה ומאשר, והמסך הזה
          מתחבר לבד.
        </p>
        <p className="staff-meta">הבקשה פגה אחרי רבע שעה.</p>
        <ApproveHere onApproved={(label) => setState({ status: "approved", label })} />
      </div>
    )
  }

  return (
    <div className="station-req">
      {state.status === "expired" && <p className="staff-error" role="alert">הבקשה הקודמת פגה. אפשר לבקש שוב.</p>}
      {state.status === "declined" && (
        <p className="staff-error" role="alert">דניאל לא אישר את הבקשה. אם זו טעות, לבקש שוב ולהגיד לו את המספר.</p>
      )}
      {state.status === "busy" && (
        <p className="staff-error" role="alert">יש כרגע יותר מדי בקשות פתוחות. לנסות שוב עוד כמה דקות, או לקרוא לדניאל.</p>
      )}
      <button className="btn big" type="button" onClick={ask} disabled={asking}>
        {asking ? "שולחים…" : "לבקש מדניאל לחבר"}
      </button>
    </div>
  )
}

const LIFTS = [
  { value: "1", label: "ליפט 1" },
  { value: "2", label: "ליפט 2" },
  { value: "3", label: "ליפט 3" },
  { value: "4", label: "ליפט 4" },
  { value: "diag", label: "עמדת האבחון" },
]

/**
 * דניאל עומד ליד הטאבלט (033): בוחר ליפט, נוגע בשם שלו ומקיש את הקוד שלו, כאן.
 * כמו "דניאל כאן? הקוד שלו" בקריאה מהעמדה. סגור כברירת מחדל, כדי שמכונאי לא
 * יראה שדה קוד שלא שייך לו. הטאבלט לא יוצא מהמסך, ואף אחד לא מתחבר עליו.
 */
function ApproveHere({ onApproved }: { onApproved: (label: string) => void }) {
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<{ id: string; full_name: string }[] | null>(null)
  const [who, setWho] = useState("")
  const [lift, setLift] = useState("")
  const [state, action, sending] = useActionState<HereResult, FormData>(approveHere, null)

  useEffect(() => {
    if (!open || people) return
    let live = true
    stationApprovers().then((list) => {
      if (!live) return
      setPeople(list)
      setWho((w) => w || list[0]?.id || "")
    })
    return () => {
      live = false
    }
  }, [open, people])

  const done = state?.ok ? state.label : null
  useEffect(() => {
    if (done) onApproved(done)
  }, [done, onApproved])

  return (
    <details className="answer-call here-approve" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>דניאל כאן? לאשר עם הקוד שלו</summary>
      {people === null ? (
        <p className="staff-meta" role="status">טוענים…</p>
      ) : people.length === 0 ? (
        <p className="staff-meta">אין כרגע מי שיכול לאשר כאן בקוד. לאשר מהלוח במחשב.</p>
      ) : (
        <form action={action} className="answer-call-form">
          <input type="hidden" name="staff_id" value={who} />
          <input type="hidden" name="lift" value={lift} />
          <p className="here-q">איזה ליפט זה?</p>
          <div className="answer-who" role="group" aria-label="איזה ליפט זה">
            {LIFTS.map((l) => (
              <button key={l.value} type="button" className={l.value === lift ? "btn" : "btn quiet"} aria-pressed={l.value === lift} onClick={() => setLift(l.value)}>
                {l.label}
              </button>
            ))}
          </div>
          {people.length > 1 && (
            <>
              <p className="here-q">מי מאשר?</p>
              <div className="answer-who" role="group" aria-label="מי מאשר">
                {people.map((a) => (
                  <button key={a.id} type="button" className={a.id === who ? "btn" : "btn quiet"} aria-pressed={a.id === who} onClick={() => setWho(a.id)}>
                    {a.full_name}
                  </button>
                ))}
              </div>
            </>
          )}
          <input
            name="pin"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            dir="ltr"
            autoComplete="off"
            aria-label="הקוד, 6 ספרות"
            placeholder="הקוד שלך"
            className="answer-pin"
          />
          <button className="btn" type="submit" disabled={sending || !lift}>
            {sending ? "מאשרים…" : lift ? `לאשר: ${LIFTS.find((l) => l.value === lift)?.label}` : "לבחור ליפט"}
          </button>
          {state && !state.ok && (
            <p className="staff-error" role="alert">
              {state.error}
            </p>
          )}
        </form>
      )}
    </details>
  )
}
