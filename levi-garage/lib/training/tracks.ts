// מרכז ההדרכה בשני מסלולים (רועי, 6.10): בכניסה שתי קוביות גדולות, מדריך לבעלים ולמנהל
// העבודה, ומדריך לעובדים. כל מסלול הוא מאגר של הדרכות, אחת לכל מסך, ובכל אחת הסרטון
// מתחיל בפרק של המסך, ומתחתיו המדריך עם הנקודות.

import type { ResolvedRole, ResolvedScreen } from "./match"
import { VIDEOS } from "./videos"

export type TrackId = "owners" | "workers"
export type Track = {
  id: TrackId
  title: string
  who: string
  lead: string
  /** התפקידים במדריך (guide.ts) שהמסלול מכסה, לפי הסדר. */
  roles: string[]
  /** ההדרכה המלאה של המסלול: בכל מסך היא מתחילה בפרק שלו. */
  video: string
  /** סרטונים נוספים במאגר של המסלול. */
  extra: string[]
}

export const TRACKS: Track[] = [
  {
    id: "owners",
    title: "מדריך לבעלים ולמנהל העבודה",
    who: "אבי ודניאל",
    lead: "הלוח, קבלת רכב, התמחור, כרטיס העבודה, מפת המוסך, העמדות והמדדים. וגם מה רואים הלקוח והמסכים התלויים.",
    roles: ["office", "owner", "screens", "customer"],
    video: "full-2",
    extra: ["avi"],
  },
  {
    id: "workers",
    title: "מדריך לעובדים",
    who: "המכונאים",
    lead: "העמדה ליד הליפט: כניסה בקוד, משיכת רכב, אבחון ברמזור, דיווח ממצא, וסיום.",
    roles: ["mechanic"],
    video: "full-1",
    extra: [],
  },
]

/** סרטונים לכולם, ולבוחני הפרויקט: שורה קטנה מתחת לקוביות. */
export const GENERAL = ["day", "flow"]
export const EXAM = ["exam"]

export const trackOf = (id: string) => TRACKS.find((t) => t.id === id)
export const trackOfRole = (role: string): TrackId => TRACKS.find((t) => t.roles.includes(role))?.id ?? "owners"
export const videoOf = (id: string) => VIDEOS.find((v) => v.id === id)

/** המסכים של מסלול, מקובצים לפי תפקיד, כמו במדריך. */
export function screensOf(track: Track, roles: ResolvedRole[]) {
  return track.roles.map((id) => roles.find((r) => r.id === id)).filter((r): r is ResolvedRole => Boolean(r))
}

/**
 * מתי המסך מתחיל בהדרכה המלאה של המסלול. הפרקים שם נקראים "תפקיד · שם המסך"
 * (00-planning/videos/full), ולכן אין צורך בטבלה נפרדת.
 */
export function startOf(track: Track, screen: ResolvedScreen): number | null {
  const v = videoOf(track.video)
  const c = v?.chapters.find((ch) => ch.title.endsWith(` · ${screen.title}`))
  return c ? c.t : null
}

export const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
