import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { AskNav } from "@/components/training/search"
import { VideoPlayer } from "@/components/training/video"
import { dicts } from "@/lib/site/dict"
import { TRACKS, videoOf } from "@/lib/training/tracks"
import { VIDEOS } from "@/lib/training/videos"

type Props = { params: Promise<{ id: string }> }

export const generateStaticParams = () => VIDEOS.map((v) => ({ id: v.id }))
export const dynamicParams = false

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = videoOf((await params).id)
  return { title: v ? `${v.title} | מרכז ההדרכה` : "מרכז ההדרכה", description: v?.who }
}

// סרטון אחד, עם אינדקס הפרקים וכתוביות. מגיעים אליו מהכניסה או ממאגר של מסלול.
export default async function VideoPage({ params }: Props) {
  const v = videoOf((await params).id)
  if (!v) notFound()
  const t = dicts.he
  const tr = TRACKS.find((x) => x.video === v.id || x.extra.includes(v.id))
  return (
    <>
      <SiteHeader t={t} overPhoto={false} />
      <main id="main" className="wrap training">
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">מרכז ההדרכה</Link> <span aria-hidden="true">›</span>{" "}
          {tr && (
            <>
              <Link href={`/training/${tr.id}`}>{tr.title}</Link> <span aria-hidden="true">›</span>{" "}
            </>
          )}
          <span aria-current="page">{v.title}</span>
        </nav>
        <h1>{v.title}</h1>
        <p className="training-lead">
          {v.who} · {v.length}
        </p>
        <VideoPlayer video={v} bare />
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </>
  )
}
