// המונה המקומי של הגבלת הקצב, לגיבוי כשהמסד לא סופר (lib/site/rate.ts). קובץ נפרד, בלי
// server-only, כדי שאפשר יהיה לבדוק אותו (03-rollout/solution-4-app/test/rate-local.mjs).
// מוגבל בגודל: כשמתמלא, מנקים חלונות שנגמרו, ואם עדיין מלא, מתחילים מחדש.
const local = new Map<string, { start: number; hits: number }>()
export function localAllowed(key: string, windowSeconds: number, max: number): boolean {
  const now = Date.now()
  if (local.size > 5000) {
    for (const [k, v] of local) if (now - v.start > 86_400_000) local.delete(k)
    if (local.size > 5000) local.clear()
  }
  const c = local.get(key)
  if (!c || now - c.start > windowSeconds * 1000) {
    local.set(key, { start: now, hits: 1 })
    return 1 <= max
  }
  c.hits++
  return c.hits <= max
}
