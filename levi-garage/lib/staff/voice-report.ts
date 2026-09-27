import "server-only"

import { generateJson } from "@/lib/site/gemini"

// הודעה קולית של מכונאי (לרוב בערבית מדוברת מעורבבת בעברית, או ברוסית),
// עם התמונה שצילם, הופכת לטיוטת ממצא. המודל הוא gemini-2.5-pro, לפי ה-POC:
// pro נאמן, flash הוסיף משפט שלא נאמר.
//
// מה המודל לא עושה כאן, במכוון:
//   1. לא נוגע במחיר. עד 27.9 הוא חילץ מחירים מהקול. אבל בכל המערכות בעולם
//      הטכנאי לא מתמחר: דניאל בוחר עבודה מהמחירון, והמחיר, השעות והאחריות
//      מגיעים משם (ס' 131–132 לחוק). מכונאי שאומר מחיר הופך ל"איש מכירות",
//      וזו סיבת התנגדות מתועדת.
//   2. לא מזהה את הרכב מהקול. הרכב מגיע מהכרטיס, ונמסר כהקשר בלבד.
//   3. לא שולח כלום. הפלט הוא טיוטה שממתינה לאדם.

const MODEL = "gemini-2.5-pro"

const system = `You receive a short voice note from a mechanic in a family car garage in Israel, sometimes with a photo he took.
He speaks colloquial Levantine Arabic, Russian or Hebrew, often mixed, often in a noisy workshop.

Turn what he said into a draft finding. Nothing more.

Rules:
- transcript: what was said, as literally as you can, in the language it was said.
- title: 2 to 6 Hebrew words naming what was found, for a list (e.g. "רפידות בלם קדמיות שחוקות").
- summary: one or two Hebrew sentences for the garage staff, including anything he said about how urgent it is.
- customer_text: Hebrew, warm and plain, 2 to 3 sentences, for the car owner: what was found and why it matters.
  No prices, no time estimates, no lists, no markdown, no emojis. Address the owner with gender-neutral wording.
- urgency: "red" if he says it is dangerous, must be fixed now, or the car should not be driven; otherwise "yellow".
- safety: true if it concerns brakes, steering, tires, suspension holding the wheel, lights, or airbags. Otherwise false.
- red_list: true if he describes cutting a wire, disconnecting the car's computer, airbags, high voltage systems,
  or brakes he is unsure about. Those must stop and reach Avi or Alex.
- Never invent or repeat prices, even if he said one. Prices come from the garage price list, not from the mechanic.
- Do not diagnose beyond what he said, and do not add safety claims he did not make.
- If the audio is unclear, say so in summary, and keep title and customer_text minimal.
- Keep garage words as spoken: ברקסים, רפידות, משאבת מים, סורק, ליפט, P0301.`

const schema = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    title: { type: "STRING" },
    summary: { type: "STRING" },
    customer_text: { type: "STRING" },
    urgency: { type: "STRING", enum: ["red", "yellow"] },
    safety: { type: "BOOLEAN" },
    red_list: { type: "BOOLEAN" },
  },
  required: ["transcript", "title", "summary", "customer_text", "urgency", "safety", "red_list"],
}

export type VoiceReport = {
  transcript: string
  title: string
  summary: string
  customer_text: string
  urgency: "red" | "yellow"
  safety: boolean
  red_list: boolean
  model: string
}

export type ReportContext = {
  plate: string
  make?: string | null
  model?: string | null
  year?: number | null
  engine?: string | null
  /** מבדיקת הכניסה: על איזה פריט מדובר, ואיזה צבע סומן */
  item?: { label: string; light: "yellow" | "red"; safety: boolean } | null
}

export async function reportFromVoice(
  audio: { data: string; mime: string } | null,
  photo: { data: string; mime: string } | null,
  ctx: ReportContext,
): Promise<VoiceReport> {
  const context = [
    `The car is: ${[ctx.make, ctx.model].filter(Boolean).join(" ") || "unknown"}`,
    ctx.year ? `year ${ctx.year}` : "",
    ctx.engine ? `engine code ${ctx.engine}` : "",
    "Use this car, even if the mechanic names a different one or names none.",
    ctx.item
      ? `This is from the intake inspection. Item: "${ctx.item.label}". The inspector marked it ${ctx.item.light === "red" ? "RED (must fix)" : "YELLOW (needs attention soon)"}. Use that urgency unless he clearly says otherwise.${ctx.item.safety ? " This item is a safety item." : ""}`
      : "",
    audio ? "" : "There is no voice note, only a photo. Describe only what is clearly visible, and say in summary that nothing was said.",
  ]
    .filter(Boolean)
    .join(". ")

  const parts: ({ text: string } | { audio: { data: string; mime: string } } | { image: { data: string; mime: string } })[] = [
    { text: context },
  ]
  if (audio) parts.push({ audio })
  if (photo) parts.push({ image: photo })

  const out = await generateJson<Omit<VoiceReport, "model">>({
    model: MODEL,
    system,
    contents: [{ role: "user", parts }],
    schema,
    temperature: 0.1,
    timeoutMs: 60_000,
    maxOutputTokens: 4000, // ב-pro גם החשיבה נגרעת מהתקציב הזה
  })

  return {
    ...out,
    urgency: ctx.item?.light === "red" ? "red" : out.urgency === "red" ? "red" : "yellow",
    safety: Boolean(out.safety || ctx.item?.safety),
    model: MODEL,
  }
}
