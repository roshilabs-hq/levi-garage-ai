"use client"

import { useRef, useState } from "react"

import { stationLogin } from "@/app/(he)/station/actions"

// לוח מספרים גדול, לאצבע (או פרק אצבע) עם גריז. 6 ספרות, ונשלח לבד בספרה השישית:
// אין "אישור" לחפש על המסך.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]

export function PinPad({ staffId, name }: { staffId: string; name: string }) {
  const form = useRef<HTMLFormElement | null>(null)
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)

  function press(k: string) {
    if (busy) return
    if (k === "⌫") return setPin((p) => p.slice(0, -1))
    if (!/^\d$/.test(k)) return
    setPin((p) => {
      const next = (p + k).slice(0, 6)
      if (next.length === 6) {
        setBusy(true)
        // אחרי שה-state התעדכן והשדה הנסתר מחזיק את 6 הספרות
        setTimeout(() => form.current?.requestSubmit(), 0)
      }
      return next
    })
  }

  return (
    <form ref={form} action={stationLogin} className="pin-pad" aria-label={`קוד של ${name}`}>
      <input type="hidden" name="staff_id" value={staffId} />
      <input type="hidden" name="pin" value={pin} />
      <div className="pin-dots" aria-live="polite" aria-label={`${pin.length} מתוך 6 ספרות`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={i < pin.length ? "on" : ""} />
        ))}
      </div>
      <div className="pin-keys">
        {KEYS.map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <button key={i} type="button" className="pin-key" onClick={() => press(k)} disabled={busy} aria-label={k === "⌫" ? "מחיקה" : k}>
              {k}
            </button>
          ),
        )}
      </div>
      {busy && <p className="staff-meta">נכנסים...</p>}
    </form>
  )
}
