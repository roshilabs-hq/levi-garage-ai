import { GEM_URL } from "@/lib/staff/gem"

// כפתור ל"מוסכניק הוותיק" (פתרון 1), בכל מסך שהמכונאי עובד בו. נפתח בטאב חדש,
// כדי שהמכונאי לא יאבד את המקום שלו בעמדה. באפליקציית Gemini אפשר לדבר אליו בקול.
export function GemLink({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`gem-link${compact ? " compact" : ""}`} href={GEM_URL} target="_blank" rel="noreferrer">
      <span aria-hidden>🧰</span>
      <span>
        <b>לשאול את המוסכניק הוותיק</b>
        {!compact && <small>שאלה מקצועית, בעברית, בערבית או ברוסית. אפשר בקול.</small>}
      </span>
    </a>
  )
}
