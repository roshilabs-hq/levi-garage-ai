import type { Metadata } from "next"
import Link from "next/link"

import { requireManager } from "@/lib/staff/session"
import { TopBar } from "@/components/staff/top-bar"
import { createWalkin } from "@/app/(he)/staff/actions"
import { WalkinSubmit } from "@/components/staff/walkin-submit"

export const metadata: Metadata = { title: "רכב בלי תור | מוסך לוי ובניו", robots: { index: false, follow: false } }

// 3.10: באתר כתוב "אפשר להגיע בלי תור", ועד היום לדניאל לא הייתה דרך לקבל רכב
// כזה. כאן נפתח לו תור, ומשם זו אותה קבלה בדיוק, עם אותה הצעה לאישור.

const SERVICES = ["טיפול תקופתי", "נורה דולקת / תקלה", "הכנה וליווי לטסט", "חשמל / מיזוג", "בדיקה לפני קנייה", "אחר"]

const ERRORS: Record<string, string> = {
  plate: "מספר רישוי הוא 7 או 8 ספרות.",
  phone: "צריך טלפון נייד ישראלי, למשל 050-1234567. אליו יגיע הקישור לאישור ההצעה.",
  failed: "לא הצלחנו לפתוח תור. לנסות שוב.",
}

export default async function WalkinPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const staff = await requireManager()
  const { e } = await searchParams

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="other" />
      <header className="staff-top">
        <div>
          <Link className="staff-back" href="/staff">חזרה ללוח</Link>
          <h1>קבלת רכב בלי תור</h1>
          <p>פותחים לו תור כאן, ובמסך הבא ממשיכים לקבלה הרגילה: מה עושים ברכב, והצעה שהלקוח מאשר בעצמו.</p>
        </div>
      </header>

      {e && ERRORS[e] && (
        <p className="staff-error" role="alert">
          {ERRORS[e]}
        </p>
      )}

      <form action={createWalkin} className="arrive-form walkin-form">
        <label htmlFor="plate">מספר רישוי</label>
        <input id="plate" name="plate" inputMode="numeric" dir="ltr" required placeholder="12-345-67" autoComplete="off" />

        <label htmlFor="phone">טלפון נייד של הלקוח</label>
        <input id="phone" name="phone" type="tel" dir="ltr" required placeholder="050-0000000" autoComplete="off" />

        <label htmlFor="name">שם</label>
        <input id="name" name="name" autoComplete="off" />

        <label htmlFor="email">מייל (לא חובה)</label>
        <input id="email" name="email" type="email" dir="ltr" autoComplete="off" placeholder="אליו תגיע הצעת המחיר" />

        <label htmlFor="service">סוג שירות</label>
        <select id="service" name="service" defaultValue="">
          <option value="" disabled>
            לבחור
          </option>
          {SERVICES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <label htmlFor="notes">מה קורה עם הרכב, במילים של הלקוח</label>
        <textarea id="notes" name="notes" rows={3} />

        <WalkinSubmit />
        <p className="staff-meta">
          פרטי הרכב נשלפים ממשרד התחבורה, וזה יכול לקחת כמה שניות. במסך הבא הלקוח סורק QR ושולח לנו הודעה, וכך מסכים לעדכונים בוואטסאפ.
        </p>
      </form>
    </main>
  )
}
