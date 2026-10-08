"use client"

import { useEffect } from "react"

import { stationSwitch } from "@/app/(he)/station/actions"

// מכשיר בעמדה שנשאר בלי מגע חצי שעה חוזר לרשימת השמות (ביקורת אבטחה חמישית, 8.10, ממצא 4), כמו טלפון
// שננעל. המכונאי נכנס שוב בשם ובקוד. העמדה עצמה נשארת מצומדת. בנוסף, במסד, כניסה בעמדה פגה אחרי
// 12 שעות (066). הרענון האוטומטי של המסך לא נחשב מגע: רק אצבע או מקלדת.
const IDLE_MS = 30 * 60 * 1000

export function IdleLogout() {
  useEffect(() => {
    let t = setTimeout(() => void stationSwitch(), IDLE_MS)
    const touch = () => {
      clearTimeout(t)
      t = setTimeout(() => void stationSwitch(), IDLE_MS)
    }
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const
    for (const e of events) window.addEventListener(e, touch, { passive: true })
    return () => {
      clearTimeout(t)
      for (const e of events) window.removeEventListener(e, touch)
    }
  }, [])
  return null
}
