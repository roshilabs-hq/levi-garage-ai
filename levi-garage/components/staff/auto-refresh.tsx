"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

// המסך הזה מונח על הדלפק ופתוח כל היום, ומישהו אחר לוחץ על הכפתורים.
// בלי רענון עצמי, דניאל רואה תמונה מלפני שעתיים ומאמין לה. הרענון מושך
// מהשרת ולא טוען את הדף מחדש, ולכן המיקום בגלילה נשמר.
//
// חריג אחד: אם השרת הוחלף בגרסה חדשה מאז שהדף נטען, רענון רך מערבב קוד ישן
// שבדפדפן עם תוכן מהגרסה החדשה, ו-React נופל (שגיאה #418). זה בדיוק מה שקרה
// אחרי פריסה, על מסך שנשאר פתוח. לכן לפני כל רענון בודקים את גרסת השרת,
// וכשהיא השתנתה — טוענים את הדף מחדש, פעם אחת.
//
// live (29.9): "כל לחיצה אצל אלכס מצריכה רענון אצל דניאל". עכשיו המסך מאזין
// לטבלה live_ticks (מיגרציה 025), שזזה בכל כתיבה לטבלאות העבודה, ומתרענן תוך
// שנייה. הרענון לפי זמן נשאר כגיבוי, ויש רענון גם כשחוזרים לטאב או מוציאים
// את הטלפון מהכיס.
const BUILD = process.env.APP_BUILD ?? ""
const SETTLE_MS = 600

export function AutoRefresh({ seconds = 60, live = false }: { seconds?: number; live?: boolean }) {
  const router = useRouter()

  useEffect(() => {
    let busy = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const res = await fetch("/api/version", { cache: "no-store" })
        const { build } = (await res.json()) as { build?: string }
        if (BUILD && build && build !== BUILD) {
          window.location.reload()
          return
        }
        router.refresh()
      } catch {
        // השרת לא ענה — בדרך כלל כי הוא בדיוק מתחלף. לא מרעננים עכשיו: רענון
        // מול שרת שלא עונה הוא בדיוק מה שמפיל את React. ננסה בפעם הבאה.
      } finally {
        busy = false
      }
    }
    // כמה כתיבות ברצף (שמירה, ואחריה רישום תזוזה) הן רענון אחד.
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(tick, SETTLE_MS)
    }

    const id = setInterval(tick, seconds * 1000)
    const onVisible = () => document.visibilityState === "visible" && soon()
    document.addEventListener("visibilitychange", onVisible)

    let stop = () => {}
    if (live) {
      const supabase = createClient()
      let channel: ReturnType<typeof supabase.channel> | null = null
      let closed = false
      supabase.auth.getSession().then(({ data }) => {
        if (closed) return
        if (data.session) supabase.realtime.setAuth(data.session.access_token)
        channel = supabase
          .channel("live-ticks")
          .on("postgres_changes", { event: "*", schema: "public", table: "live_ticks" }, soon)
          .subscribe()
      })
      stop = () => {
        closed = true
        if (channel) supabase.removeChannel(channel)
      }
    }

    return () => {
      clearInterval(id)
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
      stop()
    }
  }, [router, seconds, live])

  return null
}
