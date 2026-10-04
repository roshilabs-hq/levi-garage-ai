import "../../staff.css"

import { PendingSubmit } from "@/components/staff/pending-submit"
import { ReportBug } from "@/components/staff/report-bug"

// אזור הצוות יושב באותה אפליקציה ובאותה שפה עיצובית, אבל בלי הכותרת והתחתית
// של האתר הציבורי: זה מסך עבודה שפתוח כל היום על טלפון בכיס או על מסך בדלפק.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PendingSubmit />
      {children}
      {/* איזו גרסה רצה עכשיו במוסך, ודיווח על תקלה (4.10). השינויים בכל גרסה: CHANGELOG.md בריפו. */}
      <ReportBug version={process.env.APP_VERSION ?? ""} />
    </>
  )
}
