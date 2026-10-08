import "server-only"

import type { createClient } from "@/lib/supabase/server"

// 062 (ביקורת אבטחה רביעית, 8.10, ממצא 1): הטלפון והמייל של הלקוח לא נקראים ישירות מהטבלאות, לאף
// משתמש. דניאל ואבי מקבלים אותם מהמסד דרך פונקציה שבודקת תפקיד. לכל אחר הן מחזירות ריק, בלי שגיאה.

type Supa = Awaited<ReturnType<typeof createClient>>
export type Contact = { customer_phone: string | null; customer_email: string | null }

/** כל עמודות כרטיס העבודה שמותר לקרוא ישירות (בלי טלפון ומייל). במקום select("*"). */
export const JOB_COLUMNS =
  "id, booking_id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, fuel, customer_name, whatsapp_consent, lift, status, opened_by, opened_at, ready_at, delivered_at, notes, updated_at, lift_since, status_since, odometer_km, updates_consent_at, inspected_at, inspected_by, work_approved_at, work_approved_by, parked_at, priority_at, outside_at, work_done_at, work_approved_via, terms_accepted_at, whatsapp_revoked_at"

const NONE: Contact = { customer_phone: null, customer_email: null }

/** פרטי הקשר של כמה כרטיסים, לפי מזהה. */
export async function jobContacts(supabase: Supa, ids: number[]): Promise<Map<number, Contact>> {
  const out = new Map<number, Contact>()
  if (ids.length === 0) return out
  const { data } = await supabase.rpc("job_contacts", { p_job_ids: ids })
  for (const r of (data ?? []) as (Contact & { id: number })[]) out.set(Number(r.id), { customer_phone: r.customer_phone, customer_email: r.customer_email })
  return out
}

export async function jobContact(supabase: Supa, id: number): Promise<Contact> {
  return (await jobContacts(supabase, [id])).get(id) ?? NONE
}

export async function bookingContact(supabase: Supa, id: number): Promise<Contact> {
  const { data } = await supabase.rpc("booking_contact", { p_booking_id: id })
  return ((data ?? []) as Contact[])[0] ?? NONE
}
