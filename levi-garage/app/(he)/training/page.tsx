import type { Metadata } from "next"
import Link from "next/link"

import "./training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { OldHash } from "@/components/training/old-hash"
import { ReadCards } from "@/components/training/reads"
import { AskNav, TrainingSearch } from "@/components/training/search"
import { dicts } from "@/lib/site/dict"
import { READS, readsFor } from "@/lib/training/read"
import { resolveGuide } from "@/lib/training/resolve"
import { GENERAL, TRACKS, screensOf, videoOf } from "@/lib/training/tracks"

export const metadata: Metadata = {
  title: "מרכז ההדרכה | מוסך לוי ובניו",
  description: "כל מסך במערכת של המוסך, וכל כפתור בו, בשני מסלולים: לבעלים ולמנהל העבודה, ולעובדים.",
}

// מרכז ההדרכה (רועי, 6.10): בכניסה שתי קוביות גדולות. מימין המדריך לבעלים ולמנהל העבודה,
// משמאל המדריך לעובדים. כל קובייה פותחת מאגר הדרכות, ובכל הדרכה הסרטון והמדריך של המסך.
export default function TrainingPage() {
  const t = dicts.he
  const { roles } = resolveGuide()
  return (
    <>
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <OldHash />
      <main id="main" className="wrap training">
        <h1>מרכז ההדרכה</h1>
        <p className="training-lead">כל מסך במערכת, וכל פעולה בו: מה היא עושה, ומה קורה אחרי שלוחצים. בוחרים את המדריך שלכם.</p>

        <div className="th-tiles">
          {TRACKS.map((tr) => {
            const groups = screensOf(tr, roles)
            const screens = groups.reduce((a, r) => a + r.screens.length, 0)
            const spots = groups.reduce((a, r) => a + r.screens.reduce((b, s) => b + s.spots.length, 0), 0)
            const videos = [tr.video, ...tr.extra].length
            const reads = readsFor(tr.id).length
            return (
              <Link key={tr.id} href={`/training/${tr.id}`} className={`th-tile th-${tr.id}`}>
                <span className="th-who">{tr.who}</span>
                <span className="th-title">{tr.title}</span>
                <span className="th-lead">{tr.lead}</span>
                <span className="th-count">
                  {reads} מדריכים כתובים · {videos === 1 ? "סרטון" : `${videos} סרטונים`} · {screens} מסכים · {spots} כפתורים
                </span>
                <span className="th-go" aria-hidden="true">
                  להדרכות ←
                </span>
              </Link>
            )
          })}
        </div>

        {/* לפי קהל (רועי, 6.10): קודם המדריכים הכתובים ("איפה ההדרכה הכתובה?"), אחריהם הסרטונים לכל
            הצוות, ואז החיפוש. הסרטון לבוחנים בפס נפרד בסוף, עם ההנחיות הכתובות. */}
        <h2 className="th-more">המדריכים הכתובים</h2>
        <ReadCards reads={READS} />

        <h2 className="th-more">סרטונים לכל הצוות</h2>
        <div className="th-videos">
          {GENERAL.map((id) => {
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

        <Link href="/training/exam" className="th-exam">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={videoOf("exam")?.poster} alt="" loading="lazy" />
          <span className="th-exam-text">
            <span className="tp-kicker">לבוחני פרויקט הגמר</span>
            <span className="tp-title">איך בוחנים את המוסך בעצמכם</span>
            <span className="tp-lead">סרטון של {videoOf("exam")?.length}, ותרחיש של 15 דקות בכתב, צעד אחרי צעד, עם מה שאמור לקרות בכל צעד.</span>
          </span>
          <span className="th-go" aria-hidden="true">
            להנחיות ←
          </span>
        </Link>
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </>
  )
}
