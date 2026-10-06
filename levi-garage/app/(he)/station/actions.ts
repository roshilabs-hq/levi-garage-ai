"use server"

import { cookies, headers } from "next/headers"
import QRCode from "qrcode"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/staff/session"
import { STATION_COOKIE, STATION_REQ_COOKIE, stationConfigured, stationPassword, stationRpcKey } from "@/lib/staff/station"

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
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "levi-garage.co.il"
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

// ---------------------------------------------------------------- חיבור הפוך (032)

export type StationReqState =
  | { status: "none" }
  | { status: "pending"; code: string }
  | { status: "approved"; label: string }
  | { status: "expired" }
  | { status: "declined" }
  | { status: "busy" }
  | { status: "retry" }

const REQ_MAX_AGE = 20 * 60

/**
 * הטאבלט שליד הליפט: מה מצב הבקשה שלו. כשדניאל אישר, נכנסת העוגייה של העמדה
 * (אותה עוגייה כמו בצימוד ב-QR), ומי שהיה מחובר במכשיר מתנתק.
 */
export async function pollStationRequest(): Promise<StationReqState> {
  const jar = await cookies()
  const secret = jar.get(STATION_REQ_COOKIE)?.value
  if (!secret) return { status: "none" }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("station_request_status", { p_secret: secret, p_key: stationRpcKey() })
  if (error) return { status: "retry" }
  const r = data as { status: string; code?: string; token?: string; label?: string } | null

  if (r?.status === "pending" && r.code) return { status: "pending", code: r.code }
  if (r?.status === "approved" && r.token) {
    jar.set(STATION_COOKIE, r.token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: YEAR })
    jar.delete(STATION_REQ_COOKIE)
    await supabase.auth.signOut()
    revalidatePath("/staff/stations")
    return { status: "approved", label: r.label ?? "" }
  }
  jar.delete(STATION_REQ_COOKIE)
  return { status: r?.status === "expired" ? "expired" : r?.status === "declined" ? "declined" : "none" }
}

/** הטאבלט: "לבקש מדניאל לחבר". אם כבר יש בקשה פתוחה, מחזיר אותה ולא פותח חדשה. */
export async function requestStation(): Promise<StationReqState> {
  const current = await pollStationRequest()
  if (current.status === "pending" || current.status === "approved") return current

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("request_station", { p_key: stationRpcKey() })
  const r = data as { ok: boolean; secret?: string; code?: string } | null
  if (error || !r?.ok || !r.secret || !r.code) return { status: "busy" }

  const jar = await cookies()
  jar.set(STATION_REQ_COOKIE, r.secret, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: REQ_MAX_AGE })
  return { status: "pending", code: r.code }
}

/** דניאל: הבקשה הזו לא שלנו, או נפתחה בטעות. יוצאת מהלוח מיד (034). */
export async function declineStationRequest(formData: FormData) {
  await requireManager()
  const id = String(formData.get("id") || "")
  if (!id) return
  const supabase = await createClient()
  await supabase.rpc("decline_station_request", { p_id: id })
  revalidatePath("/staff")
  revalidatePath("/staff/stations")
}

/** דניאל, מהלוח או ממסך העמדות: המכשיר עם המספר הזה הוא ליפט N. */
export async function approveStationRequest(formData: FormData) {
  await requireManager()
  const id = String(formData.get("id") || "")
  const raw = String(formData.get("lift") || "")
  const lift = raw === "diag" ? null : Number(raw)
  if (!id || (lift !== null && ![1, 2, 3, 4].includes(lift))) return

  const supabase = await createClient()
  await supabase.rpc("approve_station_request", { p_id: id, p_lift: lift })
  revalidatePath("/staff")
  revalidatePath("/staff/stations")
}

// ------------------------------------------------- דניאל מאשר על הטאבלט עצמו (033)

/** מי יכול לאשר כאן בקוד: מנהל העבודה והבעלים, שמות בלבד. רק למכשיר עם בקשה פתוחה. */
export async function stationApprovers(): Promise<{ id: string; full_name: string }[]> {
  const secret = (await cookies()).get(STATION_REQ_COOKIE)?.value
  if (!secret) return []
  const supabase = await createClient()
  const { data } = await supabase.rpc("station_request_approvers", { p_secret: secret, p_key: stationRpcKey() })
  return (data ?? []) as { id: string; full_name: string }[]
}

export type HereResult = { ok: true; label: string } | { ok: false; error: string } | null

const HERE_ERRORS: Record<string, (left?: number) => string> = {
  pin: (left) => `הקוד לא נכון.${left ? ` נשארו ${left} ניסיונות לפני נעילה.` : ""}`,
  locked: () => "יותר מדי ניסיונות. הקוד נעול ל-15 דקות. אפשר לאשר מהלוח במחשב.",
  who: () => "לבחור מי מאשר.",
  lift: () => "לבחור איזה ליפט זה.",
  gone: () => "הבקשה כבר לא פתוחה. לבקש שוב.",
}

/**
 * דניאל ליד הליפט: בוחר ליפט, נוגע בשם שלו ומקיש קוד, על הטאבלט עצמו. הטאבלט
 * לא יוצא מהמסך שלו, ואף אחד לא מתחבר עליו (רועי, 2.10). אחרי אישור, העמדה
 * נכנסת מיד, בלי לחכות לבדיקה הבאה.
 */
export async function approveHere(_prev: HereResult, formData: FormData): Promise<HereResult> {
  const secret = (await cookies()).get(STATION_REQ_COOKIE)?.value
  if (!secret) return { ok: false, error: HERE_ERRORS.gone() }
  const raw = String(formData.get("lift") || "")
  if (!raw) return { ok: false, error: HERE_ERRORS.lift() }
  const lift = raw === "diag" ? null : Number(raw)
  const staffId = String(formData.get("staff_id") || "")
  const pin = String(formData.get("pin") || "").replace(/\D/g, "")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("approve_station_request_with_pin", {
    p_secret: secret,
    p_staff_id: staffId,
    p_pin: pin,
    p_lift: lift,
    p_key: stationRpcKey(),
  })
  const r = data as { ok: boolean; reason?: string; left?: number } | null
  if (error || !r?.ok) return { ok: false, error: (HERE_ERRORS[r?.reason ?? ""] ?? (() => "האישור נכשל. לנסות שוב."))(r?.left) }

  const now = await pollStationRequest()
  return now.status === "approved" ? { ok: true, label: now.label } : { ok: false, error: "אושר, אבל החיבור לא הושלם. לרענן את הדף." }
}
