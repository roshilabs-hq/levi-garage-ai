// המדריכים הכתובים במרכז ההדרכה (6.10, רועי: "איפה ההדרכה הכתובה, ולא רק הסרטונים?").
// התוכן מ-04-empower/guides, דרך scripts/sync-training.mjs (guides.ts). כאן רק מי קורא מה.

import { Marked } from "marked"

import { GUIDES } from "./guides"
import type { TrackId } from "./tracks"

export type Guide = { id: string; title: string; who: string; minutes: number; tracks: TrackId[] }

export const READS: Guide[] = [
  { id: "mechanic", title: "מדריך למכונאי", who: "העמדה שליד הליפט, מהכניסה בקוד ועד שהליפט פנוי", minutes: 5, tracks: ["workers"] },
  { id: "station-card", title: "כרטיס העמדה", who: "עמוד אחד ליד כל ליפט, בעברית, בערבית וברוסית", minutes: 1, tracks: ["workers"] },
  { id: "daniel", title: "מדריך למנהל העבודה", who: "דניאל: מהדלפק ועד המסירה", minutes: 10, tracks: ["owners"] },
  { id: "avi", title: "מדריך לבעלים", who: "אבי: איפה המספרים, ומתי צריך אותו", minutes: 3, tracks: ["owners"] },
  { id: "screens", title: "המסכים התלויים", who: "מסך הסדנה וחדר ההמתנה: מה רואים, והתקנה", minutes: 2, tracks: ["owners"] },
  { id: "faq", title: "שאלות נפוצות ופתרון תקלות", who: "לכל הצוות, לפי מי נתקל בזה", minutes: 5, tracks: ["owners", "workers"] },
]

/** "דקה אחת", לא "1 דקות" (נמצא בבדיקה עם agent-browser, 6.10). */
export const readTime = (m: number) => (m === 1 ? "דקה אחת" : `${m} דקות`) + " קריאה"

export const readOf = (id: string) => READS.find((g) => g.id === id)
export const readsFor = (track: TrackId) => READS.filter((g) => g.tracks.includes(track))

// בלי הכותרת הראשית (היא בראש הדף), עם id לכל כותרת כדי שקישור כמו faq#כללי יגיע אליה,
// ותמונות שנטענות רק כשמגיעים אליהן. התוכן שלנו, מהריפו, ונבנה מראש בזמן הבנייה.
const md = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      const id = text.replace(/<[^>]+>/g, "").trim().replace(/\s+/g, "-")
      return `<h${depth} id="${id}">${text}</h${depth}>\n`
    },
    image({ href, text }) {
      return `<img src="${href}" alt="${text}" loading="lazy">`
    },
  },
})

export function guideHtml(id: string) {
  const src = GUIDES[id]
  if (!src) return null
  return mdHtml(src)
}

/** Markdown של מדריך (גם מתורגם, 7.10) ל-HTML, בלי הכותרת הראשית. */
export function mdHtml(src: string) {
  return md.parse(src.replace(/^# .*\n+/, "")) as string
}

/** הכותרת הראשית של מדריך ב-Markdown, אם יש. */
export const mdTitle = (src: string) => src.match(/^# (.*)$/m)?.[1] ?? null
