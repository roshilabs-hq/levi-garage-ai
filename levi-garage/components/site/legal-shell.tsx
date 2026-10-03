import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { ReturnBar } from "@/components/site/return-bar"
import { dicts } from "@/lib/site/dict"

// דפי המדיניות נפתחים מהתחתית, ומי שקורא אותם עד הסוף צריך דרך ברורה חזרה.
// בלי הקישור הזה, הדרך היחידה הייתה לנחש שהשם "מוסך לוי ובניו" בכותרת הוא קישור.
function BackHome() {
  return (
    <Link className="legal-back" href="/">
      <ArrowRight aria-hidden size={18} />
      חזרה לדף הבית
    </Link>
  )
}

export function LegalShell({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  const t = dicts.he
  return (
    <>
      <SiteHeader t={t} overPhoto={false} />
      <main id="main" className="wrap legal">
        <ReturnBar />
        <BackHome />
        <h1>{title}</h1>
        {updated && <p className="updated">עודכן לאחרונה: {updated}</p>}
        {children}
        <p className="legal-end">
          <BackHome />
        </p>
      </main>
      <SiteFooter t={t} />
    </>
  )
}
