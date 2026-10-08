"use client"

import { useEffect, useRef, useState } from "react"

import { callManager, lowerCar } from "@/app/(he)/staff/actions"

// "להוריד מהליפט לחניה" עם אישור (ביקורת UX חיצונית, 8.10, ממצא 1). עד היום לחיצה אחת הורידה
// את הרכב, וההחלטה אם הוא סגור ואפשר לנסוע בו נשארה רק בהסבר שמעל הכפתור. עכשיו הלחיצה שואלת,
// באותו מקום, ורק "כן" מוריד. השרת דורש את האישור גם הוא (fit=yes ב-lowerCar).
//
// למה לא תיבת סימון: היא הייתה מזיזה את הכפתור, והצילום במרכז ההדרכה, כרטיס העמדה והסרטונים
// מראים אותו במקום הזה. כאן המסך הרגיל לא משתנה.
// נגיעה כפולה בכפפה הייתה נוחתת על "כן", שמופיע באותו מקום. לכן "כן" פעיל רק אחרי חצי שנייה.
const ARM_MS = 500

// done: הכפתור "סיימתי את העבודה". גם הוא מוריד את הרכב מהליפט, ולכן שואל את אותה שאלה (066).
export function LowerCar({ jobId, label, className, done = false }: { jobId: number; label: string; className: string; done?: boolean }) {
  const [ask, setAsk] = useState(false)
  const [armed, setArmed] = useState(false)
  const question = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!ask) return
    question.current?.focus()
    const t = setTimeout(() => setArmed(true), ARM_MS)
    return () => clearTimeout(t)
  }, [ask])

  if (!ask) {
    return (
      <button className={className} type="button" onClick={() => setAsk(true)}>
        {label}
      </button>
    )
  }

  return (
    <form action={done ? callManager : lowerCar} className="lower-confirm">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="fit" value="yes" />
      {done && <input type="hidden" name="kind" value="done" />}
      <p className="lower-q" ref={question} tabIndex={-1}>
        הרכב סגור, מורכב, ואפשר לנסוע בו?
      </p>
      <div className="lower-do">
        <button className={className} type="submit" disabled={!armed}>
          {done ? "כן, סיימתי, להוריד לחניה" : "כן, להוריד לחניה"}
        </button>
        <button
          className="btn quiet big"
          type="button"
          onClick={() => {
            setAsk(false)
            setArmed(false)
          }}
        >
          לא, הוא נשאר על הליפט
        </button>
      </div>
    </form>
  )
}
