// שעון מזויף לשרת הפיתוח, לצילומי "רכב אחד, שני מסכים" (flow.mjs).
// הסרטון עובר על יום אחד, מ-07:30 עד 14:46, והצילומים רצים ברצף בכל שעה. כדי שכל
// "נכנס ב-..." ו"כבר X דק'" במסך יתאימו לשעון בסרטון, השרת קורא את השעה מקובץ:
//   NODE_OPTIONS=--import=file:///.../fake-now.mjs  FAKE_NOW_FILE=...  next dev
// בקובץ: {"t": <הזמן המזויף, ms>, "at": <הזמן האמיתי שבו נכתב, ms>}. מכאן השעון ממשיך לזוז.
// רק בשרת המקומי של הצילום. האתר החי לא נוגע בזה.
import { readFileSync } from "node:fs"

// גם קובץ הסביבה של הצוות (STATION_SECRET, לבקשת החיבור בעמדה), ש-next dev לא טוען לבד.
// ‏--env-file אסור בתוך NODE_OPTIONS, ולכן נטען כאן. הערכים לא מודפסים.
if (process.env.EXTRA_ENV_FILE) process.loadEnvFile(process.env.EXTRA_ENV_FILE)

const FILE = process.env.FAKE_NOW_FILE
if (FILE) {
  const Real = Date
  let offset = 0
  let readAt = 0
  const now = () => {
    const r = Real.now()
    if (r - readAt > 250) {
      readAt = r
      try {
        const { t, at } = JSON.parse(readFileSync(FILE, "utf8"))
        offset = t - at
      } catch {
        offset = 0
      }
    }
    return Real.now() + offset
  }
  // פונקציה רגילה ולא class/Proxy: ב-proxy של Next נשברו כך Date.parse ו-Date.UTC.
  function FakeDate(...a) {
    if (!new.target) return new Real(now()).toString()
    return a.length === 0 ? new Real(now()) : new Real(...a)
  }
  FakeDate.prototype = Real.prototype
  FakeDate.now = now
  FakeDate.parse = Real.parse
  FakeDate.UTC = Real.UTC
  globalThis.Date = FakeDate
}
