"use client"

import { usePathname } from "next/navigation"

// תחתית כל מסך צוות: הגרסה, ודרך אחת לדווח על תקלה (רועי, 4.10). צילום מסך
// במייל של המוסך, ורועי מטפל ועונה. הנושא כבר כולל את הגרסה ואת המסך, כדי שלא
// יצטרכו לשאול "איפה זה קרה". זמני התגובה: הסכם השירות, סעיף 7.1.
const SUPPORT_EMAIL = "roshinovic2@gmail.com"

export function ReportBug({ version }: { version: string }) {
  const path = usePathname()
  const subject = `תקלה · גרסה ${version} · ${path}`
  const body = ["מה ניסיתי לעשות:", "", "מה קרה במקום:", "", "(לצרף צילום מסך)"].join("\n")
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <p className="staff-version">
      גרסה {version} · <a href={href}>נתקלתם בתקלה? צלמו את המסך ושלחו לנו</a> ·{" "}
      {/* בכרטיסייה חדשה: במכשיר של העמדה, המסך של הליפט נשאר פתוח מאחור. */}
      <a href={`/training/${path.startsWith("/station") || path.startsWith("/staff/lift") || path.startsWith("/staff/inspect") ? "workers" : "owners"}`} target="_blank" rel="noopener">
        מרכז ההדרכה
      </a>
    </p>
  )
}
