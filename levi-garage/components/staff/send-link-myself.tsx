"use client"

import { useState } from "react"

// כשהקישור לאישור לא יצא אוטומטית (ביקורת UX חיצונית, 8.10, ממצא 3). הבוט שולח רק למי שכתב
// למוסך ב-14 הימים האחרונים, כדי לא לסכן את הקו. דניאל לא צריך לחכות: הוא שולח בעצמו, מהוואטסאפ
// של המוסך. אדם ששולח ללקוח שלו הוא לא הודעה יזומה של בוט, ולכן הכלל לא חל. או מעתיק את הקישור
// ל-SMS או למייל.
export function SendLinkMyself({ phone, path, name }: { phone: string | null; path: string; name: string | null }) {
  const [copied, setCopied] = useState(false)
  const digits = (phone ?? "").replace(/\D/g, "")
  const intl = digits.startsWith("972") ? digits : digits.startsWith("0") ? `972${digits.slice(1)}` : ""
  const link = () => new URL(path, window.location.origin).toString()
  const first = (name ?? "").trim().split(/\s+/)[0]

  return (
    <div className="notice-retry send-myself">
      {intl.length >= 11 && (
        <button
          className="btn quiet"
          type="button"
          onClick={() => {
            const text = `שלום${first ? ` ${first}` : ""}, כאן מוסך לוי ובניו. מצאנו ברכב משהו שדורש את האישור שלך. התמונות, המחירים והאישור כאן: ${link()}`
            window.open(`https://wa.me/${intl}?text=${encodeURIComponent(text)}`, "_blank", "noopener")
          }}
        >
          לשלוח בעצמי, מהוואטסאפ של המוסך
        </button>
      )}
      <button
        className="btn quiet"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link())
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
          } catch {
            window.prompt("להעתיק את הקישור:", link())
          }
        }}
      >
        {copied ? "הקישור הועתק ✓" : "להעתיק את הקישור"}
      </button>
    </div>
  )
}
