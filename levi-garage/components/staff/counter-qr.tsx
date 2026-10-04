import Link from "next/link"
import QRCode from "qrcode"

import { whatsappLink } from "@/lib/site/dict"
import { COUNTER_MESSAGE } from "@/lib/site/consent"
import { ConsentWatch } from "@/components/staff/consent-watch"

// 3.10: לקוח בלי הסכמה לוואטסאפ (הגיע בלי תור, או לא סימן בטופס). הוא סורק את
// ה-QR מהטלפון של דניאל או מהמדבקה בדלפק, ושולח הודעה שכבר כתובה. ההודעה היא
// ההסכמה, במילים שלו (lib/site/consent.ts), והיא גם פותחת את הוואטסאפ, כך
// שהקישור לאישור ההצעה יכול להגיע אליו בעוד דקה, עוד מול הדלפק.

export async function CounterQr({ bookingId, walkin }: { bookingId: number; walkin: boolean }) {
  const link = whatsappLink(COUNTER_MESSAGE)
  if (!link) return null
  const svg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
  return (
    <section className="counter-qr" aria-labelledby="counter-qr-h">
      <ConsentWatch bookingId={bookingId} />
      <div className="counter-qr-code" dangerouslySetInnerHTML={{ __html: svg }} aria-hidden />
      <div>
        <h2 id="counter-qr-h">{walkin ? "קודם: שהלקוח יסרוק וישלח הודעה" : "הלקוח לא סימן עדכונים בוואטסאפ"}</h2>
        <p>
          להראות ללקוח את הקוד. הוא סורק במצלמה, והוואטסאפ נפתח אצלו עם הודעה כתובה: &quot;אשמח לקבל בוואטסאפ את הצעת המחיר ועדכונים על
          הרכב&quot;. <b>ההודעה ששלח היא ההסכמה שלו</b>, ואז הקישור לאישור ההצעה יגיע אליו לטלפון.
        </p>
        <p className="staff-meta">
          כשההודעה שלו מגיעה, הקוד נעלם לבד, והתיבה &quot;הלקוח מסכים&quot; למטה מסתמנת. לא נעלם? <Link href={`/staff/arrive/${bookingId}`}>לרענן</Link>. בלי
          סמארטפון: לסמן למטה שיחתום על עותק מודפס.
        </p>
      </div>
    </section>
  )
}
