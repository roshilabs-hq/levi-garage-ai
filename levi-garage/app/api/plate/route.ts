import { NextResponse } from "next/server"

import { lookupPlate } from "@/lib/site/plate"
import { allowed, ipKey } from "@/lib/site/rate"

// בדיקת רכב לפי מספר רישוי. הלוגיקה ב-lib/site/plate.ts, כדי שגם הקבלה בדלפק תשתמש בה.
export const maxDuration = 45

export async function GET(req: Request) {
  // 047: בדיקה פתוחה לכולם, וכל פספוס הוא עד שלוש פניות למאגר הממשלתי.
  if (!(await allowed(ipKey(req, "plate"), 600, 30))) return NextResponse.json({ error: "limit" }, { status: 429 })
  const r = await lookupPlate(new URL(req.url).searchParams.get("n") ?? "")
  if ("error" in r) return NextResponse.json(r, { status: r.error === "invalid" ? 400 : 502 })
  return NextResponse.json(r)
}
