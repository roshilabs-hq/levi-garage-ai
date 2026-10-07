import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { LangSwitch } from "@/components/training/lang-switch"
import { ReadCards } from "@/components/training/reads"
import { AskNav, TrainingSearch } from "@/components/training/search"
import { dicts } from "@/lib/site/dict"
import { translateRole } from "@/lib/training/i18n"
import { UI, dirOf, glang, withLang } from "@/lib/training/i18n-ui"
import { readsFor } from "@/lib/training/read"
import { resolveGuide } from "@/lib/training/resolve"
import { TRACKS, mmss, screensOf, startOf, trackOf, videoOf } from "@/lib/training/tracks"

type Props = { params: Promise<{ track: string }>; searchParams: Promise<{ lang?: string }> }

export const generateStaticParams = () => TRACKS.map((t) => ({ track: t.id }))
export const dynamicParams = false

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tr = trackOf((await params).track)
  return { title: tr ? `${tr.title} | מרכז ההדרכה` : "מרכז ההדרכה" }
}

// מאגר ההדרכות של מסלול: הסרטונים שלו, וכרטיס לכל מסך, מקובצים לפי תפקיד.
// מסלול העובדים גם בערבית וברוסית (7.10): ?lang=ar או ?lang=ru. שמות הכפתורים נשארים בעברית.
export default async function TrackPage({ params, searchParams }: Props) {
  const tr = trackOf((await params).track)
  if (!tr) notFound()
  const workers = tr.id === "workers"
  const lang = workers ? glang((await searchParams).lang) : "he"
  const ui = UI[lang]
  const t = dicts.he
  const { roles } = resolveGuide()
  const groups = screensOf(tr, roles)
  const base = `/training/${tr.id}`
  let n = 0
  return (
    <div className="tr-page">
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <main id="main" className="wrap training" lang={lang} dir={dirOf(lang)}>
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">{ui.home}</Link> <span aria-hidden="true">›</span>{" "}
          <span aria-current="page">{lang === "he" ? tr.title : ui.trackTitle}</span>
        </nav>
        <h1>{lang === "he" ? tr.title : ui.trackTitle}</h1>
        {workers && <LangSwitch href={base} lang={lang} />}
        <p className="training-lead">{lang === "he" ? `${tr.who}. ${tr.lead}` : ui.trackLead}</p>

        <h2 className="tp-group">{ui.written}</h2>
        <ReadCards reads={readsFor(tr.id)} lang={lang} />

        <h2 className="tp-group">{ui.videos}</h2>
        <div className="th-videos">
          {/* קודם הקצר ("למה"), אחר כך ההדרכה המלאה ("איך") */}
          {[...tr.extra, tr.video].map((id) => {
            const v = videoOf(id)
            if (!v) return null
            const vt = ui.videosT[id]
            return (
              <Link key={id} href={withLang(`/training/video/${id}`, lang)} className="tp-card tp-video">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.poster} alt="" loading="lazy" />
                <span className="tp-kicker">{ui.videoKicker(v.length)}</span>
                <span className="tp-title">{vt?.title ?? v.title}</span>
                <span className="tp-lead">{vt?.who ?? v.who}</span>
              </Link>
            )
          })}
        </div>

        {/* החיפוש עובר על הטקסט העברי, ולכן מוצג רק בעברית */}
        {lang === "he" && <TrainingSearch roles={roles} />}

        {groups.map((r) => {
          const rt = translateRole(r, lang)
          return (
            <section key={r.id} aria-labelledby={`g-${r.id}`}>
              <h2 className="tp-group" id={`g-${r.id}`}>
                {lang === "he" ? r.name : ui.mechanics}
              </h2>
              <p className="tp-why">{lang === "he" ? r.why : ui.mechWhy}</p>
              <ol className="tp-grid">
                {r.screens.map((s, i) => {
                  n++
                  const at = startOf(tr, s)
                  const st = rt.screens[i]
                  return (
                    <li key={s.id}>
                      <Link href={withLang(`${base}/${s.id}`, lang)} className="tp-card">
                        <span className="tp-shot">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/training/${s.id}.png`} alt="" loading="lazy" />
                        </span>
                        <span className="tp-kicker">{ui.screenKicker(n, s.spots.length, at !== null ? mmss(at) : null)}</span>
                        <span className="tp-title">{st.title}</span>
                        <span className="tp-lead">{st.intro}</span>
                      </Link>
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })}
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </div>
  )
}
