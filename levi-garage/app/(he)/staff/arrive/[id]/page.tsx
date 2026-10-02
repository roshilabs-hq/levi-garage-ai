import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { requireManager } from "@/lib/staff/session"
import { serviceToCode } from "@/lib/staff/inspection"
import { fmtStamp } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { ArriveForm, type PriceItem } from "@/components/staff/arrive-form"

export const metadata: Metadata = { title: "קבלת רכב | מוסך לוי ובניו", robots: { index: false, follow: false } }

// קבלת רכב בדלפק: השלב שבו נקבעת הצעת המחיר הראשונה. החוק דורש שהיא תינתן
// במסמך מודפס או במייל (ס' 132(ב)), ולכן היא נשלחת מכאן ולא בוואטסאפ.

const ERRORS: Record<string, string> = {
  explain: "צריך לסמן שהסברת ללקוח את ההבדל בין סוגי החלקים. זו דרישה של החוק (ס' 131).",
  missing: "חסר שירות מהמחירון.",
  paper: "הלקוח לא הסכים לעדכונים בוואטסאפ ובמייל, אז אין לאן לשלוח לו קישור לאישור. לסמן שהוא יחתום על עותק מודפס, או לשאול אותו שוב על ההסכמה.",
  failed: "לא הצלחנו לפתוח כרטיס. לנסות שוב.",
}

export default async function ArrivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const staff = await requireManager()
  const { id } = await params
  const { e } = await searchParams
  const bookingId = Number(id)
  if (!Number.isFinite(bookingId)) notFound()

  const supabase = await createClient()
  const [{ data: booking }, { data: items }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, status, plate, customer_name, customer_email, whatsapp_consent, service, notes, drop_off_at, vehicle_make, vehicle_model, vehicle_year")
      .eq("id", bookingId)
      .maybeSingle(),
    supabase.from("price_list").select("*").eq("active", true).order("sort", { ascending: true }),
  ])
  if (!booking) notFound()
  if (booking.status === "arrived") redirect("/staff")

  const car = [booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(" ") || "רכב"

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="other" />

      <header className="staff-top">
        <div>
          <Link className="staff-back" href="/staff">חזרה ללוח</Link>
          <h1>
            קבלת רכב · <span className="plate-chip num" dir="ltr">{booking.plate}</span>
          </h1>
          <p>
            {booking.customer_name || "ללא שם"} · {car}
            {booking.vehicle_year ? `, ${booking.vehicle_year}` : ""} · תור ל-{fmtStamp(booking.drop_off_at)}
            {booking.service ? ` · ביקש: ${booking.service}` : ""}
          </p>
          {booking.notes && <p className="staff-note">הלקוח כתב: {booking.notes}</p>}
        </div>
      </header>

      {e && ERRORS[e] && (
        <p className="staff-error" role="alert">
          {ERRORS[e]}
        </p>
      )}

      <ArriveForm
        bookingId={booking.id}
        items={(items ?? []) as PriceItem[]}
        defaultCode={serviceToCode(booking.service)}
        email={booking.customer_email}
        consent={Boolean(booking.whatsapp_consent)}
      />
    </main>
  )
}
