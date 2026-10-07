"use client"

// "שאלה על המערכת" במרכז ההדרכה (1.5.0, הרעיון של רועי). שואלים איך עושים משהו,
// והתשובה מגיעה עם כפתורים שמקפיצים לצילום ומסמנים את הכפתור הנכון.

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

type Ref = { role: string; screen: string; n: number; label: string }
type Msg = { role: "user" | "model"; text: string; refs?: Ref[]; exam?: boolean }

const STARTERS = ["איך מורידים רכב לחניה?", "איך נותנים הנחה של 15%?", "שכחתי את הקוד שלי", "كيف أبلّغ عن عطل في الشاشة؟"]

export function AskPanel({ onRef }: { onRef: (role: string, screen: string, n: number) => void }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [msgs, busy])
  // נגישות (6.10): בפתיחה הפוקוס עובר לשדה, ובסגירה הוא חוזר לכפתור שפתח את החלון.
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else if (wasOpen.current) openRef.current?.focus()
    wasOpen.current = open
  }, [open])

  // Esc סוגר, ו-Tab נשאר בתוך החלון (לא בורח לתחתית הדף).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key !== "Tab" || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    const history = msgs.map(({ role, text }) => ({ role, text }))
    setMsgs((m) => [...m, { role: "user", text: question }])
    setText("")
    setBusy(true)
    try {
      const res = await fetch("/api/training-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history }),
      })
      const json = await res.json().catch(() => ({}))
      const answer =
        res.status === 429
          ? "יותר מדי שאלות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות, או לחפש בשורת החיפוש למעלה."
          : res.ok && json.answer
            ? json.answer
            : "לא הצלחתי לענות כרגע. אפשר לחפש בשורת החיפוש למעלה, או לשאול את דניאל."
      setMsgs((m) => [...m, { role: "model", text: answer, refs: res.ok ? json.refs : [], exam: res.ok && json.exam === true }])
    } catch {
      setMsgs((m) => [...m, { role: "model", text: "אין חיבור כרגע. אפשר לנסות שוב בעוד רגע." }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button ref={openRef} className="tg-ask-open btn" onClick={() => setOpen(true)}>
        שאלה על המערכת?
      </button>
    )
  }

  return (
    <div ref={dialogRef} className="tg-ask" role="dialog" aria-modal="true" aria-label="שאלה על המערכת" onKeyDown={onKeyDown}>
      <div className="tg-ask-head">
        <b>שאלה על המערכת</b>
        <button onClick={() => setOpen(false)}>סגירה</button>
      </div>
      <div className="tg-ask-msgs" aria-live="polite">
        {msgs.length === 0 && (
          <div className="tg-ask-hello">
            <p>אפשר לשאול איך עושים משהו במערכת, בעברית, בערבית או ברוסית. התשובה מראה על איזה כפתור ללחוץ.</p>
            <div className="tg-ask-starters">
              {STARTERS.map((q) => (
                <button key={q} onClick={() => ask(q)} dir="auto">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`tg-msg ${m.role}`}>
            <p dir="auto">{m.text}</p>
            {/* שאלה של בוחן הקורס (7.10): הבוט עונה רק על המדריכים, ומפנה לדף ההנחיות לבוחנים */}
            {m.exam && (
              <div className="tg-msg-refs">
                <Link href="/training/exam">להנחיות לבוחנים ←</Link>
              </div>
            )}
            {m.refs && m.refs.length > 0 && (
              <div className="tg-msg-refs">
                {m.refs.map((r) => (
                  <button
                    key={`${r.screen}-${r.n}`}
                    onClick={() => {
                      // בטלפון החלון מכסה חצי מסך, ובדיוק את הכפתור שקפצנו אליו. השיחה נשמרת.
                      if (window.matchMedia("(max-width: 640px)").matches) setOpen(false)
                      onRef(r.role, r.screen, r.n)
                    }}
                  >
                    <span className="tg-dot num">{r.n}</span> {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="tg-msg model tg-muted">רגע…</p>}
        <div ref={endRef} />
      </div>
      <form
        className="tg-ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(text)
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="למשל: איך מחזירים רכב לתור?"
          maxLength={400}
          dir="auto"
          aria-label="השאלה"
        />
        <button className="btn" type="submit" disabled={busy || !text.trim()}>
          לשאול
        </button>
      </form>
      <p className="tg-ask-note">עונה רק מתוך המדריך. לא רואה לקוחות, רכבים או מחירים, ולא שומר את השאלות.</p>
    </div>
  )
}
