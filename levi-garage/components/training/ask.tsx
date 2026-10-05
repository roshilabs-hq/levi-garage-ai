"use client"

// "שאלה על המערכת" במרכז ההדרכה (1.5.0, הרעיון של רועי). שואלים איך עושים משהו,
// והתשובה מגיעה עם כפתורים שמקפיצים לצילום ומסמנים את הכפתור הנכון.

import { useEffect, useRef, useState } from "react"

type Ref = { role: string; screen: string; n: number; label: string }
type Msg = { role: "user" | "model"; text: string; refs?: Ref[] }

const STARTERS = ["איך מורידים רכב לחניה?", "איך נותנים הנחה של 15%?", "שכחתי את הקוד שלי", "كيف أبلّغ عن عطل في الشاشة؟"]

export function AskPanel({ onRef }: { onRef: (role: string, screen: string, n: number) => void }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [msgs, busy])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

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
      setMsgs((m) => [...m, { role: "model", text: answer, refs: res.ok ? json.refs : [] }])
    } catch {
      setMsgs((m) => [...m, { role: "model", text: "אין חיבור כרגע. אפשר לנסות שוב בעוד רגע." }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="tg-ask-open btn" onClick={() => setOpen(true)}>
        שאלה על המערכת?
      </button>
    )
  }

  return (
    <div className="tg-ask" role="dialog" aria-label="שאלה על המערכת">
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
