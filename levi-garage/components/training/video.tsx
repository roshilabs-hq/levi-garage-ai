"use client"

// נגן לסרטוני ההדרכה (5.10): אינדקס פרקים ליד הסרטון. לחיצה על פרק קופצת אליו, והפרק
// הנוכחי מסומן. כתוביות לבחירה, בעברית, בערבית וברוסית, בלי רקע שחור (רועי, 4.10).

import { useEffect, useRef, useState } from "react"

export type Chapter = { t: number; title: string }
export type TrainingVideo = { id: string; title: string; who: string; length: string; src: string; poster: string; chapters: Chapter[] }

const LANGS = [
  { id: "", label: "בלי כתוביות" },
  { id: "he", label: "עברית" },
  { id: "ar", label: "العربية" },
  { id: "ru", label: "Русский" },
]
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`

export function VideoPlayer({ video }: { video: TrainingVideo }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  const [lang, setLang] = useState("")

  useEffect(() => {
    const v = ref.current
    if (!v) return
    for (const tr of Array.from(v.textTracks)) tr.mode = tr.language === lang ? "showing" : "disabled"
  }, [lang])

  const current = video.chapters.reduce((acc, c, i) => (now >= c.t - 0.2 ? i : acc), 0)

  return (
    <section className="tv" aria-labelledby={`v-${video.id}`}>
      <div className="tv-head">
        <h2 id={`v-${video.id}`}>{video.title}</h2>
        <p>
          {video.who} · {video.length}
        </p>
      </div>
      <div className="tv-body">
        <div className="tv-player">
          <video
            ref={ref}
            controls
            playsInline
            preload="metadata"
            poster={video.poster}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          >
            <source src={video.src} type="video/mp4" />
            {LANGS.filter((l) => l.id).map((l) => (
              <track key={l.id} kind="subtitles" srcLang={l.id} label={l.label} src={video.src.replace(/\.mp4$/, `.${l.id}.vtt`)} />
            ))}
          </video>
          <div className="tv-langs" role="group" aria-label="כתוביות">
            {LANGS.map((l) => (
              <button key={l.id} className={lang === l.id ? "on" : ""} onClick={() => setLang(l.id)} aria-pressed={lang === l.id}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <ol className="tv-chapters" aria-label="פרקים">
          {video.chapters.map((c, i) => (
            <li key={c.t}>
              <button
                className={i === current && now > 0 ? "on" : ""}
                onClick={() => {
                  const v = ref.current
                  if (!v) return
                  v.currentTime = c.t
                  void v.play()
                }}
              >
                <span className="num">{mmss(c.t)}</span> {c.title}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
