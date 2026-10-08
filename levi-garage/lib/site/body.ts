// גוף בקשה ל-API: בודקים את הגודל לפני שמפענחים (ביקורת אבטחה חמישית, 8.10, ממצא 5). שאלה לבוט היא
// כמה מאות תווים, וגם עם היסטוריית שיחה היא לא מגיעה ל-32KB. גוף גדול יותר נדחה בלי לפענח אותו.
//
// הביקורת השישית (ממצא 3): req.text() קורא את כל הגוף לזיכרון לפני שבודקים אותו, גם כשאין כותרת אורך.
// עכשיו קוראים בזרם, ועוצרים ברגע שעוברים את התקרה.
export const MAX_BODY = 32 * 1024

export async function readJson<T>(req: Request, max = MAX_BODY): Promise<T | null> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > max) return null
  if (!req.body) return null

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  if (size === 0) return null

  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}
