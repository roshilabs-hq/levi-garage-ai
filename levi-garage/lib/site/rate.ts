import "server-only"

import { createHash } from "node:crypto"

// 047: הגבלת קצב משותפת לכל שרתי Vercel (rate_hit במסד). עד היום כל שרת ספר
// לחוד בזיכרון, והמונה התאפס בכל הפעלה קרה. כאן נספר במסד, לפי כתובת IP
// מגובבת (לא שומרים את הכתובת עצמה), או לפי מזהה הלקוח של הבוט.
//
// אם המסד לא עונה, מאשרים: עדיף שאתר יעבוד משפגיעה קלה בהגנה מפני הצפה.

export function ipKey(req: Request, prefix: string): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  return `${prefix}:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`
}

export async function allowed(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !anon) return true
  try {
    const res = await fetch(`${url}/rest/v1/rpc/rate_hit`, {
      method: "POST",
      headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
      body: JSON.stringify({ p_key: key.slice(0, 120), p_window_seconds: windowSeconds, p_max: max }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (!res.ok) return true
    return (await res.json()) !== false
  } catch {
    return true
  }
}
