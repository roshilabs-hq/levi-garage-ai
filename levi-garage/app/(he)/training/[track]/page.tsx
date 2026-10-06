import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { AskNav, TrainingSearch } from "@/components/training/search"
import { dicts } from "@/lib/site/dict"
import { resolveGuide } from "@/lib/training/resolve"
import { TRACKS, mmss, screensOf, startOf, trackOf, videoOf } from "@/lib/training/tracks"

type Props = { params: Promise<{ track: string }> }

export const generateStaticParams = () => TRACKS.map((t) => ({ track: t.id }))
export const dynamicParams = false

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tr = trackOf((await params).track)
  return { title: tr ? `${tr.title} | מרכז ההדרכה` : "מרכז ההדרכה" }
}

// מאגר ההדרכות של מסלול: הסרטונים שלו, וכרטיס לכל מסך, מקובצים לפי תפקיד.
export default async function TrackPage({ params }: Props) {
  const tr = trackOf((await params).track)
  if (!tr) notFound()
  const t = dicts.he
  const { roles } = resolveGuide()
  const groups = screensOf(tr, roles)
  let n = 0
  return (
    <>
      <SiteHeader t={t} overPhoto={false} />
      <main id="main" className="wrap training">
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">מרכז ההדרכה</Link> <span aria-hidden="true">›</span> <span aria-current="page">{tr.title}</span>
        </nav>
        <h1>{tr.title}</h1>
        <p className="training-lead">
          {tr.who}. {tr.lead}
        </p>

        <h2 className="tp-group">סרטונים</h2>
        <div className="th-videos">
          {[tr.video, ...tr.extra].map((id) => {
            const v = videoOf(id)
            if (!v) return null
            return (
              <Link key={id} href={`/training/video/${id}`} className="tp-card tp-video">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.poster} alt="" loading="lazy" />
                <span className="tp-kicker">סרטון · {v.length}</span>
                <span className="tp-title">{v.title}</span>
                <span className="tp-lead">{v.who}</span>
              </Link>
            )
          })}
        </div>

        <TrainingSearch roles={roles} />

        {groups.map((r) => (
          <section key={r.id} aria-labelledby={`g-${r.id}`}>
            <h2 className="tp-group" id={`g-${r.id}`}>
              {r.name}
            </h2>
            <p className="tp-why">{r.why}</p>
            <ol className="tp-grid">
              {r.screens.map((s) => {
                n++
                const at = startOf(tr, s)
                return (
                  <li key={s.id}>
                    <Link href={`/training/${tr.id}/${s.id}`} className="tp-card">
                      <span className="tp-shot">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/training/${s.id}.png`} alt="" loading="lazy" />
                      </span>
                      <span className="tp-kicker">
                        <span className="num">{n}</span> · {s.spots.length} כפתורים{at !== null ? ` · בסרטון מ-${mmss(at)}` : ""}
                      </span>
                      <span className="tp-title">{s.title}</span>
                      <span className="tp-lead">{s.intro}</span>
                    </Link>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </>
  )
}
