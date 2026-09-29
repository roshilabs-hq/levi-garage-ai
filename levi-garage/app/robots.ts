import type { MetadataRoute } from "next"

// אתר הדגמה לפרויקט גמר, על דומיין אמיתי (levi-garage.co.il). יש מוסכים אמיתיים
// עם "לוי" בשם, ולכן האתר לא אמור להופיע בחיפוש מולם. כל דף כבר מסומן noindex;
// זה הקו השני, למנועים שקוראים את robots.txt לפני שהם נכנסים.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } }
}
