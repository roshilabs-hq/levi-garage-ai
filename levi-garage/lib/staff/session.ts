import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { STATION_COOKIE } from "@/lib/staff/station"

// מי מחובר, ומה מותר לו. שורת ה-staff היא מקור האמת לתפקיד:
// משתמש שנוצר ב-auth אבל אין לו שורה כאן, הוא לא איש צוות.

export type StaffRole = "owner" | "manager" | "mechanic" | "display"
export type ScreenKind = "lobby" | "wall"

export type StaffMember = {
  id: string
  full_name: string
  role: StaffRole
  lift: number | null
  lang: "he" | "ar" | "ru"
  email: string
  /** למשתמש מסך בלבד: איזה מסך מותר לו לפתוח. */
  screen: ScreenKind | null
  /** מכונאי שנכנס בעמדה (057). */
  atStation?: boolean
}

export async function getStaff(): Promise<StaffMember | null> {
  const supabase = await createClient()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data } = await supabase
    .from("staff")
    .select("id, full_name, role, lift, lang, screen, active")
    .eq("id", auth.user.id)
    .maybeSingle()

  if (!data?.active) return null
  const staff = { ...(data as Omit<StaffMember, "email">), email: auth.user.email ?? "" }

  // מכונאי (057, 059): הליפט הוא של הכניסה בעמדה, לא של העובד. בלי עמדה (סיסמה, בטלפון) אין לו
  // ליפט, כמו במסד (my_lift). ועמדה שבוטלה מנתקת אותו (my_role ריק).
  if (staff.role === "mechanic") {
    const { data: here } = await supabase.rpc("my_station_session")
    const s = here as { bound?: boolean; lift?: number | null; revoked?: boolean } | null
    if (s?.revoked) return null
    staff.lift = s?.bound ? (s.lift ?? null) : null
    staff.atStation = Boolean(s?.bound)
  }
  return staff
}

/** לעמודים שמאחורי ההתחברות. מי שלא מחובר מגיע למסך הכניסה. */
export async function requireStaff(): Promise<StaffMember> {
  const staff = await getStaff()
  // מכשיר של עמדה (כניסה שפגה, עמדה שבוטלה, או "החלפת עובד") חוזר לעמדה, לא לכניסה בסיסמה
  if (!staff) redirect((await cookies()).get(STATION_COOKIE) ? "/station" : "/staff/login")
  // משתמש מסך לא מסתובב באזור הצוות. זו כל הנקודה שלו: המסך בחדר ההמתנה
  // נשאר מחובר כל היום בחדר ציבורי, ומי שנוגע בו חוזר למסך ולא ללוח היום.
  if (staff.role === "display") redirect(screenPath(staff))
  return staff
}

export const screenPath = (staff: { screen: ScreenKind | null }) => (staff.screen === "wall" ? "/wall" : "/lobby")

/**
 * לשני המסכים התלויים. משתמש מסך נכנס רק למסך שלו, ואיש צוות אמיתי נכנס
 * לשניהם — כדי שדניאל יוכל להציץ בלוח הסדנה מהטלפון בלי עוד חשבון.
 */
export async function requireScreen(kind: ScreenKind): Promise<StaffMember> {
  const staff = await getStaff()
  if (!staff) redirect("/staff/login")
  if (staff.role === "display" && staff.screen !== kind) redirect(screenPath(staff))
  return staff
}

/** לפעולות של מנהל עבודה, כמו שליחת מחיר ללקוח. המסד אוכף שוב, זה רק המסך. */
export async function requireManager(): Promise<StaffMember> {
  const staff = await requireStaff()
  // רשימה של מי שמותר, לא של מי שאסור (043): תפקיד חדש לא נכנס בטעות.
  if (staff.role !== "owner" && staff.role !== "manager") redirect("/staff")
  return staff
}

export const roleLabel: Record<StaffRole, string> = {
  owner: "בעלים",
  manager: "מנהל עבודה",
  mechanic: "מכונאי",
  display: "מסך",
}
