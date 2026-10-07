import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { ScreenGuide } from "@/components/training/screen"
import { AskNav } from "@/components/training/search"
import { VideoPlayer } from "@/components/training/video"
import { dicts } from "@/lib/site/dict"
import { resolveGuide } from "@/lib/training/resolve"
import { TRACKS, mmss, screensOf, startOf, trackOf, videoOf } from "@/lib/training/tracks"

type Props = { params: Promise<{ track: string; screen: string }> }

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
export default async function ScreenPage({ params }: Props) {
  const { track, screen } = await params
  const f = find(track, screen)
  if (!f) notFound()
  const t = dicts.he
  const video = videoOf(f.tr.video)
  const at = startOf(f.tr, f.screen)
  return (
    <>
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <main id="main" className="wrap training">
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">מרכז ההדרכה</Link> <span aria-hidden="true">›</span> <Link href={`/training/${f.tr.id}`}>{f.tr.title}</Link>{" "}
          <span aria-hidden="true">›</span> <span aria-current="page">{f.screen.title}</span>
        </nav>
        <p className="ts-where">
          {f.role.name} · מסך {f.index} מתוך {f.total}
        </p>
        <h1>{f.screen.title}</h1>
        <p className="training-lead">{f.screen.intro}</p>

        {video && at !== null && (
          <div className="ts-video">
            <h2 className="tp-group">בסרטון</h2>
            <p className="tp-why">
              מתוך &quot;{video.title}&quot;. הסרטון מתחיל כאן במסך הזה ({mmss(at)}), וברשימה שלידו כל שאר הפרקים.
            </p>
            <VideoPlayer video={video} start={at} bare />
          </div>
        )}

        <h2 className="tp-group">כל כפתור במסך</h2>
        <p className="tp-why">לוחצים על מספר בתמונה או ברשימה, ומקבלים הסבר: מה הכפתור עושה, ומה קורה אחרי שלוחצים.</p>
        <ScreenGuide screen={f.screen} />

        <nav className="ts-pager" aria-label="מסכים נוספים">
          {f.prev ? (
            <Link href={`/training/${f.tr.id}/${f.prev.screen.id}`} className="ts-prev">
              <span>המסך הקודם</span>
              <b>→ {f.prev.screen.title}</b>
            </Link>
          ) : (
            <span />
          )}
          {f.next ? (
            <Link href={`/training/${f.tr.id}/${f.next.screen.id}`} className="ts-next">
              <span>המסך הבא</span>
              <b>{f.next.screen.title} ←</b>
            </Link>
          ) : (
            <Link href={`/training/${f.tr.id}`} className="ts-next">
              <span>סיימתם את המסלול</span>
              <b>חזרה לכל ההדרכות ←</b>
            </Link>
          )}
        </nav>
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </>
  )
}
