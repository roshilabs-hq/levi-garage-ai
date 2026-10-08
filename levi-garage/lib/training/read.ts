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
  // לבוחני הפרויקט, לא לצוות: בלי מסלול, ולכן לא מופיע בכרטיסי המסלולים. מקושר מדף הבוחנים (7.10)
  { id: "examiner", title: "המדריך המלא לבוחנים", who: "כל התרחישים, עם הסבר מלא לכל צעד", minutes: 8, tracks: [] },
]

/** "דקה אחת", לא "1 דקות" (נמצא בבדיקה עם agent-browser, 6.10). */
export const readTime = (m: number) => (m === 1 ? "דקה אחת" : `${m} דקות`) + " קריאה"

export const readOf = (id: string) => READS.find((g) => g.id === id)
export const readsFor = (track: TrackId) => READS.filter((g) => g.tracks.includes(track))

// בלי הכותרת הראשית (היא בראש הדף), עם id לכל כותרת כדי שקישור כמו faq#כללי יגיע אליה,
// ותמונות שנטענות רק כשמגיעים אליהן. התוכן שלנו, מהריפו, ונבנה מראש בזמן הבנייה.
//
// ניקוי (ביקורות האבטחה, 7.10-8.10: "Markdown בלי ניקוי"): גם אם יום אחד ייכנס למדריך תוכן
// ממקור אחר, או תרגום מהמודל, הוא לא מגיע לדף כקוד. HTML גולמי מוצג כטקסט, כל ערך בתכונה עובר
// escape, וכתובת של קישור או תמונה מותרת רק אם היא יחסית, #, https, mailto או tel.
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const SAFE_URL = /^(https:\/\/|mailto:|tel:|#|\/(?!\/)|\.{1,2}\/|[^:/?#]+(?:[/?#]|$))/i
const safeUrl = (href: string) => (SAFE_URL.test(href.trim()) ? esc(href.trim()) : "#")
// כמו marked עצמו: עברית בכתובת מקודדת (faq#%D7%9B...), בלי לקודד פעמיים את מה שכבר מקודד.
const linkUrl = (href: string) => safeUrl(encodeURI(href).replace(/%25/g, "%"))

const md = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      const id = text.replace(/<[^>]+>/g, "").trim().replace(/\s+/g, "-")
      // הטקסט כבר מקודד (marked), ולכן גם ה-id. בלי תגיות ובלי מרכאות גולמיות.
      return `<h${depth} id="${id}">${text}</h${depth}>
`
    },
    image({ href, text }) {
      return `<img src="${safeUrl(href)}" alt="${esc(text)}" loading="lazy">`
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      return `<a href="${linkUrl(href)}"${title ? ` title="${esc(title)}"` : ""}>${text}</a>`
    },
    html({ text }) {
      return esc(text)
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
