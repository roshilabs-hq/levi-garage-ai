import { createHmac } from "node:crypto"

import { NextResponse } from "next/server"

// הניקוי החודשי (vercel.json, 061): מוחק נתונים טכניים בלבד (רישומי כניסה בעמדה, מוני קצב, בקשות
// חיבור וקודי צימוד שפגו), וסופר את נתוני הלקוחות שהגיע הזמן למחוק ידנית. הדוח נרשם ביומן האבטחה,
// ואבי רואה אותו. Vercel שולח את CRON_SECRET בכותרת; בלעדיו, או בלי המשתנה, הדלת סגורה.
export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET
  if (!cron || req.headers.get("authorization") !== `Bearer ${cron}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const station = process.env.STATION_SECRET
  if (!url || !anon || !station || station.length < 32) return NextResponse.json({ error: "not configured" }, { status: 503 })

  // סוד משלו, נגזר מ-STATION_SECRET בתווית אחרת (כמו הגבלת הקצב, 052). במסד רק הגיבוב.
  const secret = createHmac("sha256", station).update("housekeeping-v1").digest("base64url")
  const res = await fetch(`${url}/rest/v1/rpc/housekeeping`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ p_secret: secret }),
    cache: "no-store",
  })
  if (!res.ok) {
    console.error("housekeeping failed:", res.status)
    return NextResponse.json({ error: "failed" }, { status: 502 })
  }
  const report = await res.json()
  // רק מספרים, בלי פרטים אישיים
  console.log("housekeeping:", JSON.stringify(report))
  return NextResponse.json(report)
}
