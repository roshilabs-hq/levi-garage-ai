"use server"

import { cookies, headers } from "next/headers"
import QRCode from "qrcode"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/staff/session"
import { STATION_COOKIE, stationConfigured, stationPassword } from "@/lib/staff/station"

// הכניסה בעמדה קבועה (016). הקוד של המכונאי נבדק במסד (station_login), יחד עם
// הטוקן של העמדה מהעוגייה. רק אם שניהם תקינים, השרת מתחבר בשמו.

const YEAR = 60 * 60 * 24 * 365

/** מנהל העבודה מצמד את המכשיר הזה לעמדה. אחרי זה הוא מתנתק, והמכשיר נשאר עמדה. */
export async function pairStation(formData: FormData) {
  await requireManager()
  const raw = String(formData.get("lift") || "")
  const lift = raw === "diag" ? null : Number(raw)
  if (lift !== null && ![1, 2, 3, 4].includes(lift)) redirect("/staff/stations?e=lift")
  const label = lift ? `ליפט ${lift}` : "עמדת האבחון"

  const supabase = await createClient()
  const { data: token, error } = await supabase.rpc("create_station", { p_label: label, p_lift: lift })
  if (error || !token) redirect("/staff/stations?e=failed")

  const jar = await cookies()
  jar.set(STATION_COOKIE, String(token), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: YEAR })
  await supabase.auth.signOut()
  redirect("/station")
}

/** כניסה בעמדה: שם וקוד. */
export async function stationLogin(formData: FormData) {
  const staffId = String(formData.get("staff_id") || "")
  const pin = String(formData.get("pin") || "").replace(/\D/g, "")
  const back = (e: string, extra = "") => redirect(`/station?who=${encodeURIComponent(staffId)}&e=${e}${extra}`)
  if (!stationConfigured()) redirect("/station?e=config")

  const jar = await cookies()
  const token = jar.get(STATION_COOKIE)?.value
  if (!token) redirect("/station")

  const supabase = await createClient()
  const { data } = await supabase.rpc("station_login", { p_token: token, p_staff_id: staffId, p_pin: pin })
  const r = data as { ok: boolean; reason?: string; left?: number; email?: string; lift?: number | null } | null
  if (!r?.ok || !r.email) {
    if (r?.reason === "station") {
      jar.delete(STATION_COOKIE)
      redirect("/station?e=station")
    }
    back(r?.reason ?? "pin", r?.left !== undefined ? `&left=${r.left}` : "")
    return
  }

  const { error } = await supabase.auth.signInWithPassword({ email: r.email, password: stationPassword(r.email) })
  if (error) {
    console.error("station sign-in failed:", error.status, error.code)
    back("signin")
  }
  // העמדה קובעת איפה הוא עובד: אין "איפה אני עובד עכשיו" לבחור בעמדה קבועה.
  await supabase.rpc("set_my_lift", { p_lift: r.lift ?? null })
  redirect("/staff/lift")
}

/** "החלפת עובד": מתנתק, והעמדה חוזרת לרשימת השמות. */
export async function stationSwitch() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/station")
}

/** מנהל העבודה קובע או מאפס קוד למכונאי. */
export async function setStaffPin(formData: FormData) {
  await requireManager()
  const staffId = String(formData.get("staff_id") || "")
  const pin = String(formData.get("pin") || "").replace(/\D/g, "")
  if (!/^\d{6}$/.test(pin)) redirect("/staff/stations?e=pin")
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_staff_pin", { p_staff_id: staffId, p_pin: pin })
  revalidatePath("/staff/stations")
  redirect(`/staff/stations?${error ? "e=pin" : "ok=pin"}`)
}

/** ביטול עמדה (מכשיר שאבד, או הועבר). הטוקן שבמכשיר מפסיק לעבוד מיד. */
export async function revokeStation(formData: FormData) {
  await requireManager()
  const id = String(formData.get("station_id") || "")
  const supabase = await createClient()
  await supabase.from("stations").update({ revoked_at: new Date().toISOString() }).eq("id", id)
  revalidatePath("/staff/stations")
}

/** מסיר את הצימוד מהמכשיר הזה (למשל כשמכשיר עמדה חוזר להיות מחשב משרד). */
export async function unpairThisDevice() {
  const jar = await cookies()
  jar.delete(STATION_COOKIE)
  redirect("/staff/login")
}

// ---------------------------------------------------------------- צימוד בקוד QR (022)

export type PairResult = { ok: true; url: string; svg: string; label: string; expiresAt: string } | { ok: false; error: string } | null

/**
 * דניאל, מהמחשב: קוד חד-פעמי לליפט, ל-10 דקות. הטלפון שסורק אותו הופך לעמדה
 * בלי שדניאל יתחבר עליו. הכתובת נבנית מהכתובת שממנה דניאל גולש, כך שזה עובד
 * גם מקומית וגם באתר החי.
 */
export async function createPairCode(_prev: PairResult, formData: FormData): Promise<PairResult> {
  await requireManager()
  const raw = String(formData.get("lift") || "")
  const lift = raw === "diag" ? null : Number(raw)
  if (lift !== null && ![1, 2, 3, 4].includes(lift)) return { ok: false, error: "צריך לבחור ליפט או את עמדת האבחון." }

  const supabase = await createClient()
  const { data: code, error } = await supabase.rpc("create_pair_code", { p_lift: lift })
  if (error || !code) return { ok: false, error: "לא הצלחנו ליצור קוד. לנסות שוב." }

  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "levi-garage.vercel.app"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const url = `${proto}://${host}/station/pair/${code}`
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
  return {
    ok: true,
    url,
    svg,
    label: lift ? `ליפט ${lift}` : "עמדת האבחון",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }
}

/**
 * הטלפון: מממש את הקוד בלחיצה (לא בפתיחת הכתובת — וואטסאפ וסורקים פותחים
 * קישורים מראש, וזה היה שורף את הקוד). מי שהיה מחובר במכשיר מתנתק: זה מכשיר עמדה.
 */
export async function redeemPairCode(formData: FormData) {
  const code = String(formData.get("code") || "")
  const supabase = await createClient()
  const { data } = await supabase.rpc("redeem_pair_code", { p_code: code })
  const r = data as { ok: boolean; token?: string; reason?: string } | null
  if (!r?.ok || !r.token) redirect(`/station/pair/${encodeURIComponent(code)}?e=${r?.reason ?? "bad"}`)

  const jar = await cookies()
  jar.set(STATION_COOKIE, r.token!, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: YEAR })
  await supabase.auth.signOut()
  revalidatePath("/staff/stations")
  redirect("/station")
}
