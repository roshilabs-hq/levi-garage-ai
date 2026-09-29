// הלוגו של מוסך לוי ובניו: לוחית רישוי ישראלית (רועי, 29.9, כיוון ב').
// הלוחית הצהובה כבר חוזרת בכל מסך במערכת — בלוח, בליפט, במסך הסדנה — ולכן
// הלוגו הוא אותה לוחית, עם השם במקום המספר.
//
// גרסת שחור-לבן להדפסה: לוחית צהובה יוצאת אפורה במדפסת, ולכן בהצעה המודפסת
// הלוחית לבנה עם מסגרת שחורה.

type Lang = "he" | "ar" | "ru"

const NAME: Record<Lang, string> = { he: "לוי ובניו", ar: "ليفي وأبناؤه", ru: "Леви и сыновья" }
const LINE: Record<Lang, string> = { he: "מוסך · מאז 1998", ar: "كراج · منذ 1998", ru: "ГАРАЖ · С 1998" }
const LABEL: Record<Lang, string> = { he: "מוסך לוי ובניו", ar: "كراج ليفي وأبناؤه", ru: "Гараж Леви и сыновья" }

export function PlateLogo({
  lang = "he",
  height = 44,
  mono = false,
  className,
}: {
  lang?: Lang
  height?: number
  mono?: boolean
  className?: string
}) {
  const fill = mono ? "#ffffff" : "#f2c230"
  const strip = mono ? "#111214" : "#1c3f8f"
  const nameSize = lang === "ru" ? 30 : 42
  return (
    <svg
      className={className}
      height={height}
      viewBox="0 0 300 90"
      role="img"
      aria-label={LABEL[lang]}
      style={{ width: "auto", display: "block" }}
    >
      <rect x="2" y="2" width="296" height="86" rx="10" fill={fill} stroke="#111214" strokeWidth="3" />
      <rect x="248" y="5" width="47" height="80" rx="7" fill={strip} />
      <text x="271.5" y="40" textAnchor="middle" fontFamily="var(--font-body), Assistant, sans-serif" fontWeight="800" fontSize="15" fill="#fff">
        IL
      </text>
      <text x="271.5" y="62" textAnchor="middle" fontFamily="var(--font-body), Assistant, sans-serif" fontWeight="800" fontSize="12" fill="#fff">
        {lang === "he" ? "ישראל" : lang === "ar" ? "إسرائيل" : "ISRAEL"}
      </text>
      <text
        x="126"
        y={lang === "ru" ? 50 : 54}
        textAnchor="middle"
        fontFamily="var(--font-display), 'Frank Ruhl Libre', serif"
        fontWeight="900"
        fontSize={nameSize}
        fill="#111214"
      >
        {NAME[lang]}
      </text>
      <text x="126" y="76" textAnchor="middle" fontFamily="var(--font-body), Assistant, sans-serif" fontWeight="800" fontSize="12.5" fill="#111214" letterSpacing="1.5">
        {LINE[lang]}
      </text>
    </svg>
  )
}
