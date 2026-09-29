import type { Metadata } from "next"
import Image from "next/image"

import { requireStaff } from "@/lib/staff/session"
import { TopBar } from "@/components/staff/top-bar"

export const metadata: Metadata = { title: "תמונות להדגמה | מוסך לוי ובניו", robots: { index: false, follow: false } }

// תמונות של תקלות, לבדיקה בלי מוסך (רועי, 29.9). כפתור הצילום בטלפון פותח ישר
// את המצלמה, לא את הגלריה — וזה נכון במוסך אמיתי. אז בוחן פותח את הדף הזה במחשב,
// ומצלם את המסך מהטלפון שמחובר כעמדה. ליד כל תמונה: מה להגיד למיקרופון.
// התמונות נוצרו ב-Gemini להדגמה בלבד.

const PHOTOS = [
  { file: "brakes", title: "רפידות ודיסק קדמיים שחוקים", say: "רפידות קדמיות כמעט גמורות, והדיסק שרוט. צריך להחליף רפידות ודיסקים." },
  { file: "taillight", title: "פנס אחורי סדוק", say: "הפנס האחורי השמאלי סדוק. צריך להחליף לפני הטסט." },
  { file: "oil-leak", title: "נזילת שמן מהמנוע", say: "יש נזילת שמן מתחת למנוע, כנראה מאטם האגן. צריך לבדוק ולהחליף אטם." },
  { file: "tire", title: "צמיג שחוק", say: "הצמיג הקדמי שחוק לגמרי, בלי חריצים. חייב להחליף, זה בטיחות." },
  { file: "air-filter", title: "מסנן אוויר סתום", say: "מסנן האוויר מלא אבק. כדאי להחליף עכשיו, זה עבודה קטנה." },
  { file: "wiper", title: "מגב קרוע", say: "המגב של הנהג קרוע. להחליף זוג מגבים." },
]

export default async function DemoPhotosPage() {
  const staff = await requireStaff()

  return (
    <main className="staff-wrap wide">
      <TopBar staff={staff} current="stations" />

      <header className="staff-top">
        <div>
          <h1>תמונות להדגמה</h1>
          <p>
            לבדיקה בלי מוסך: פותחים את הדף הזה במחשב, ובטלפון שמחובר כעמדה לוחצים &quot;צילום ודיווח&quot; ומצלמים את המסך. אחרי הצילום
            ההקלטה מתחילה לבד — אומרים את המשפט שמתחת לתמונה, ועוצרים.
          </p>
        </div>
      </header>

      <ul className="demo-photos">
        {PHOTOS.map((p) => (
          <li key={p.file}>
            <Image src={`/demo-photos/${p.file}.jpg`} alt={p.title} width={1400} height={1050} sizes="(max-width: 700px) 100vw, 50vw" />
            <b>{p.title}</b>
            <p>
              <span>להגיד:</span> &quot;{p.say}&quot;
            </p>
          </li>
        ))}
      </ul>

      <p className="staff-meta demo-photos-note">התמונות נוצרו בבינה מלאכותית לצורך הדגמה. במוסך אמיתי המכונאי מצלם את הרכב עצמו.</p>
    </main>
  )
}
