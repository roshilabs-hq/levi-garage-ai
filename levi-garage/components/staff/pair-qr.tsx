"use client"

import { useActionState, useEffect, useState } from "react"

import { createPairCode, type PairResult } from "@/app/(he)/station/actions"

// צימוד מכשיר אחר בקוד QR (022). דניאל בוחר ליפט, הקוד מופיע, סורקים בטלפון
// או בטאבלט שליד הליפט — והוא עמדה. בלי להקליד סיסמה על המכשיר.
//
// זו גם הדרך של בוחן עם מחשב אחד וטלפון אחד: המחשב הוא דניאל, הטלפון הוא הליפט.

function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()))
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, new Date(until).getTime() - Date.now())), 1000)
    return () => clearInterval(id)
  }, [until])
  if (left === 0) return <b>הקוד פג. ליצור חדש.</b>
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return (
    <span>
      תקף עוד <b className="num" dir="ltr">{m}:{String(s).padStart(2, "0")}</b>, ופעם אחת בלבד
    </span>
  )
}

export function PairQr() {
  const [result, action, pending] = useActionState<PairResult, FormData>(createPairCode, null)

  return (
    <div className="pair-qr">
      <form action={action} className="pair-form">
        <select name="lift" defaultValue="" required aria-label="לאיזו עמדה">
          <option value="" disabled>לאיזו עמדה?</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>ליפט {n}</option>
          ))}
          <option value="diag">עמדת האבחון</option>
        </select>
        <button className="btn" type="submit" disabled={pending}>{pending ? "יוצרים..." : "ליצור קוד"}</button>
      </form>

      {result && !result.ok && <p className="staff-error" role="alert">{result.error}</p>}

      {result?.ok && (
        <div className="pair-qr-card">
          {/* ה-SVG נוצר בשרת מהכתובת, ואין בו שום דבר מלבד הריבועים. */}
          <div className="pair-qr-img" role="img" aria-label={`קוד QR לצימוד ${result.label}`} dangerouslySetInnerHTML={{ __html: result.svg }} />
          <div className="pair-qr-text">
            <b>לסרוק במכשיר של {result.label}</b>
            <ol>
              <li>לפתוח את המצלמה בטלפון או בטאבלט ולכוון לקוד.</li>
              <li>לגעת בקישור שמופיע, ואז &quot;לחבר את המכשיר הזה&quot;.</li>
              <li>המכשיר מציג את שמות המכונאים. נוגעים בשם ומקישים את הקוד האישי.</li>
            </ol>
            <p className="staff-meta">
              <Countdown until={result.expiresAt} />
            </p>
            <details className="pair-qr-link">
              <summary>אין מצלמה? הקישור</summary>
              <code dir="ltr">{result.url}</code>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}
