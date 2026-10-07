import type { Metadata } from "next"
import Link from "next/link"

import "../training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { ExamSteps } from "@/components/training/exam-steps"
import { AskNav } from "@/components/training/search"
import { VideoPlayer } from "@/components/training/video"
import { dicts } from "@/lib/site/dict"
import { videoOf } from "@/lib/training/tracks"

export const metadata: Metadata = {
  title: "לבוחני הפרויקט | מרכז ההדרכה",
  description: "איך בוחנים את המוסך בעצמכם: סרטון, ותרחיש של 15 דקות צעד אחרי צעד.",
  robots: { index: false },
}

const REPO = "https://github.com/roshilabs-hq/levi-garage-ai"

// דף לבוחני פרויקט הגמר (רועי, 6.10: "הנחיות מצידנו, לא רק הסרטון"). הסרטון, ומתחתיו ההנחיות
// הכתובות. הוא מחוץ לשני המסלולים, כי הוא לא הדרכה לעובדי המוסך.
export default function ExamPage() {
  const t = dicts.he
  const v = videoOf("exam")
  return (
    <div className="tr-page">
      <SiteHeader t={t} overPhoto={false} langs={false} />
      <main id="main" className="wrap training">
        <nav className="tc-crumbs" aria-label="מיקום">
          <Link href="/training">מרכז ההדרכה</Link> <span aria-hidden="true">›</span> <span aria-current="page">לבוחני הפרויקט</span>
        </nav>
        <h1>לבוחני הפרויקט</h1>
        <p className="training-lead">
          קודם הסרטון ({v?.length}): מה יש במסמך ההגשה, ואיך בוחנים. מתחתיו אותן הנחיות בכתב, לעבוד איתן ליד המחשב.
        </p>
        {v && <VideoPlayer video={v} bare />}
        <ExamSteps />
        <p className="ex-full">
          כל התרחישים, עם הסבר מלא לכל צעד: <a href={`${REPO}/blob/main/04-empower/examiner-guide.md`}>המדריך המלא לבוחנים</a>.
        </p>
      </main>
      <AskNav />
      <SiteFooter t={t} />
    </div>
  )
}
