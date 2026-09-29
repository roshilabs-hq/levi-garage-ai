"use client"

import { useActionState, useState } from "react"

import { answerCall, type AnswerResult } from "@/app/(he)/staff/actions"

// "דניאל כאן?" על מסך העמדה, מתחת ל"דניאל בדרך" (רועי, 29.9). דניאל נוגע בשם שלו
// ומקיש את הקוד שלו, בדיוק כמו מכונאי בכניסה לעמדה. סגור כברירת מחדל, כדי שהמכונאי
// לא יראה שדה קוד שלא שייך לו.
export function AnswerCall({ callId, answerers }: { callId: number; answerers: { id: string; full_name: string }[] }) {
  const [state, action] = useActionState<AnswerResult, FormData>(answerCall, null)
  const [who, setWho] = useState(answerers[0]?.id ?? "")
  if (answerers.length === 0) return null

  return (
    <details className="answer-call">
      <summary>{answerers.length === 1 ? `${answerers[0].full_name} כאן? הקוד שלו` : "דניאל כאן? הקוד שלו"}</summary>
      <form action={action} className="answer-call-form">
        <input type="hidden" name="call_id" value={callId} />
        <input type="hidden" name="staff_id" value={who} />
        {answerers.length > 1 && (
          <div className="answer-who" role="group" aria-label="מי הגיע">
            {answerers.map((a) => (
              <button key={a.id} type="button" className={a.id === who ? "btn" : "btn quiet"} aria-pressed={a.id === who} onClick={() => setWho(a.id)}>
                {a.full_name}
              </button>
            ))}
          </div>
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
          placeholder="6 ספרות"
          className="answer-pin"
        />
        <button className="btn" type="submit">הגעתי</button>
        {state?.error && <p className="staff-error" role="alert">{state.error}</p>}
        {state?.ok && <p className="staff-note" role="status">{state.ok}</p>}
      </form>
    </details>
  )
}
