"use client"

import { useEffect } from "react"

import { stationSwitch } from "@/app/(he)/station/actions"

// מכשיר העמדה שייך לליפט, לא לאדם. מכונאי שהלך בלי "החלפת עובד" לא צריך
// להשאיר את השם שלו על כל מה שיקרה אחריו. 15 דקות בלי מגע — חזרה לרשימת השמות.
const IDLE_MS = 15 * 60 * 1000

export function StationIdle() {
  useEffect(() => {
    let timer = setTimeout(() => stationSwitch(), IDLE_MS)
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => stationSwitch(), IDLE_MS)
    }
    const events = ["pointerdown", "keydown", "touchstart"] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [])
  return null
}
