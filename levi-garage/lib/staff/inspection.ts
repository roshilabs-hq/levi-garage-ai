// בדיקת הכניסה הסטנדרטית: כל רכב עובר אותה בעמדת האבחון, לפני שהוא עולה לליפט.
//
// למה כאן ולא אצל המכונאים במעליות (27.9, מהמחקר): בכל המערכות בעולם הבדיקה
// המלאה נעשית פעם אחת, מוקדם, ולוקחת 15–20 דקות — יותר מדי לחלק בין שישה
// מכונאים שמתוגמלים על העבודה על הליפט. בעמדת האבחון הידיים נקיות יחסית,
// והרכב עוד לא פורק. המכונאים מתעדים רק מה שמתגלה תוך כדי עבודה.
//
// בלי תשלום (3.10, רועי): ללקוח זה שירות, ולמוסך זה המקור של רוב העבודות הנוספות.
// זה כתוב בקבלה, בהצעה ללקוח, במייל ובאתר.
//
// קצר בכוונה: תשעה פריטים, שלוש לחיצות אפשריות לכל אחד. "תבניות ארוכות" הן
// התלונה הראשונה של מכונאים על מערכות כאלה.

export type Light = "green" | "yellow" | "red"

export type InspectionItem = {
  key: string
  label: string
  /** מה לבדוק, במשפט אחד, למי שחדש בעמדה */
  hint: string
  /** ליקוי כאן הוא ליקוי בטיחותי (תקנה 6 בתקנות המוסכים) */
  safety: boolean
  /** מהמחירון: העבודה שכנראה תידרש, כדי שדניאל לא יחפש */
  suggest?: string
}

export const INSPECTION_ITEMS: InspectionItem[] = [
  { key: "brakes", label: "בלמים", hint: "עובי רפידות, מצב דיסקים, נוזל בלמים", safety: true, suggest: "brakes-front-pads" },
  { key: "tires", label: "צמיגים", hint: "עומק חריץ, בלאי לא אחיד, לחץ, סדקים", safety: true, suggest: "tire-one" },
  { key: "steering", label: "היגוי ומתלים", hint: "חופש בהגה, מפרקים, בולמים דולפים", safety: true, suggest: "shocks-front" },
  { key: "lights", label: "אורות", hint: "ראשיים, בלמים, איתות, רוורס", safety: true, suggest: "bulb-head" },
  { key: "fluids", label: "נוזלים", hint: "שמן מנוע, קירור, הגה, מגבים", safety: false },
  { key: "leaks", label: "דליפות", hint: "מתחת לרכב: שמן, מים, דלק", safety: false },
  { key: "battery", label: "מצבר וטעינה", hint: "מתח, קטבים, בדיקת עומס", safety: false, suggest: "battery" },
  { key: "wipers", label: "מגבים ושמשות", hint: "גומיות, סדקים בשמשה", safety: false, suggest: "wipers" },
  // 3.10: "קריאת תקלות שמורות" ולא "סריקת מחשב": זה חלק מהבדיקה החינמית, ולא
  // "אבחון מחשב" שבמחירון (250), שמוצא את הסיבה לתקלה.
  { key: "scan", label: "קריאת תקלות שמורות", hint: "תקלות שמורות במחשב ונורות בלוח", safety: false, suggest: "diag-scan" },
]

export const itemByKey = (key: string) => INSPECTION_ITEMS.find((i) => i.key === key)

export type InspectionState = Record<string, { light: Light; finding_id?: number | null }>

/** כמה פריטים סומנו, ואם כולם — אפשר לסיים. */
export function progress(items: InspectionState) {
  const done = INSPECTION_ITEMS.filter((i) => items[i.key]?.light).length
  return { done, total: INSPECTION_ITEMS.length, complete: done === INSPECTION_ITEMS.length }
}

/** מהשירות שנבחר בתור ב-Cal.com לעבודה במחירון. דניאל יכול להחליף בקבלה. */
export function serviceToCode(service: string | null): string {
  const s = service ?? ""
  if (s.includes("לפני קנייה")) return "pre-purchase"
  if (s.includes("טסט")) return "test-prep"
  if (s.includes("טיפול")) return "service-small"
  if (s.includes("בלם")) return "brakes-front-pads"
  if (s.includes("מיזוג") || s.includes("חשמל")) return "diag-scan"
  return "diag-scan"
}
