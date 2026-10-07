// התוכן של ההדרכה למכונאים בערבית וברוסית (7.10). רק בשרת: הקובץ i18n.json גדול.
// נקודה שהעברית שלה השתנתה מאז התרגום נשארת בעברית, עד שמריצים שוב את scripts/translate-training.mjs.

import data from "./i18n.json"
import type { ResolvedRole, ResolvedScreen } from "./match"
import type { GLang } from "./i18n-ui"

type ScreenT = { title: string; intro: string; spots: { t: string; b: string }[] }
const src = data.src as unknown as Record<string, ScreenT | string>
const tr = { ar: data.ar, ru: data.ru } as unknown as Record<"ar" | "ru", Record<string, ScreenT | string>>

export const hasScreen = (id: string) => Boolean(src[`screen:${id}`])

export function translateScreen(screen: ResolvedScreen, l: GLang): ResolvedScreen {
  if (l === "he") return screen
  const key = `screen:${screen.id}`
  const he = src[key] as ScreenT | undefined
  const t = tr[l][key] as ScreenT | undefined
  if (!he || !t) return screen
  const fresh = he.title === screen.title && he.intro === screen.intro
  return {
    ...screen,
    title: fresh ? t.title : screen.title,
    intro: fresh ? t.intro : screen.intro,
    spots: screen.spots.map((p) => {
      const i = he.spots.findIndex((s) => s.t === p.t && s.b === p.b)
      return i >= 0 ? { ...p, t: t.spots[i].t, b: t.spots[i].b } : p
    }),
  }
}

export function translateRole(role: ResolvedRole, l: GLang): ResolvedRole {
  if (l === "he") return role
  return { ...role, screens: role.screens.map((s) => translateScreen(s, l)) }
}

/** מדריך מתורגם ("doc:mechanic", "doc:faq-station"), עם קישורי התמונות של האתר. */
export function translatedDoc(key: string, l: GLang): string | null {
  if (l === "he") return null
  const md = tr[l][key]
  if (typeof md !== "string") return null
  return md
    .replace(/\]\(img\/([^)]+)\)/g, "](/training/$1)")
    .replace(/\]\(([a-z-]+)\.md(#[^)]*)?\)/g, (_, f: string, h = "") => `](/training/read/${f}?lang=${l}${h})`)
}

const CH_WORDS: Record<"ar" | "ru", Record<string, string>> = {
  ar: { פתיחה: "افتتاح", סגירה: "ختام", מכונאים: "الميكانيكيون" },
  ru: { פתיחה: "Вступление", סגירה: "Завершение", מכונאים: "Механики" },
}

/** סרטון עם רשימת פרקים בשפה (7.10): "מכונאים · שם המסך" מתורגם לפי המסכים. */
export function translateVideo<V extends { chapters: { t: number; title: string }[] }>(video: V, l: GLang): V {
  if (l === "he") return video
  const screens = Object.entries(src).filter(([k]) => k.startsWith("screen:")) as [string, ScreenT][]
  const screenTitle = (he: string) => {
    const hit = screens.find(([, s]) => s.title === he)
    return hit ? (tr[l][hit[0]] as ScreenT | undefined)?.title ?? he : he
  }
  const word = (w: string) => CH_WORDS[l][w] ?? w
  return {
    ...video,
    chapters: video.chapters.map((c) => {
      const [role, ...rest] = c.title.split(" · ")
      return { ...c, title: rest.length ? `${word(role)} · ${screenTitle(rest.join(" · "))}` : word(role) }
    }),
  }
}
