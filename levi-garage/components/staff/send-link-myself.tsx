"use client"

import { useState } from "react"

import { markNoticeManual } from "@/app/(he)/staff/actions"

// כשהקישור לאישור לא יצא אוטומטית (ביקורת UX חיצונית, 8.10, ממצא 3). הבוט שולח רק למי שכתב
// למוסך ב-14 הימים האחרונים, כדי לא לסכן את הקו. דניאל לא צריך לחכות: הוא שולח בעצמו, מהוואטסאפ
// של המוסך. אדם ששולח ללקוח שלו הוא לא הודעה יזומה של בוט, ולכן הכלל לא חל. או מעתיק את הקישור
// ל-SMS או למייל.
//
// הביקורת החוזרת (8.10, ממצאים 4 ו-6): הכפתור רק פותח הודעה מוכנה, הוא לא יודע מאיזה חשבון ואם
// נשלחה. לכן הנוסח אומר את זה, ו"שלחתי בעצמי" רושם את השליחה (071). ואותו מסלול גם להצעת הקבלה.
export function SendLinkMyself({
  phone,
  path,
  name,
  kind = "findings",
  noticeId,
  jobId,
}: {
  phone: string | null
  path: string
  name: string | null
  kind?: "findings" | "intake"
  noticeId?: number | null
  jobId?: number
}) {
  const [copied, setCopied] = useState(false)
  const digits = (phone ?? "").replace(/\D/g, "")
  const intl = digits.startsWith("972") ? digits : digits.startsWith("0") ? `972${digits.slice(1)}` : ""
  const link = () => new URL(path, window.location.origin).toString()
  const first = (name ?? "").trim().split(/\s+/)[0]
  const hello = `שלום${first ? ` ${first}` : ""}, כאן מוסך לוי ובניו.`
  const body =
    kind === "intake"
      ? `${hello} הצעת המחיר לקבלת הרכב מחכה לאישור שלך. הפרטים והאישור כאן: `
      : `${hello} מצאנו ברכב משהו שדורש את האישור שלך. התמונות, המחירים והאישור כאן: `

  return (
    <div className="notice-retry send-myself">
      <p className="staff-meta send-myself-note">
        ההודעה האוטומטית לא יצאה. אפשר לשלוח בעצמכם: הכפתור פותח הודעה מוכנה. ודאו שאתם בוואטסאפ של המוסך, ושלחו אותה.
      </p>
      {intl.length >= 11 && (
        <button
          className="btn quiet"
          type="button"
          onClick={() => window.open(`https://wa.me/${intl}?text=${encodeURIComponent(body + link())}`, "_blank", "noopener")}
        >
          לפתוח הודעה מוכנה בוואטסאפ
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
      {noticeId && jobId ? (
        <form action={markNoticeManual}>
          <input type="hidden" name="notice_id" value={noticeId} />
          <input type="hidden" name="job_id" value={jobId} />
          <button className="btn quiet" type="submit">
            שלחתי בעצמי ✓
          </button>
        </form>
      ) : null}
    </div>
  )
}
