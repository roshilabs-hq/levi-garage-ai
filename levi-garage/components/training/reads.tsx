// כרטיסים של המדריכים הכתובים: בכניסה למרכז ההדרכה ובמאגר של כל מסלול (6.10).

import Link from "next/link"

import type { Guide } from "@/lib/training/read"

export function ReadCards({ reads }: { reads: Guide[] }) {
  return (
    <ul className="rd-cards">
      {reads.map((g) => (
        <li key={g.id}>
          <Link href={`/training/read/${g.id}`} className="tp-card rd-card">
            <span className="tp-kicker">מדריך כתוב · {g.minutes} דקות קריאה</span>
            <span className="tp-title">{g.title}</span>
            <span className="tp-lead">{g.who}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
