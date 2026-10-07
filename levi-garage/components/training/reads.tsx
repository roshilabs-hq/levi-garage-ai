// כרטיסים של המדריכים הכתובים: בכניסה למרכז ההדרכה ובמאגר של כל מסלול (6.10).
// בערבית וברוסית (7.10): הכותרת מתורגמת, והקישור פותח את המדריך באותה שפה.

import Link from "next/link"

import { UI, withLang, type GLang } from "@/lib/training/i18n-ui"
import { type Guide, readTime } from "@/lib/training/read"

export function ReadCards({ reads, lang = "he" }: { reads: Guide[]; lang?: GLang }) {
  const ui = UI[lang]
  return (
    <ul className="rd-cards">
      {reads.map((g) => {
        const tr = ui.reads[g.id]
        return (
          <li key={g.id}>
            <Link href={withLang(`/training/read/${g.id}`, lang)} className="tp-card rd-card">
              <span className="tp-kicker">{lang === "he" ? `מדריך כתוב · ${readTime(g.minutes)}` : ui.readKicker(g.minutes)}</span>
              <span className="tp-title">{tr?.title ?? g.title}</span>
              <span className="tp-lead">{tr?.who ?? g.who}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
