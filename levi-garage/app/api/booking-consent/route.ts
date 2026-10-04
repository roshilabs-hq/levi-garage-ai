import { NextResponse } from "next/server"

import { allowed, ipKey } from "@/lib/site/rate"

// 3.10: דף "התור נקבע" שואל אם הלקוח סימן עדכונים בוואטסאפ, כדי להציע לו את
// זה שוב אם לא. מקבל את ה-uid ש-Cal.com מסר לדף, ומחזיר רק כן/לא (039,
// booking_consent). ה-uid ארוך ואקראי, ותור ישן מיומיים לא נענה.

export async function GET(req: Request) {
  const uid = new URL(req.url).searchParams.get("uid") ?? ""
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || !/^[A-Za-z0-9]{16,40}$/.test(uid)) return NextResponse.json({ found: false })
  // 047: הדף שואל עד 9 פעמים לכל תור. מעבר לזה, מישהו מנחש.
  if (!(await allowed(ipKey(req, "consent"), 600, 60))) return NextResponse.json({ found: false }, { status: 429 })
  try {
    const res = await fetch(`${url}/rest/v1/rpc/booking_consent`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_uid: uid }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
    if (!res.ok) return NextResponse.json({ found: false })
    const data = (await res.json()) as { found?: boolean; consent?: boolean }
    return NextResponse.json({ found: Boolean(data?.found), consent: Boolean(data?.consent) }, { headers: { "cache-control": "no-store" } })
  } catch {
    return NextResponse.json({ found: false })
  }
}
