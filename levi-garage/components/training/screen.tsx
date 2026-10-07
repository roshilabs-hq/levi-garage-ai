"use client"

// מסך אחד במדריך: צילום אמיתי, נקודה ממוספרת על כל כפתור, ולידו מה הכפתור עושה.
// "סיור מודרך" עובר נקודה אחרי נקודה. קישור עם #8 בכתובת קופץ ישר לכפתור 8
// (ככה הבוט "שאלה על המערכת" והחיפוש מקפיצים לכפתור הנכון).

import { useCallback, useEffect, useRef, useState } from "react"

import { UI, type GLang } from "@/lib/training/i18n-ui"
import type { ResolvedScreen } from "@/lib/training/match"

const PHONE = 600 // צילום צר מזה הוא של טלפון: מוצג צר, כמו בטלפון.

export function ScreenGuide({ screen, lang = "he" }: { screen: ResolvedScreen; lang?: GLang }) {
  const ui = UI[lang]
  const [current, setCurrent] = useState<number | null>(null)
  const [tour, setTour] = useState<number | null>(null)
  const spots = screen.spots

  const focus = useCallback((n: number, scroll = true) => {
    setCurrent(n)
    if (!scroll) return
    requestAnimationFrame(() => document.getElementById(`dot-${screen.id}-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))
  }, [screen.id])

  // #8 בכתובת: ישר לכפתור 8
  useEffect(() => {
    const fromHash = () => {
      const n = Number(decodeURIComponent(location.hash.slice(1)))
      if (spots.some((p) => p.n === n)) setTimeout(() => focus(n), 120)
    }
    fromHash()
    window.addEventListener("hashchange", fromHash)
    return () => window.removeEventListener("hashchange", fromHash)
  }, [spots, focus])

  const go = useCallback(
    (i: number) => {
      const p = spots[i]
      if (!p) return
      setTour(i)
      focus(p.n)
    },
    [spots, focus],
  )

  useEffect(() => {
    if (tour === null) return
    const onKey = (e: KeyboardEvent) => {
      // בעברית ובערבית "הבא" הוא שמאלה, ברוסית ימינה.
      const fwd = lang === "ru" ? "ArrowRight" : "ArrowLeft"
      const back = lang === "ru" ? "ArrowLeft" : "ArrowRight"
      if (e.key === fwd) go(Math.min(spots.length - 1, tour + 1))
      if (e.key === back) go(Math.max(0, tour - 1))
      if (e.key === "Escape") setTour(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tour, spots.length, go, lang])

  const step = tour !== null ? spots[tour] : null

  return (
    <>
      {spots.length > 1 && (
        <button className="btn tg-tour-start" onClick={() => go(0)}>
          {ui.tour(spots.length)}
        </button>
      )}
      <ScreenView screen={screen} lang={lang} current={current} onPick={(n) => { setTour(null); focus(n, false) }} />
      {step && tour !== null && (
        <div className="tg-tour" role="dialog" aria-label={ui.tourName} aria-live="polite">
          <p className="tg-tour-where">
            {ui.of(tour + 1, spots.length)} · {screen.title}
          </p>
          <p className="tg-tour-t">
            <span className="num">{step.n}</span> {step.t}
          </p>
          <p className="tg-tour-b">{step.b}</p>
          <div className="tg-tour-do">
            <button className="btn quiet" onClick={() => go(tour - 1)} disabled={tour === 0}>
              {ui.prev}
            </button>
            {tour < spots.length - 1 ? (
              <button className="btn" onClick={() => go(tour + 1)}>
                {ui.next}
              </button>
            ) : (
              <button className="btn" onClick={() => setTour(null)}>
                {ui.end}
              </button>
            )}
            <button className="tg-tour-x" onClick={() => setTour(null)} aria-label={ui.exitTour}>
              {ui.exit}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function ScreenView({ screen, current, onPick, lang = "he" }: { screen: ResolvedScreen; current: number | null; onPick: (n: number) => void; lang?: GLang }) {
  const ui = UI[lang]
  const phone = screen.width < PHONE
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (current === null) return
    const li = listRef.current?.querySelector<HTMLElement>(`[data-n="${current}"]`)
    // ברשימה שליד התמונה: לגלול רק בתוכה, לא את כל הדף.
    if (li && listRef.current && listRef.current.scrollHeight > listRef.current.clientHeight) {
      listRef.current.scrollTo({ top: li.offsetTop - listRef.current.clientHeight / 3, behavior: "smooth" })
    }
  }, [current])

  return (
    <section id={`screen-${screen.id}`} className={`tg-screen ${phone ? "tg-phone" : "tg-desk"}`} aria-label={ui.screen(screen.title)}>
      <div className="tg-body">
        <div className="tg-shot" style={{ aspectRatio: `${screen.width} / ${screen.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/training/${screen.id}.png`} alt={ui.shot(screen.title)} width={screen.width} height={screen.height} />
          {screen.spots.map((p) => (
            <button
              key={p.n}
              id={`dot-${screen.id}-${p.n}`}
              className={`tg-spot ${current === p.n ? "on" : ""}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` }}
              onClick={() => onPick(p.n)}
              aria-label={`${p.n}. ${p.t}`}
            >
              <span className="tg-dot num">{p.n}</span>
            </button>
          ))}
        </div>
        {screen.spots.length > 0 && (
          <ol className="tg-list" ref={listRef}>
            {screen.spots.map((p) => (
              <li key={p.n} data-n={p.n} className={current === p.n ? "on" : ""}>
                <button onClick={() => onPick(p.n)}>
                  <span className="tg-dot num">{p.n}</span>
                  <b>{p.t}</b>
                </button>
                <p>{p.b}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
