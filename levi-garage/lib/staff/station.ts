import "server-only"

import { createHmac } from "node:crypto"

// עמדה קבועה: מכשיר על ליפט או בעמדת האבחון, שמנהל העבודה צימד (016_stations).
//
// העוגייה מחזיקה את הטוקן של העמדה (48 תווים, אקראי). במסד נשמר רק ה-hash.
// המכונאי נכנס בשם וקוד של 6 ספרות, והשרת מתחבר בשמו עם סיסמה שנגזרת מ-
// STATION_SECRET — סיסמה שאף אדם לא יודע, ולכן הקוד לבד לא פותח כלום מחוץ לעמדה.
//
// אותה נגזרת בדיוק ב-scripts/station-setup.mjs וב-test/_auth.mjs. שינוי כאן
// מחייב שינוי שם, והרצה מחדש של הסקריפט.

export const STATION_COOKIE = "garage_station"

export function stationPassword(email: string): string {
  const secret = process.env.STATION_SECRET
  if (!secret || secret.length < 32) throw new Error("STATION_SECRET is not configured")
  return createHmac("sha256", secret).update(`mechanic:${email.trim().toLowerCase()}`).digest("base64url")
}

export const stationConfigured = () => Boolean(process.env.STATION_SECRET && process.env.STATION_SECRET.length >= 32)
