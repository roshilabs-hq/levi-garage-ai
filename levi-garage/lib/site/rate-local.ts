// המונה המקומי של הגבלת הקצב, לגיבוי כשהמסד לא סופר (lib/site/rate.ts). קובץ נפרד, בלי
// server-only, כדי שאפשר יהיה לבדוק אותו (03-rollout/solution-4-app/test/rate-local.mjs).
//
// מוגבל בגודל. כשמתמלא, מוחקים רק מונים שהחלון שלהם נגמר. אם עדיין מלא, מפתח חדש נדחה, ומונה קיים
// נשאר כמו שהוא. עד הביקורת השלישית (8.10, ממצא 5) מפה מלאה התאפסה כולה, ומי שכבר נחסם השתחרר.
const MAX_KEYS = 5000
const local = new Map<string, { start: number; hits: number; windowMs: number }>()

export function localAllowed(key: string, windowSeconds: number, max: number): boolean {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  const c = local.get(key)
  if (c && now - c.start <= c.windowMs) {
    c.hits++
    return c.hits <= max
  }
  if (!c && local.size >= MAX_KEYS) {
    for (const [k, v] of local) if (now - v.start > v.windowMs) local.delete(k)
    if (local.size >= MAX_KEYS) return false
  }
  local.set(key, { start: now, hits: 1, windowMs })
  return 1 <= max
}
