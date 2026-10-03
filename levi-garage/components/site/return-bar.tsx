"use client"

import { useEffect, useState } from "react"

// 3.10: הקישורים לתקנון ולפרטיות בטופס של Cal.com (ובדף ההצעה) נפתחים בחלון חדש,
// ומי שפחות רגיל לטכנולוגיה לא ימצא את הדרך חזרה. כשהגיעו מהטופס (?from=book)
// או מההצעה (?from=approve), הדף אומר שהטופס לא נמחק ומציע לסגור את החלון.
// דפדפן מרשה לסגור רק חלון שנפתח מקישור; אם הוא מסרב, מסבירים איך.

const WHERE = {
  book: { back: "חזרה לקביעת התור", kept: "הטופס של קביעת התור לא נמחק. הוא מחכה בחלון הקודם." },
  approve: { back: "חזרה להצעת המחיר", kept: "הצעת המחיר מחכה בחלון הקודם." },
} as const

export function ReturnBar() {
  const [from, setFrom] = useState<keyof typeof WHERE | null>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("from")
    if (f === "book" || f === "approve") setFrom(f)
  }, [])

  if (!from) return null
  const w = WHERE[from]
  const close = () => {
    window.close()
    // אם החלון עדיין פתוח אחרי רגע, הדפדפן לא הרשה לסגור.
    setTimeout(() => setStuck(true), 400)
  }

  return (
    <div className="return-bar" role="region" aria-label={w.back}>
      <p>{w.kept}</p>
      <button type="button" className="btn" onClick={close}>
        {w.back}
      </button>
      {stuck && (
        <p className="return-help">
          הדפדפן לא מאפשר לסגור את החלון מכאן. בטלפון: לוחצים על &quot;חזרה&quot;. במחשב: סוגרים את הלשונית הזו (ה־✕ שלה, למעלה).
        </p>
      )}
    </div>
  )
}
