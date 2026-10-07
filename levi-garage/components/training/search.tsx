"use client"

// חיפוש בכל ההדרכות, ובוט "שאלה על המערכת". שניהם מובילים לדף הפנימי של המסך,
// עם #מספר הכפתור, ושם הנקודה נדלקת.

import Link from "next/link"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import type { ResolvedRole } from "@/lib/training/match"
import { trackOfRole } from "@/lib/training/tracks"
import { AskPanel } from "./ask"

const hrefOf = (role: string, screen: string, n?: number) => `/training/${trackOfRole(role)}/${screen}${n ? `#${n}` : ""}`

export function TrainingSearch({ roles }: { roles: ResolvedRole[] }) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const total = roles.reduce((sum, r) => sum + r.screens.reduce((a, s) => a + s.spots.length, 0), 0)

  const results = useMemo(() => {
    const q = query.trim()
    if (q.length < 2) return []
    return roles
      .flatMap((r) =>
        r.screens.flatMap((s) =>
          s.spots.filter((p) => p.t.includes(q) || p.b.includes(q) || s.title.includes(q)).map((p) => ({ role: r, screen: s, spot: p })),
        ),
      )
      .slice(0, 30)
  }, [query, roles])

  return (
    <div className="tg-find">
      <div className="tg-search-box">
        <label className="tg-search">
          <span className="sr-only">חיפוש בכל ההדרכות</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={`חיפוש בכל ${total} הכפתורים, למשל "להחזיר לתור"`}
          />
        </label>
        {/* ✕ לניקוי (רועי, 7.10): בלי זה, מי שלא מצא מילה נשאר עם השדה מלא. האייפון לא מציג ✕ משלו */}
        {query && (
          <button
            type="button"
            className="tg-search-clear"
            aria-label="ניקוי החיפוש"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            <X aria-hidden />
          </button>
        )}
      </div>
      {query.trim().length >= 2 && (
        <div className="tg-results" aria-live="polite">
          {results.length === 0 ? (
            <p className="tg-muted">לא נמצא. אפשר לנסות מילה אחרת, למשל &quot;הנחה&quot; או &quot;ליפט&quot;.</p>
          ) : (
            <ul>
              {results.map(({ role: r, screen: s, spot: p }) => (
                <li key={`${s.id}-${p.n}`}>
                  <Link href={hrefOf(r.id, s.id, p.n)}>
                    <b>{p.t}</b>
                    <span>
                      {r.name} · {s.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** הבוט, בכל דף של מרכז ההדרכה. כפתור בתשובה פותח את המסך שלו, על הכפתור. */
export function AskNav() {
  const router = useRouter()
  return (
    <AskPanel
      onRef={(role, screen, n) => {
        const path = hrefOf(role, screen)
        // באותו מסך: רק להחליף את ה-#. router.push לא מפעיל hashchange, והנקודה לא הייתה נדלקת.
        if (location.pathname === path) location.hash = String(n)
        else router.push(hrefOf(role, screen, n))
      }}
    />
  )
}
