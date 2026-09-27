"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

// הכפתור של המכונאי: לחיצה אחת, תמונה, ודיבור. בלי הקלדה ובלי מסכים.
//
// מהמחקר (27.9): מה שמפיל מערכות כאלה במוסכים הוא לא הגריז, אלא מספר הצעדים.
// מכונאים מסתדרים עם פרק אצבע על מסך, אבל לא עם טופס. לכן:
//   1. לחיצה בפרק אצבע על כפתור ענק פותחת מצלמה.
//   2. אחרי הצילום ההקלטה מתחילה לבד, ונעצרת לבד כשהוא מפסיק לדבר (או אחרי 25 שניות).
//   3. הכול נשלח, ודניאל מקבל טיוטה. המכונאי לא אומר מחיר — המחיר מהמחירון.
// אם אין מצלמה או מיקרופון, יש מסלול בלי תמונה ומסלול בלי קול.

type State = "idle" | "shooting" | "recording" | "sending" | "done" | "error"

const MAX_EDGE = 1600
const QUALITY = 0.82
const MAX_SECONDS = 25
const SILENCE_MS = 2500
const LEVEL = 0.025

async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

export function CaptureButton({
  jobId,
  item,
  label = "צילום ודיווח",
  size = "big",
}: {
  jobId: number
  /** מבדיקת הכניסה: איזה פריט ואיזה צבע */
  item?: { key: string; light: "yellow" | "red" }
  label?: string
  size?: "big" | "small"
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement | null>(null)
  const photo = useRef<Blob | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const cleanup = useRef<() => void>(() => {})
  const [state, setState] = useState<State>("idle")
  const [seconds, setSeconds] = useState(0)
  const [message, setMessage] = useState("")
  const [needTap, setNeedTap] = useState(false)

  useEffect(() => () => cleanup.current(), [])

  // מכונאי שפתח מצלמה והתחרט: הכפתור חוזר למצב רגיל. ב-React אין onCancel
  // לשדה קובץ, ולכן מאזינים לאירוע של הדפדפן ישירות.
  useEffect(() => {
    const el = input.current
    if (!el) return
    const onCancel = () => setState((s) => (s === "shooting" ? "idle" : s))
    el.addEventListener("cancel", onCancel)
    return () => el.removeEventListener("cancel", onCancel)
  }, [])

  async function send(audio: Blob | null) {
    setState("sending")
    const form = new FormData()
    form.append("job_id", String(jobId))
    if (photo.current) form.append("photo", photo.current, "photo.jpg")
    if (audio && audio.size > 0) form.append("audio", audio, "note.webm")
    if (item) {
      form.append("item", item.key)
      form.append("light", item.light)
    }
    try {
      const res = await fetch("/api/staff/voice", { method: "POST", body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setState("error")
        setMessage(
          json?.saved
            ? "נשמר, אבל הניתוח נכשל. דניאל רואה את זה בכרטיס ויכול לנסות שוב."
            : "לא נשמר. כדאי לנסות שוב.",
        )
        return
      }
      setState("done")
      setMessage(json.red_list ? `נרשם: ${json.title}. רשימה אדומה: לעצור ולקרוא לאבי.` : `נרשם: ${json.title}. דניאל קיבל.`)
      router.refresh()
    } catch {
      setState("error")
      setMessage("אין חיבור כרגע. לא נשלח.")
    } finally {
      photo.current = null
    }
  }

  async function record(fromTap = true) {
    setNeedTap(false)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // מיד אחרי המצלמה, בלי לחיצה: יש דפדפנים (בעיקר באייפון) שלא פותחים
      // מיקרופון בלי מגע. אז מופיע כפתור ענק אחד "לדבר עכשיו", וזהו.
      if (!fromTap) {
        setNeedTap(true)
        setState("shooting")
        return
      }
      // בלי מיקרופון בכלל: אם יש תמונה, שולחים אותה לבד. דניאל יראה, או יבוא.
      if (photo.current) return send(null)
      setState("error")
      setMessage("אין גישה למיקרופון. צריך לאשר אותה בהגדרות הדפדפן.")
      return
    }

    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
    rec.onstop = () => {
      cleanup.current()
      send(new Blob(chunks.current, { type: rec.mimeType }))
    }

    // עוצר לבד כשהוא מפסיק לדבר: אין צורך לגעת שוב במסך עם יד מלוכלכת.
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const started = Date.now()
    let spoke = false
    let quietSince = Date.now()

    const tick = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
      const now = Date.now()
      if (rms > LEVEL) {
        spoke = true
        quietSince = now
      }
      setSeconds(Math.floor((now - started) / 1000))
      if ((spoke && now - quietSince > SILENCE_MS) || now - started > MAX_SECONDS * 1000) stop()
    }, 150)

    cleanup.current = () => {
      clearInterval(tick)
      stream.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
      cleanup.current = () => {}
    }

    rec.start()
    recorder.current = rec
    setSeconds(0)
    setState("recording")
  }

  function stop() {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop()
  }

  async function onPhoto(list: FileList | null) {
    const file = list?.[0]
    if (input.current) input.current.value = ""
    if (!file) {
      setState("idle")
      return
    }
    photo.current = await shrink(file)
    // הקלטה בלי לחיצה נוספת.
    await record(false)
  }

  function start() {
    setMessage("")
    photo.current = null
    setState("shooting")
    input.current?.click()
  }

  return (
    <div className={`capture ${size} ${state}`}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => onPhoto(e.target.files)}
      />

      {state === "recording" ? (
        <button type="button" className="capture-btn recording" onClick={stop} aria-live="polite">
          <span className="capture-dot" aria-hidden />
          מקליט {seconds} שנ׳ · לחיצה לסיום
        </button>
      ) : needTap ? (
        <button type="button" className="capture-btn" onClick={() => record()}>
          <span className="capture-dot" aria-hidden />
          לדבר עכשיו
        </button>
      ) : (
        <button type="button" className="capture-btn" onClick={start} disabled={state === "sending"}>
          <span className="capture-dot" aria-hidden />
          {state === "sending" ? "שולחים..." : state === "done" ? "עוד ממצא" : label}
        </button>
      )}

      {state === "idle" || state === "done" || state === "error" ? (
        <button type="button" className="capture-alt" onClick={() => { setMessage(""); photo.current = null; record() }}>
          בלי תמונה, רק לדבר
        </button>
      ) : null}

      {message && (
        <p className={`capture-msg ${state}`} role="status">
          {message}
        </p>
      )}
    </div>
  )
}
