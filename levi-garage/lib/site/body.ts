// גוף בקשה ל-API: בודקים את הגודל לפני שמפענחים (ביקורת אבטחה חמישית, 8.10, ממצא 5). שאלה לבוט היא
// כמה מאות תווים, וגם עם היסטוריית שיחה היא לא מגיעה ל-32KB. גוף גדול יותר נדחה בלי לפענח אותו.
//
// הביקורת השישית (ממצא 3): req.text() קורא את כל הגוף לזיכרון לפני שבודקים אותו, גם כשאין כותרת אורך.
// עכשיו קוראים בזרם, ועוצרים ברגע שעוברים את התקרה.
export const MAX_BODY = 32 * 1024

/** קורא את הגוף בזרם עד התקרה. מעבר לה: מפסיק לקרוא ומחזיר null, בלי לקרוא את השאר. */
async function readBytes(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
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
        // משחררים את הקורא ולא ממשיכים לקרוא. בלי cancel: ב-undici ביטול של גוף טופס באמצע מפיל את התהליך
        // ("ReadableStream is already closed"), והשרת סוגר את החיבור בעצמו כשהתשובה יוצאת וגוף לא נקרא עד הסוף.
        reader.releaseLock()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  if (size === 0) return null

  const bytes = new Uint8Array(new ArrayBuffer(size))
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return bytes
}

export async function readJson<T>(req: Request, max = MAX_BODY): Promise<T | null> {
  const bytes = await readBytes(req, max)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

// טופס עם קובץ (תמונה, הקלטה): אותה תקרה, גם כאן בזרם (ביקורת שביעית, ממצא 6). עד היום נתיבי
// ההעלאה בדקו רק את כותרת האורך, ואז req.formData() קרא את כל הגוף. עכשיו הגוף נקרא עם תקרה, והטופס
// מפוענח רק ממה שנקרא. מעל התקרה: null, ולא טופס חלקי.
export async function readForm(req: Request, max: number): Promise<FormData | null> {
  const bytes = await readBytes(req, max)
  if (!bytes) return null
  try {
    const type = req.headers.get("content-type") ?? ""
    return await new Request(req.url, { method: "POST", headers: { "content-type": type }, body: bytes }).formData()
  } catch {
    return null
  }
}
