"use client"

import { useEffect } from "react"

// "הלחיצות, במיוחד בנייד, מרגישות איטיות. לוקח כמה שניות עד שזה נקלט" (רועי, 29.9).
// גם כשהשרת מהיר, בין הלחיצה לבין המסך החדש עובר זמן, ובלי שום סימן המכונאי לוחץ
// שוב. הרכיב הזה מסמן מיד את הכפתור שנלחץ (גלגל קטן, ולא לחיץ שוב), ומנקה את הסימן
// כשהדף משתנה בתגובה. רכיב אחד לכל האזור, במקום לגעת בכל אחד מ-41 הכפתורים.
const MAX_MS = 15000

export function PendingSubmit() {
  useEffect(() => {
    let marked: HTMLElement | null = null
    let observer: MutationObserver | null = null
    let cap: ReturnType<typeof setTimeout> | undefined
    let settle: ReturnType<typeof setTimeout> | undefined

    const clear = () => {
      marked?.removeAttribute("data-pending")
      marked?.removeAttribute("aria-busy")
      marked = null
      observer?.disconnect()
      observer = null
      clearTimeout(cap)
      clearTimeout(settle)
    }

    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement
      const button = (e.submitter as HTMLElement | null) ?? form.querySelector<HTMLElement>('[type="submit"]')
      if (!button) return
      clear()
      marked = button
      button.setAttribute("data-pending", "")
      button.setAttribute("aria-busy", "true")
      cap = setTimeout(clear, MAX_MS)
      // התשובה מגיעה כשינוי במבנה הדף (שורה שזזה, הודעה, דף אחר). שעונים שמתקדמים
      // משנים רק טקסט, ולכן לא נחשבים.
      observer = new MutationObserver(() => {
        clearTimeout(settle)
        settle = setTimeout(clear, 150)
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }

    document.addEventListener("submit", onSubmit, true)
    window.addEventListener("pageshow", clear)
    return () => {
      document.removeEventListener("submit", onSubmit, true)
      window.removeEventListener("pageshow", clear)
      clear()
    }
  }, [])

  return null
}
