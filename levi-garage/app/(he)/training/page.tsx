import type { Metadata } from "next"

import "./training.css"
import { SiteFooter } from "@/components/site/footer"
import { SiteHeader } from "@/components/site/header"
import { TrainingGuide } from "@/components/training/guide"
import { dicts } from "@/lib/site/dict"
import { resolveGuide } from "@/lib/training/resolve"

export const metadata: Metadata = {
  title: "מרכז ההדרכה | מוסך לוי ובניו",
  description: "כל מסך במערכת של המוסך, וכל כפתור בו: מה הוא עושה, ומה קורה אחרי שלוחצים.",
}

// מרכז ההדרכה (5.10): המדריך האינטראקטיבי לכל תפקיד. הצילומים מהמערכת החיה, עם
// נתוני הדגמה ושמות בדויים. אותו עמוד יקבל בהמשך גם את סרטוני ההדרכה, עם פרקים.
export default function TrainingPage() {
  const t = dicts.he
  const { roles } = resolveGuide()
  const screens = roles.reduce((a, r) => a + r.screens.length, 0)
  return (
    <>
      <SiteHeader t={t} overPhoto={false} />
      <main id="main" className="wrap training">
        <h1>מרכז ההדרכה</h1>
        <p className="training-lead">
          כל מסך במערכת, וכל כפתור בו: מה הוא עושה, ומה קורה אחרי שלוחצים. {screens} מסכים, מצולמים מהמערכת החיה. בוחרים תפקיד, ולוחצים על
          מספר בתמונה או ברשימה.
        </p>
        <TrainingGuide roles={roles} />
      </main>
      <SiteFooter t={t} />
    </>
  )
}
