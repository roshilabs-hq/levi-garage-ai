import "../../staff.css"

import { PendingSubmit } from "@/components/staff/pending-submit"
import { ReportBug } from "@/components/staff/report-bug"

// מכשיר העמדה שעל המתקן. אותו עיצוב כמו מסכי הצוות, בלי ניווט.
export default function StationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PendingSubmit />
      {children}
      {/* 1.2.0: גם בכניסה לעמדה, הגרסה ודיווח על תקלה, כמו בכל מסכי הצוות. */}
      <ReportBug version={process.env.APP_VERSION ?? ""} />
    </>
  )
}
