import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import "../../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { LangSwitch } from "@/components/training/lang-switch"
import { AskNav } from "@/components/training/search"
import { dicts } from "@/lib/site/dict"
import { translatedDoc } from "@/lib/training/i18n"
import { UI, dirOf, glang, withLang } from "@/lib/training/i18n-ui"
import { READS, guideHtml, mdHtml, readOf, readTime } from "@/lib/training/read"
import { trackOf } from "@/lib/training/tracks"

type Props = { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> }

export const generateStaticParams = () => READS.map((g) => ({ doc: g.id }))
export const dynamicParams = false

// המדריכים שיש להם תרגום לערבית ולרוסית (7.10). בשאלות הנפוצות: רק הסעיף של העמדה.
const TRANSLATED: Record<string, string> = { mechanic: "doc:mechanic", faq: "doc:faq-station" }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = readOf((await params).doc)
  return { title: g ? `${g.title} | מרכז ההדרכה` : "מרכז ההדרכה", description: g?.who }
}

// מדריך כתוב אחד, לקריאה רציפה מההתחלה ועד הסוף (המדריכים מ-04-empower/guides).
export default async function ReadPage({ params, searchParams }: Props) {
  const g = readOf((await params).doc)
  if (!g) notFound()
  const key = TRANSLATED[g.id]
  const lang = key ? glang((await searchParams).lang) : "he"
  const ui = UI[lang]
  const tmd = key ? translatedDoc(key, lang) : null
  const html = tmd ? mdHtml(tmd) : guideHtml(g.id)
  if (!html) notFound()
  const t = dicts.he
  const tr = g.tracks.length === 1 ? trackOf(g.tracks[0]) : g.tracks.includes("workers") && lang !== "he" ? trackOf("workers") : undefined
  const title = ui.reads[g.id]?.title ?? g.title
  return (
    <div className="tr-page">
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <main id="main" className="wrap training" lang={lang} dir={dirOf(lang)}>
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">{ui.home}</Link> <span aria-hidden="true">›</span>{" "}
          {tr && (
            <>
              <Link href={withLang(`/training/${tr.id}`, tr.id === "workers" ? lang : "he")}>{lang === "he" ? tr.title : ui.trackTitle}</Link>{" "}
              <span aria-hidden="true">›</span>{" "}
            </>
          )}
          <span aria-current="page">{title}</span>
        </nav>
        <h1>{title}</h1>
        {key && <LangSwitch href={`/training/read/${g.id}`} lang={lang} />}
        <p className="training-lead">{lang === "he" ? `${g.who} · ${readTime(g.minutes)}` : `${ui.reads[g.id]?.who ?? g.who} · ${ui.readKicker(g.minutes)}`}</p>
        {lang !== "he" && g.id === "faq" && <p className="tp-why">{ui.faqRest}</p>}
        <article className="rd" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </div>
  )
}
