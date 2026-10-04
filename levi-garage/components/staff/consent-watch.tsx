"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

// 4.10 (ההרצה של רועי: "ה-QR לא נעלם לבד"): כל עוד ה-QR על המסך, בודקים כל
// שתי שניות אם הלקוח כבר שלח את ההודעה. כשההסכמה נרשמה (039), מרעננים את הדף
// מהשרת: ה-QR נעלם, והתיבה בטופס מסתמנת. כמו דף "התור נקבע" באתר (book.tsx).
// עוצרים אחרי 10 דקות; הקישור "לרענן" נשאר לגיבוי.
const EVERY_MS = 2000
const GIVE_UP_MS = 10 * 60 * 1000

export function ConsentWatch({ bookingId }: { bookingId: number }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const started = Date.now()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped) return
      const { data } = await supabase.from("bookings").select("whatsapp_consent").eq("id", bookingId).maybeSingle()
      if (stopped) return
      if (data?.whatsapp_consent) {
        router.refresh()
        return
      }
      if (Date.now() - started < GIVE_UP_MS) timer = setTimeout(tick, EVERY_MS)
    }
    timer = setTimeout(tick, EVERY_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [bookingId, router])

  return null
}
