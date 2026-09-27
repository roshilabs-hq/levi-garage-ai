import Link from "next/link"

import type { Dict } from "@/lib/site/dict"
import { ThemeToggle } from "@/components/site/theme-toggle"

export function SiteFooter({ t }: { t: Dict }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot">
          <div>
            <span className="brand"><b>{t.lang === "he" ? "מוסך לוי ובניו" : t.lang === "ar" ? "كراج ليفي وأبناؤه" : "Гараж Леви и сыновья"}</b></span>
            <p>{t.footer.tagline}</p>
          </div>
          <ul>
            <li><Link href="/privacy">{t.footer.privacy}</Link></li>
            <li><Link href="/accessibility">{t.footer.accessibility}</Link></li>
            <li><Link href="/terms">{t.footer.terms}</Link></li>
            <li>
              <ThemeToggle labels={{ light: t.footer.themeLight, dark: t.footer.themeDark }} />
            </li>
          </ul>
        </div>
        <p className="demo-note">{t.footer.demo}</p>
      </div>
    </footer>
  )
}
