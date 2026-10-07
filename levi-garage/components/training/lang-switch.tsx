// בורר שפת ההדרכה (7.10): עברית · العربية · Русский. קישורים רגילים עם ?lang=, כדי שכל דף
// אפשר לשלוח לעובד כמו שהוא, בשפה שלו.

import Link from "next/link"

import { GLANGS, UI, withLang, type GLang } from "@/lib/training/i18n-ui"

export function LangSwitch({ href, lang }: { href: string; lang: GLang }) {
  return (
    <nav className="tl-langs" aria-label={UI[lang].langs}>
      <span className="tl-label">{UI[lang].langs}:</span>
      {GLANGS.map((l) => (
        <Link key={l.id} href={withLang(href, l.id)} lang={l.id} aria-current={l.id === lang ? "page" : undefined} className={l.id === lang ? "on" : ""}>
          {l.label}
        </Link>
      ))}
      {UI[lang].buttonsNote && <span className="tl-note">{UI[lang].buttonsNote}</span>}
    </nav>
  )
}
