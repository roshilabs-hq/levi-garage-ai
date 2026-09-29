import "../../staff.css"

import { PendingSubmit } from "@/components/staff/pending-submit"

// מכשיר העמדה שעל המתקן. אותו עיצוב כמו מסכי הצוות, בלי ניווט.
export default function StationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PendingSubmit />
      {children}
    </>
  )
}
