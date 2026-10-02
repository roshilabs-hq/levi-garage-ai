"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { pollStationRequest, requestStation, type StationReqState } from "@/app/(he)/station/actions"

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
          מתחבר לבד. אין צורך ללחוץ כאן על כלום.
        </p>
        <p className="staff-meta">הבקשה פגה אחרי רבע שעה.</p>
      </div>
    )
  }

  return (
    <div className="station-req">
      {state.status === "expired" && <p className="staff-error" role="alert">הבקשה הקודמת פגה. אפשר לבקש שוב.</p>}
      {state.status === "busy" && (
        <p className="staff-error" role="alert">יש כרגע יותר מדי בקשות פתוחות. לנסות שוב עוד כמה דקות, או לקרוא לדניאל.</p>
      )}
      <button className="btn big" type="button" onClick={ask} disabled={asking}>
        {asking ? "שולחים…" : "לבקש מדניאל לחבר"}
      </button>
    </div>
  )
}
