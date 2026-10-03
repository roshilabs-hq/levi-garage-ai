"use client"

import { useFormStatus } from "react-dom"

// המאגר של משרד התחבורה איטי. הכפתור אומר שמחכים לו, כדי שלא ילחצו פעמיים.
export function WalkinSubmit() {
  const { pending } = useFormStatus()
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "שולפים את פרטי הרכב…" : "להמשך הקבלה"}
    </button>
  )
}
