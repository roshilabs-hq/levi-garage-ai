import "server-only"

import { generateJson, type Part } from "@/lib/site/gemini"
import { SYSTEM, contextLine, withVerify, type MentorContext } from "./prompt"

export type { MentorContext }

// "המוסכניק הוותיק" בתוך העמדה. אותו מוח כמו ה-Gem של פתרון 1, ועוד שלושה דברים
// שה-Gem לא יכול לדעת (סבב 2.10, ממצאים 2–5):
//   1. איזה רכב על הליפט, ומה הלקוח סיפר — בלי שהמכונאי יקליד את זה.
//   2. מי שואל — כדי שהרשימה האדומה לא תפנה את אלכס לאלכס.
//   3. מה כבר סומן באבחון.
//
// Pro ולא Flash: הרשימה האדומה ו"⚠️ לאמת" על כל מספר הם החוקים שהלקוח דרש, ובסבב
// של 2.10 ה-Gem על Flash-Lite השמיט את "לאמת" ממספרים.

const MODEL = "gemini-2.5-pro"

export type MentorTurn = { role: "user" | "model"; text: string }

export type MentorAnswer = { answer: string; red_list: boolean }

const schema = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    red_list: { type: "BOOLEAN" },
  },
  required: ["answer", "red_list"],
}

/**
 * שאלה אחת, עם עד 6 התורות האחרונות של השיחה (כדי ש"ומה אם זה לא זה?" יובן).
 * תמונה אחת לכל היותר, של השאלה הנוכחית.
 */
export async function askMentor(
  question: string,
  ctx: MentorContext,
  history: MentorTurn[] = [],
  photo: { data: string; mime: string } | null = null,
): Promise<MentorAnswer & { model: string }> {
  const prior = history.slice(-6).map((t) => ({ role: t.role, parts: [{ text: t.text.slice(0, 2000) }] as Part[] }))
  const now: Part[] = [{ text: `${contextLine(ctx)}\n\nהשאלה:\n${question}` }]
  if (photo) now.push({ image: photo })

  const out = await generateJson<MentorAnswer>({
    model: MODEL,
    system: SYSTEM,
    contents: [...prior, { role: "user", parts: now }],
    schema,
    temperature: 0.2,
    timeoutMs: 60_000,
    maxOutputTokens: 4000, // ב-pro גם החשיבה נגרעת מהתקציב הזה
  })
  return { answer: withVerify(String(out.answer ?? "").trim()), red_list: Boolean(out.red_list), model: MODEL }
}
