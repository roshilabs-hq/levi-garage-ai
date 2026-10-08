// איך בדיקה מתחברת כאיש צוות.
//
// מכונאי לא נכנס בסיסמת ההדגמה: מ-016 הוא נכנס רק מעמדה מצומדת, והסיסמה שלו
// נגזרת מ-STATION_SECRET (כמו ב-levi-garage/lib/staff/station.ts). כל השאר —
// מנהל, בעלים, מסכים — בסיסמת ההדגמה.

import { createHmac } from "node:crypto"

const MECHANICS = new Set(["test2@test.com", "test4@test.com", "test5@test.com", "test6@test.com"])

export function passwordFor(email) {
  if (!MECHANICS.has(email)) {
    const p = process.env.STAFF_DEMO_PASSWORD
    if (!p) throw new Error("חסר STAFF_DEMO_PASSWORD. להריץ עם --env-file=levi-garage/.env.staff.local")
    return p
  }
  const secret = process.env.STATION_SECRET
  if (!secret) throw new Error("חסר STATION_SECRET. להריץ עם --env-file=levi-garage/.env.staff.local")
  return createHmac("sha256", secret).update(`mechanic:${email.trim().toLowerCase()}`).digest("base64url")
}

// 062: הטלפון והמייל של הלקוח לא נקראים ישירות מ-job_cards ומ-bookings, לאף משתמש (רק דרך
// job_contacts / booking_contact). בקשה של משתמש בלי select (גם PATCH עם return=representation)
// מבקשת את כל העמודות, ונדחית. כאן מוסיפים את העמודות המותרות. מפתח השירות לא מושפע.
const JOB_READABLE =
  "id,booking_id,plate,vehicle_make,vehicle_model,vehicle_year,engine_code,fuel,customer_name,whatsapp_consent,lift,status,opened_by,opened_at,ready_at,delivered_at,notes,updated_at,lift_since,status_since,odometer_km,updates_consent_at,inspected_at,inspected_by,work_approved_at,work_approved_by,parked_at,priority_at,outside_at,work_done_at,work_approved_via,terms_accepted_at,whatsapp_revoked_at"
const BOOKING_READABLE =
  "id,cal_uid,status,drop_off_at,customer_name,whatsapp_consent,plate,service,notes,vehicle_found,vehicle_make,vehicle_model,vehicle_year,engine_code,fuel,tires,test_valid_until,created_at,updated_at,source,whatsapp_revoked_at"

export function readable(path, token) {
  if (token && token === process.env.SUPABASE_SECRET_KEY) return path
  const m = path.match(/^\/rest\/v1\/(job_cards|bookings)(\?|$)/)
  if (!m || /[?&]select=/.test(path)) return path
  return `${path}${path.includes("?") ? "&" : "?"}select=${m[1] === "job_cards" ? JOB_READABLE : BOOKING_READABLE}`
}
