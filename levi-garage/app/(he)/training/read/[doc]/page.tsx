import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { AskNav } from "@/components/training/search"
import { dicts } from "@/lib/site/dict"
import { READS, guideHtml, readOf, readTime } from "@/lib/training/read"
import { trackOf } from "@/lib/training/tracks"

type Props = { params: Promise<{ doc: string }> }

export const generateStaticParams = () => READS.map((g) => ({ doc: g.id }))
export const dynamicParams = false

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = readOf((await params).doc)
  return { title: g ? `${g.title} | מרכז ההדרכה` : "מרכז ההדרכה", description: g?.who }
}

// מדריך כתוב אחד, לקריאה רציפה מההתחלה ועד הסוף (המדריכים מ-04-empower/guides).
export default async function ReadPage({ params }: Props) {
  const g = readOf((await params).doc)
  const html = g && guideHtml(g.id)
  if (!g || !html) notFound()
  const t = dicts.he
  const tr = g.tracks.length === 1 ? trackOf(g.tracks[0]) : undefined
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
          <span aria-current="page">{g.title}</span>
        </nav>
        <h1>{g.title}</h1>
        <p className="training-lead">
          {g.who} · {readTime(g.minutes)}
        </p>
        <article className="rd" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </>
  )
}
