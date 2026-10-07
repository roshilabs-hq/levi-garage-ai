import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { LangSwitch } from "@/components/training/lang-switch"
import { ScreenGuide } from "@/components/training/screen"
import { AskNav } from "@/components/training/search"
import { VideoPlayer } from "@/components/training/video"
import { dicts } from "@/lib/site/dict"
import { hasScreen, translateScreen, translateVideo } from "@/lib/training/i18n"
import { UI, dirOf, glang, withLang } from "@/lib/training/i18n-ui"
import { resolveGuide } from "@/lib/training/resolve"
import { TRACKS, mmss, screensOf, startOf, trackOf, videoOf } from "@/lib/training/tracks"

type Props = { params: Promise<{ track: string; screen: string }>; searchParams: Promise<{ lang?: string }> }

export function generateStaticParams() {
  const { roles } = resolveGuide()
  return TRACKS.flatMap((tr) => screensOf(tr, roles).flatMap((r) => r.screens.map((s) => ({ track: tr.id, screen: s.id }))))
}
export const dynamicParams = false

function find(track: string, screen: string) {
  const tr = trackOf(track)
  if (!tr) return null
  const { roles } = resolveGuide()
  const groups = screensOf(tr, roles)
  const all = groups.flatMap((r) => r.screens.map((s) => ({ role: r, screen: s })))
  const i = all.findIndex((x) => x.screen.id === screen)
  if (i < 0) return null
  return { tr, ...all[i], prev: all[i - 1] ?? null, next: all[i + 1] ?? null, index: i + 1, total: all.length }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { track, screen } = await params
  const f = find(track, screen)
  return { title: f ? `${f.screen.title} | ${f.tr.title}` : "מרכז ההדרכה", description: f?.screen.intro }
}

// הדרכה אחת: הסרטון מתחיל בפרק של המסך בהדרכה המלאה, ומתחתיו המדריך עם הנקודות.
// מסכי המכונאים גם בערבית וברוסית (7.10), עם הכתוביות של הסרטון באותה שפה.
export default async function ScreenPage({ params, searchParams }: Props) {
  const { track, screen } = await params
  const f = find(track, screen)
  if (!f) notFound()
  const lang = hasScreen(f.screen.id) ? glang((await searchParams).lang) : "he"
  const ui = UI[lang]
  const t = dicts.he
  const video = videoOf(f.tr.video)
  const at = startOf(f.tr, f.screen) // לפי הכותרת בעברית, כמו שמות הפרקים
  const sc = translateScreen(f.screen, lang)
  const title = (s: typeof f.screen) => translateScreen(s, lang).title
  const base = `/training/${f.tr.id}`
  return (
    <div className="tr-page">
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <main id="main" className="wrap training" lang={lang} dir={dirOf(lang)}>
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">{ui.home}</Link> <span aria-hidden="true">›</span>{" "}
          <Link href={withLang(base, lang)}>{lang === "he" ? f.tr.title : ui.trackTitle}</Link> <span aria-hidden="true">›</span>{" "}
          <span aria-current="page">{sc.title}</span>
        </nav>
        <p className="ts-where">{ui.where(lang === "he" ? f.role.name : ui.mechanics, f.index, f.total)}</p>
        <h1>{sc.title}</h1>
        {hasScreen(f.screen.id) && <LangSwitch href={`${base}/${f.screen.id}`} lang={lang} />}
        <p className="training-lead">{sc.intro}</p>

        {video && at !== null && (
          <div className="ts-video">
            <h2 className="tp-group">{ui.inVideo}</h2>
            <p className="tp-why">{ui.videoFrom(ui.videosT[video.id]?.title ?? video.title, mmss(at))}</p>
            <VideoPlayer video={translateVideo(video, lang)} start={at} bare sub={lang === "he" ? "" : lang} />
          </div>
        )}

        <h2 className="tp-group">{ui.allSpots}</h2>
        <p className="tp-why">{ui.allSpotsWhy}</p>
        <ScreenGuide screen={sc} lang={lang} />

        <nav className="ts-pager" aria-label="מסכים נוספים">
          {f.prev ? (
            <Link href={withLang(`${base}/${f.prev.screen.id}`, lang)} className="ts-prev">
              <span>{ui.prevScreen}</span>
              <b>{lang === "ru" ? `← ${title(f.prev.screen)}` : `→ ${title(f.prev.screen)}`}</b>
            </Link>
          ) : (
            <span />
          )}
          {f.next ? (
            <Link href={withLang(`${base}/${f.next.screen.id}`, lang)} className="ts-next">
              <span>{ui.nextScreen}</span>
              <b>{lang === "ru" ? `${title(f.next.screen)} →` : `${title(f.next.screen)} ←`}</b>
            </Link>
          ) : (
            <Link href={withLang(base, lang)} className="ts-next">
              <span>{ui.done}</span>
              <b>{lang === "ru" ? `${ui.backAll} →` : `${ui.backAll} ←`}</b>
            </Link>
          )}
        </nav>
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </div>
  )
}
