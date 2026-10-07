import type { Metadata } from "next"
import Link from "next/link"

import "./training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { OldHash } from "@/components/training/old-hash"
import { AskNav, TrainingSearch } from "@/components/training/search"
import { dicts } from "@/lib/site/dict"
import { readOf, readTime, readsFor } from "@/lib/training/read"
import { resolveGuide } from "@/lib/training/resolve"
import { GENERAL, TRACKS, screensOf, videoOf } from "@/lib/training/tracks"

export const metadata: Metadata = {
  title: "מרכז ההדרכה | מוסך לוי ובניו",
  description: "כל מסך במערכת של המוסך, וכל כפתור בו, בשני מסלולים: לבעלים ולמנהל העבודה, ולעובדים.",
}

// מרכז ההדרכה (רועי, 6.10; סודר מחדש 7.10): חיפוש, שני מסלולים באותו משקל (מימין לבעלים ולמנהל
// העבודה, משמאל לעובדים), שורה אחת לכל הצוות, והפס לבוחנים. כל מדריך מופיע פעם אחת.
export default function TrainingPage() {
  const t = dicts.he
  const { roles } = resolveGuide()
  const faq = readOf("faq")
  // עטיפה אחת לכל הדף (7.10): במעבר בין דפים Next גולל אל האלמנט הראשון של הדף החדש. בלי העטיפה
  // הוא תפס את הכותרת התחתונה, והדף נפתח למטה. כך גם בכל דפי מרכז ההדרכה.
  return (
    <div className="tr-page">
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <OldHash />
      <main id="main" className="wrap training">
        <h1>מרכז ההדרכה</h1>
        <p className="training-lead">כל מסך במערכת, וכל פעולה בו: מה היא עושה, ומה קורה אחרי שלוחצים. בוחרים את המדריך שלכם.</p>

        {/* קודם החיפוש: הדרך הכי מהירה למצוא כפתור (רועי, 7.10: "מרגיש מבולגן") */}
        <TrainingSearch roles={roles} />

        {/* לפי קהל (רועי, 6.10 ו-7.10): שני מסלולים באותו משקל. בכל אחד המדריכים הכתובים שלו,
            כקישורים ישירים, וכפתור למאגר ההדרכות. מה שמשותף לכולם בשורה אחת מתחת. */}
        <h2 className="th-more">מי אתם?</h2>
        <div className="th-tiles">
          {TRACKS.map((tr) => {
            const groups = screensOf(tr, roles)
            const screens = groups.reduce((a, r) => a + r.screens.length, 0)
            const spots = groups.reduce((a, r) => a + r.screens.reduce((b, s) => b + s.spots.length, 0), 0)
            const own = readsFor(tr.id).filter((g) => g.tracks.length === 1)
            return (
              <article key={tr.id} className={`th-tile th-${tr.id}`}>
                <span className="th-who">{tr.who}</span>
                <h3 className="th-title">
                  <Link href={`/training/${tr.id}`}>{tr.title}</Link>
                </h3>
                <p className="th-lead">{tr.lead}</p>
                {tr.id === "workers" && (
                  <p className="th-langs">
                    <span>גם בשפה שלך:</span>
                    <Link href="/training/workers?lang=ar" lang="ar" dir="rtl">العربية</Link>
                    <Link href="/training/workers?lang=ru" lang="ru" dir="ltr">Русский</Link>
                  </p>
                )}
                <ul className="th-reads">
                  {own.map((g) => (
                    <li key={g.id}>
                      <Link href={`/training/read/${g.id}`}>{g.title}</Link>
                      <span>{readTime(g.minutes)}</span>
                    </li>
                  ))}
                </ul>
                <span className="th-count">
                  {screens} מסכים · {spots} כפתורים, כל אחד עם צילום והסבר
                </span>
                <Link href={`/training/${tr.id}`} className="th-go">
                  כל ההדרכות <span aria-hidden="true">←</span>
                </Link>
              </article>
            )
          })}
        </div>

        <h2 className="th-more">לכל הצוות</h2>
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
          {faq && (
            <Link href="/training/read/faq" className="tp-card th-faq">
              <span className="th-faq-mark" aria-hidden="true">
                <span>הקוד ננעל?</span>
                <span>ההודעה לא יצאה?</span>
                <span>המערכת לא עולה?</span>
              </span>
              <span className="tp-kicker">מדריך כתוב · {readTime(faq.minutes)}</span>
              <span className="tp-title">{faq.title}</span>
              <span className="tp-lead">{faq.who}. כל תקלה, ומה עושים בה.</span>
            </Link>
          )}
        </div>

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
    </div>
  )
}
