"use client"

// המדריך האינטראקטיבי: צילום אמיתי של כל מסך, נקודה ממוספרת על כל כפתור, ולידו
// מה הכפתור עושה. אפשר לעבור לבד, לחפש, או "סיור מודרך" שעובר נקודה אחרי נקודה.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ResolvedRole, ResolvedScreen } from "@/lib/training/resolve"

type Active = { screen: string; n: number } | null
type Step = { role: string; screen: ResolvedScreen; n: number; t: string; b: string }

const PHONE = 600 // צילום צר מזה הוא של טלפון: מוצג צר, כמו בטלפון.

export function TrainingGuide({ roles }: { roles: ResolvedRole[] }) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "")
  const [active, setActive] = useState<Active>(null)
  const [tour, setTour] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const role = roles.find((r) => r.id === roleId) ?? roles[0]

  // הלשונית נשמרת בכתובת (#office), כדי שאפשר לשלוח קישור ישר לחלק של כל אחד.
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(location.hash.slice(1)).split("/")[0]
      if (roles.some((r) => r.id === id)) setRoleId(id)
    }
    fromHash()
    window.addEventListener("hashchange", fromHash)
    return () => window.removeEventListener("hashchange", fromHash)
  }, [roles])

  const pickRole = (id: string) => {
    setRoleId(id)
    setActive(null)
    setTour(null)
    history.replaceState(null, "", `#${id}`)
  }

  const steps: Step[] = useMemo(
    () => role.screens.flatMap((s) => s.spots.map((p) => ({ role: role.id, screen: s, n: p.n, t: p.t, b: p.b }))),
    [role],
  )

  const focusSpot = useCallback((screen: string, n: number, scroll = true) => {
    setActive({ screen, n })
    if (!scroll) return
    requestAnimationFrame(() => {
      document.getElementById(`dot-${screen}-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }, [])

  const go = useCallback(
    (i: number) => {
      const s = steps[i]
      if (!s) return
      setTour(i)
      focusSpot(s.screen.id, s.n)
    },
    [steps, focusSpot],
  )

  useEffect(() => {
    if (tour === null) return
    const onKey = (e: KeyboardEvent) => {
      // בעברית "הבא" הוא שמאלה.
      if (e.key === "ArrowLeft") go(Math.min(steps.length - 1, tour + 1))
      if (e.key === "ArrowRight") go(Math.max(0, tour - 1))
      if (e.key === "Escape") setTour(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tour, steps.length, go])

  const results = useMemo(() => {
    const q = query.trim()
    if (q.length < 2) return []
    return roles.flatMap((r) =>
      r.screens.flatMap((s) =>
        s.spots
          .filter((p) => p.t.includes(q) || p.b.includes(q) || s.title.includes(q))
          .map((p) => ({ role: r, screen: s, spot: p })),
      ),
    ).slice(0, 30)
  }, [query, roles])

  const total = roles.reduce((sum, r) => sum + r.screens.reduce((a, s) => a + s.spots.length, 0), 0)
  const step = tour !== null ? steps[tour] : null

  return (
    <div className="tg">
      <div className="tg-bar">
        <div className="tg-roles" role="tablist" aria-label="למי המדריך">
          {roles.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={r.id === role.id}
              className={r.id === role.id ? "on" : ""}
              onClick={() => pickRole(r.id)}
            >
              {r.name}
            </button>
          ))}
        </div>
        <label className="tg-search">
          <span className="sr-only">חיפוש בכל המדריך</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`חיפוש בכל ${total} הכפתורים, למשל "להחזיר לתור"`}
          />
        </label>
      </div>

      {query.trim().length >= 2 && (
        <div className="tg-results" aria-live="polite">
          {results.length === 0 ? (
            <p className="tg-muted">לא נמצא. אפשר לנסות מילה אחרת, למשל &quot;הנחה&quot; או &quot;ליפט&quot;.</p>
          ) : (
            <ul>
              {results.map(({ role: r, screen: s, spot: p }) => (
                <li key={`${s.id}-${p.n}`}>
                  <button
                    onClick={() => {
                      setQuery("")
                      setRoleId(r.id)
                      history.replaceState(null, "", `#${r.id}`)
                      setTour(null)
                      setTimeout(() => focusSpot(s.id, p.n), 50)
                    }}
                  >
                    <b>{p.t}</b>
                    <span>
                      {r.name} · {s.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <header className="tg-role">
        <p className="tg-who">{role.who}</p>
        <p className="tg-why">{role.why}</p>
        {steps.length > 0 && (
          <button className="btn" onClick={() => go(0)}>
            סיור מודרך: {steps.length} כפתורים, אחד אחרי השני
          </button>
        )}
        <nav className="tg-toc" aria-label="המסכים">
          {role.screens.map((s, i) => (
            <a key={s.id} href={`#${role.id}/${s.id}`} onClick={(e) => {
              e.preventDefault()
              document.getElementById(`screen-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}>
              <span className="num">{i + 1}</span> {s.title}
            </a>
          ))}
        </nav>
      </header>

      {role.screens.map((s, i) => (
        <ScreenView key={s.id} index={i + 1} screen={s} active={active} onPick={(n) => { setTour(null); focusSpot(s.id, n, false) }} />
      ))}

      {step && tour !== null && (
        <div className="tg-tour" role="dialog" aria-label="סיור מודרך" aria-live="polite">
          <p className="tg-tour-where">
            {tour + 1} מתוך {steps.length} · {step.screen.title}
          </p>
          <p className="tg-tour-t">
            <span className="num">{step.n}</span> {step.t}
          </p>
          <p className="tg-tour-b">{step.b}</p>
          <div className="tg-tour-do">
            <button className="btn quiet" onClick={() => go(tour - 1)} disabled={tour === 0}>
              הקודם
            </button>
            {tour < steps.length - 1 ? (
              <button className="btn" onClick={() => go(tour + 1)}>
                הבא
              </button>
            ) : (
              <button className="btn" onClick={() => setTour(null)}>
                סיום
              </button>
            )}
            <button className="tg-tour-x" onClick={() => setTour(null)} aria-label="יציאה מהסיור">
              יציאה
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScreenView({ index, screen, active, onPick }: { index: number; screen: ResolvedScreen; active: Active; onPick: (n: number) => void }) {
  const phone = screen.width < PHONE
  const listRef = useRef<HTMLOListElement>(null)
  const current = active?.screen === screen.id ? active.n : null

  useEffect(() => {
    if (current === null) return
    const li = listRef.current?.querySelector<HTMLElement>(`[data-n="${current}"]`)
    // ברשימה שליד התמונה: לגלול רק בתוכה, לא את כל הדף.
    if (li && listRef.current && listRef.current.scrollHeight > listRef.current.clientHeight) {
      listRef.current.scrollTo({ top: li.offsetTop - listRef.current.clientHeight / 3, behavior: "smooth" })
    }
  }, [current])

  return (
    <section id={`screen-${screen.id}`} className={`tg-screen ${phone ? "tg-phone" : "tg-desk"}`} aria-labelledby={`t-${screen.id}`}>
      <h2 id={`t-${screen.id}`}>
        <span className="num">{index}</span> {screen.title}
      </h2>
      <p className="tg-intro">{screen.intro}</p>
      <div className="tg-body">
        <div className="tg-shot" style={{ aspectRatio: `${screen.width} / ${screen.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/training/${screen.id}.png`} alt={`צילום המסך: ${screen.title}`} width={screen.width} height={screen.height} loading="lazy" />
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
