// גוף בקשה ל-API: בודקים את הגודל לפני שמפענחים (ביקורת אבטחה חמישית, 8.10, ממצא 5). שאלה לבוט היא
// כמה מאות תווים, וגם עם היסטוריית שיחה היא לא מגיעה ל-32KB. גוף גדול יותר נדחה בלי לפענח אותו.
export const MAX_BODY = 32 * 1024

export async function readJson<T>(req: Request, max = MAX_BODY): Promise<T | null> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > max) return null
  const text = await req.text().catch(() => "")
  if (!text || text.length > max) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
