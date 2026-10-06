import { readFileSync } from "node:fs"

// כותרות אבטחה לכל דף (27.9, בדיקת OWASP A02).
//
// frame-ancestors / X-Frame-Options: אף אתר לא יכול להטמיע אותנו. בלי זה, אתר
// זר היה יכול להציג את דף האישור של לקוח בתוך מסגרת שקופה ולגרום לו ללחוץ
// "מאשר" בלי לדעת (clickjacking). אנחנו מטמיעים את Cal.com, לא להפך.
//
// זה לא CSP מלא: script-src דורש nonce לכל סקריפט של Next ושל Cal.com, וזה
// שינוי גדול שלא נכנס לפני ההגשה. מה שכאן לא שובר שום סקריפט.
//
// Permissions-Policy: מצלמה ומיקרופון רק לדפים שלנו (הדיווח של המכונאי),
// ולא לשום iframe.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  // HTTPS בלבד, גם בתת-דומיינים (043). Vercel שולח כבר max-age, בלי includeSubDomains.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
]

// מספר הגרסה מ-package.json (4.10, v1.0.0). מוצג בתחתית מסכי הצוות וב-/api/version,
// כדי לענות תמיד על "איזו גרסה רצה עכשיו במוסך". ראו CHANGELOG.md.
const { version: APP_VERSION } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // מזהה של הבנייה, שנכנס גם לקוד שבדפדפן וגם לשרת. מסך שפתוח ימים (הטלוויזיה
  // בסדנה, בחדר ההמתנה) משווה אותו מול השרת לפני כל רענון, ואם השרת הוחלף —
  // טוען את הדף מחדש, במקום לערבב קוד ישן עם תוכן חדש (שגיאת React #418).
  env: { APP_BUILD: String(Date.now()), APP_VERSION },
  // לא לפרסם באיזו מסגרת האתר בנוי.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
  // הסרטון לבוחנים עבר לדף שלהם, עם ההנחיות הכתובות (6.10).
  async redirects() {
    return [{ source: "/training/video/exam", destination: "/training/exam", permanent: true }]
  },
}

export default nextConfig
