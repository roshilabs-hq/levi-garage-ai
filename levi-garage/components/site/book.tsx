"use client"

import { useEffect, useRef, useState } from "react"

import { calDirectLink, siteConfig, whatsappLink, type Dict } from "@/lib/site/dict"

// היומן של Cal.com, מוטמע בדף שלנו.
//
// הסיבה היחידה להטמעה במקום קישור: כשהתור נקבע, Cal.com מודיע לדף
// (bookingSuccessful), ואז אנחנו מציגים "התור נקבע" עם כפתור לוואטסאפ.
// ההודעה הזאת היא מה שמאפשר לבוט לשלוח ללקוח תזכורת והודעה שהרכב מוכן,
// כי הבוט שולח רק למי שכתב לנו. הפניה מ-Cal.com לדף שלנו היא יכולת בתשלום.

declare global {
  interface Window {
    Cal?: ((...args: unknown[]) => void) & { ns?: Record<string, (...args: unknown[]) => void>; loaded?: boolean; q?: unknown[] }
  }
}

const NS = "dropoff"
const EMBED = "https://app.cal.com/embed/embed.js"

// קטע הטעינה הרשמי של Cal.com, כפי שהוא: יוצר תור פקודות עד שהסקריפט נטען.
function loadCal() {
  if (window.Cal) return
  /* eslint-disable */
  ;(function (C: any, A: string, L: string) {
    const p = function (a: any, ar: any) { a.q.push(ar) }
    const d = C.document
    C.Cal = C.Cal || function () {
      const cal = C.Cal
      const ar = arguments
      if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true }
      if (ar[0] === L) {
        const api: any = function () { p(api, arguments) }
        const namespace = ar[1]
        api.q = api.q || []
        if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]) } else p(cal, ar)
        return
      }
      p(cal, ar)
    }
  })(window, EMBED, "init")
  /* eslint-enable */
}

export function BookFlow({ t, plate, service }: { t: Dict; plate?: string; service?: string }) {
  const [done, setDone] = useState(false)
  const [slow, setSlow] = useState(false)
  // 3.10: האם סימן בטופס עדכונים בוואטסאפ. null = עוד לא יודעים (או שהבדיקה נכשלה).
  const [consent, setConsent] = useState<boolean | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const wa = whatsappLink(t.book.waMessage)

  useEffect(() => {
    loadCal()
    const Cal = window.Cal!
    Cal("init", NS, { origin: "https://app.cal.com" })
    const api = Cal.ns![NS]
    // שדות הטופס ממולאים מה-config, בשמות שלהם ב-Cal.com (plate, service).
    const config: Record<string, string> = { layout: "month_view" }
    if (plate) config.plate = plate
    if (service) config.service = service
    api("inline", { elementOrSelector: `#cal-${NS}`, calLink: siteConfig.bookingUrl.replace("https://cal.com/", ""), config })
    let stop = false
    const onBooked = (e?: { detail?: { data?: { uid?: unknown } } }) => {
      setDone(true)
      window.scrollTo({ top: 0, behavior: "smooth" })
      // התור מגיע למסד דרך Make תוך כמה שניות. שואלים כמה פעמים, ואז מוותרים בשקט.
      const uid = e?.detail?.data?.uid
      if (typeof uid !== "string") return
      let tries = 0
      const ask = async () => {
        if (stop || tries++ > 8) return
        try {
          const r = await fetch(`/api/booking-consent?uid=${encodeURIComponent(uid)}`, { cache: "no-store" })
          const j = (await r.json()) as { found: boolean; consent?: boolean }
          if (j.found) return setConsent(Boolean(j.consent))
        } catch {}
        setTimeout(ask, 1500)
      }
      ask()
    }
    // שני השמות: הישן, והחדש (V2) בגרסאות מאוחרות של ההטמעה.
    api("on", { action: "bookingSuccessful", callback: onBooked })
    api("on", { action: "bookingSuccessfulV2", callback: onBooked })

    // אם אחרי עשר שניות עדיין אין יומן — חוסם פרסומות, רשת איטית — מציעים
    // את הקישור הישיר. התור נקבע גם שם; רק ההודעה בסוף לא תופיע.
    const timer = setTimeout(() => {
      if (!box.current?.querySelector("iframe")) setSlow(true)
    }, 10_000)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [plate, service])

  return (
    <>
      {done && (
        <section className="booked-done" role="status" aria-live="polite">
          <h1>{t.book.doneTitle}</h1>
          <p>{t.book.doneLead}</p>
          <div className="booked-step">
            <h2>{t.book.stepTitle}</h2>
            {consent === false ? (
              <div className="booked-nudge">
                <h3>{t.book.nudgeTitle}</h3>
                <p>{t.book.nudgeBody}</p>
              </div>
            ) : (
              <p>{t.book.stepBody}</p>
            )}
            {wa ? (
              <a className="btn" href={wa} target="_blank" rel="noreferrer">
                {t.book.waButton}
              </a>
            ) : (
              <p>
                <a href={`tel:${siteConfig.phone}`}>{siteConfig.phone}</a>
              </p>
            )}
            <p className="booked-note">{t.book.note}</p>
          </div>
        </section>
      )}

      <div hidden={done}>
        <h1>{t.book.title}</h1>
        <p>{t.book.lead}</p>
        {t.book.formNote && <p className="cal-form-note">{t.book.formNote}</p>}
        <div className="cal-frame" ref={box} id={`cal-${NS}`}>
          <p className="cal-loading">{t.book.loading}</p>
        </div>
        {slow && (
          <>
            <p className="cal-fallback">
              <a href={calDirectLink({ plate, service })} target="_blank" rel="noreferrer">
                {t.book.fallback}
              </a>
            </p>
            {/* ביקורת UX, 8.10, ממצא 14: מי שקובע בקישור הישיר לא חוזר לכאן, ולא רואה את "צעד אחרון" */}
            <p className="cal-fallback-after">
              {t.book.fallbackAfter}
              {wa && (
                <>
                  {" "}
                  <a href={wa} target="_blank" rel="noreferrer">
                    {t.book.waButton}
                  </a>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </>
  )
}
