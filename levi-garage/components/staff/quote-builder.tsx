"use client"

import { useActionState, useCallback, useState, type ReactNode } from "react"

import { dismissFinding, sendQuoteRequest, type RequestState } from "@/app/(he)/staff/actions"
import { DraftForm, type Draft } from "@/components/staff/draft-form"
import type { PriceItem } from "@/components/staff/arrive-form"

// כל מה שמחכה לדניאל ברכב אחד, ושליחה אחת ללקוח (רועי, 30.9: "לא שולחים הודעה
// 5 פעמים. הכל מרוכז"). כל ממצא: תמונות, מה נאמר, עבודה מהמחירון ונוסח. דניאל מסמן
// מה יוצא, ולוחץ פעם אחת. הלקוח מקבל הודעה אחת, ובה קישור אחד לכל הממצאים.

export type BuilderDraft = Draft & {
  urgency: string | null
  red_list: boolean | null
  transcript: string | null
  /** הסיכום לצוות. "⚠ לא תואם לפריט" = המכונאי דיבר על משהו אחר מהפריט שבאבחון */
  summary: string | null
  created_at: string
  stamp: string
}

export function QuoteBuilder({
  jobId,
  drafts,
  items,
  suggestFor,
  maxDiscount,
  extras,
}: {
  jobId: number
  drafts: BuilderDraft[]
  items: PriceItem[]
  suggestFor: Record<number, string>
  maxDiscount: number
  /** תמונות וכפתור "להוסיף תמונה" לכל ממצא, מהשרת (כתובות חתומות). */
  extras: Record<number, ReactNode>
}) {
  const [state, send, sending] = useActionState<RequestState, FormData>(sendQuoteRequest, null)
  const [status, setStatus] = useState<Record<number, { ready: boolean; dirty: boolean }>>({})
  // מה לא לשלוח עכשיו. ברירת המחדל: כל מה שמוכן יוצא.
  const [skip, setSkip] = useState<Set<number>>(new Set())

  const report = useCallback(
    (id: number) => (s: { ready: boolean; dirty: boolean }) =>
      setStatus((prev) => (prev[id]?.ready === s.ready && prev[id]?.dirty === s.dirty ? prev : { ...prev, [id]: s })),
    [],
  )

  const chosen = drafts.filter((d) => status[d.id]?.ready && !skip.has(d.id))
  const notReady = drafts.filter((d) => !status[d.id]?.ready)

  return (
    <div className="qb">
      <ol className="qb-list">
        {drafts.map((d) => {
          const ready = Boolean(status[d.id]?.ready)
          return (
            <li key={d.id} id={`f-${d.id}`} className={`qb-item urgency-${d.urgency ?? "yellow"}`}>
              <div className="qb-head">
                <label className="qb-include" title={ready ? "לכלול בהודעה" : "עוד לא מוכן"}>
                  <input
                    type="checkbox"
                    checked={ready && !skip.has(d.id)}
                    disabled={!ready}
                    onChange={(e) =>
                      setSkip((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.delete(d.id)
                        else next.add(d.id)
                        return next
                      })
                    }
                  />
                  <span className={`light-dot ${d.urgency === "red" ? "red" : "yellow"}`} aria-hidden />
                  <b>{d.title || "ממצא"}</b>
                  {d.safety && <span className="qb-tag">בטיחות</span>}
                </label>
                <span className="staff-meta">{d.stamp}</span>
              </div>
              {d.red_list && <p className="job-red">רשימה אדומה: לעצור ולקרוא לאבי</p>}
              {d.summary && d.summary !== d.title && (
                <p className={d.summary.startsWith("⚠") ? "qb-summary warn" : "qb-summary"}>{d.summary}</p>
              )}

              {extras[d.id]}

              {d.transcript && (
                <details className="job-transcript">
                  <summary>מה נאמר בהקלטה</summary>
                  <p>{d.transcript}</p>
                </details>
              )}

              <DraftForm
                jobId={jobId}
                draft={d}
                items={items}
                suggest={suggestFor[d.id]}
                maxDiscount={maxDiscount}
                onState={report(d.id)}
              />

              <form action={dismissFinding} className="qb-dismiss">
                <input type="hidden" name="finding_id" value={d.id} />
                <input type="hidden" name="job_id" value={jobId} />
                <button type="submit" className="link-btn">לא לשלוח את זה (לבטל)</button>
              </form>
            </li>
          )
        })}
      </ol>

      <form action={send} className="qb-send">
        <input type="hidden" name="job_id" value={jobId} />
        {chosen.map((d) => (
          <input key={d.id} type="hidden" name="finding_id" value={d.id} />
        ))}
        <button className="btn big" type="submit" disabled={sending || chosen.length === 0}>
          {sending
            ? "שולחים..."
            : chosen.length === 0
              ? "לשלוח ללקוח"
              : chosen.length === 1
                ? "לשלוח ללקוח: ממצא אחד"
                : `לשלוח ללקוח: ${chosen.length} ממצאים בהודעה אחת`}
        </button>
        <p className="staff-meta">
          הלקוח מקבל הודעת וואטסאפ אחת ומייל אחד, עם קישור אחד. שם הוא רואה תמונות ומחיר לכל ממצא, ומאשר או דוחה כל אחד.
          {notReady.length > 0 &&
            ` ${notReady.length === 1 ? "ממצא אחד עוד לא מוכן" : `${notReady.length} ממצאים עוד לא מוכנים`}, ולא ייכלל${notReady.length === 1 ? "" : "ו"}.`}
        </p>
        {state && !state.ok && (
          <p className="staff-error" role="alert">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p className="staff-note notice-sent" role="status">
            נשלח: הודעה אחת ללקוח, עם {state.count === 1 ? "ממצא אחד" : `${state.count} ממצאים`}.
          </p>
        )}
      </form>
    </div>
  )
}
