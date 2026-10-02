"use client"

import { useEffect, useRef, useState } from "react"
import { GEM_URL } from "@/lib/staff/gem"
import { shrink } from "@/components/staff/capture-button"

// "המוסכניק הוותיק" בתוך העמדה (סבב 2.10, ממצאים 2–5). עד 2.10 זה היה קישור ל-Gem:
// חלון חדש שמוציא מהאבחון, בלי לדעת איזה רכב על הליפט ומי שואל. כאן: חלון באותו
// מסך, מעל העמדה, עם ההקשר של הכרטיס מהשרת. סוגרים, וחוזרים בדיוק לאותו מקום.
// ה-Gem עצמו נשאר (פתרון 1), למטה בחלון, לטלפון הפרטי.

type Turn = { role: "user" | "model"; text: string; red?: boolean; photo?: string }

/** **מודגש** ושורות, בלי HTML מהמודל. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
            seg.startsWith("**") && seg.endsWith("**") ? <b key={j}>{seg.slice(2, -2)}</b> : <span key={j}>{seg}</span>,
          )}
        </p>
      ))}
    </>
  )
}

export function Mentor({ jobId, compact = false }: { jobId?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState("")
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const fileInput = useRef<HTMLInputElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)

  // החלון מעל העמדה: בלי גלילה של הדף מתחת, ו-Esc סוגר.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" })
  }, [turns, busy])

  async function onPhoto(files: FileList | null) {
    const file = files?.[0]
    if (fileInput.current) fileInput.current.value = ""
    if (!file) return
    const blob = await shrink(file)
    setPhoto((p) => {
      if (p) URL.revokeObjectURL(p.url)
      return { blob, url: URL.createObjectURL(blob) }
    })
  }

  async function send() {
    const q = text.trim()
    if ((!q && !photo) || busy) return
    setBusy(true)
    setError("")
    const mine: Turn = { role: "user", text: q || "(תמונה)", photo: photo?.url }
    const history = turns.map(({ role, text }) => ({ role, text }))
    setTurns((t) => [...t, mine])
    setText("")
    const form = new FormData()
    form.append("question", q)
    if (jobId) form.append("job_id", String(jobId))
    form.append("history", JSON.stringify(history))
    if (photo) form.append("photo", photo.blob, "photo.jpg")
    setPhoto(null)
    try {
      const res = await fetch("/api/staff/mentor", { method: "POST", body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error()
      setTurns((t) => [...t, { role: "model", text: json.answer, red: json.red_list }])
    } catch {
      setError("לא הגיעה תשובה. לנסות שוב, או לקרוא לדניאל.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={`gem-link${compact ? " compact" : ""}`} onClick={() => setOpen(true)}>
        <span aria-hidden>🧰</span>
        <span>
          <b>לשאול את המוסכניק הוותיק</b>
          {!compact && <small>יודע איזה רכב על הליפט. בעברית, בערבית או ברוסית.</small>}
        </span>
      </button>

      {open && (
        <div className="mentor-sheet" role="dialog" aria-modal="true" aria-labelledby="mentor-title">
          <header className="mentor-head">
            <h2 id="mentor-title">🧰 המוסכניק הוותיק</h2>
            <button type="button" className="btn quiet" onClick={() => setOpen(false)} aria-label="סגירה, חזרה לעמדה">
              חזרה לעמדה
            </button>
          </header>

          <div className="mentor-list" ref={list}>
            {turns.length === 0 && (
              <p className="mentor-empty">
                שואלים כמו שהייתם שואלים את אבי: קוד תקלה, איך בודקים, איזה שמן. הוא כבר יודע איזה רכב על הליפט. פעולה מסוכנת
                (חוטים, מחשב, כריות אוויר, מתח גבוה) — הוא יעצור ויגיד למי לקרוא.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`mentor-turn ${t.role}${t.red ? " red" : ""}`}>
                {/* תצוגה מקדימה מקומית (blob:), לא תמונה מהשרת: next/image לא מתאים כאן. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.photo && <img src={t.photo} alt="" className="mentor-photo" />}
                <Rich text={t.text} />
              </div>
            ))}
            {busy && <p className="mentor-wait" role="status">חושב… עד חצי דקה.</p>}
            {error && <p className="staff-error" role="alert">{error}</p>}
          </div>

          <form
            className="mentor-ask"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files)} />
            {photo && (
              <div className="mentor-attached">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="התמונה שתישלח" />
                <button type="button" className="btn quiet" onClick={() => setPhoto(null)}>
                  בלי התמונה
                </button>
              </div>
            )}
            <textarea
              rows={2}
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="השאלה. אפשר להכתיב עם המיקרופון של המקלדת."
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <div className="mentor-row">
              <button type="button" className="btn quiet" onClick={() => fileInput.current?.click()} disabled={busy}>
                📷 תמונה
              </button>
              <button type="submit" className="btn" disabled={busy || (!text.trim() && !photo)}>
                לשאול
              </button>
            </div>
            <p className="mentor-foot">
              השאלות נשמרות, כדי שאבי ודניאל ידעו מה כדאי להוסיף לנהלים.{" "}
              <a href={GEM_URL} target="_blank" rel="noreferrer">
                לפתוח ב-Gemini
              </a>
            </p>
          </form>
        </div>
      )}
    </>
  )
}
