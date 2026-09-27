"use server"

import { cookies } from "next/headers"
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
