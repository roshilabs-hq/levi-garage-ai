"use client"

import { useEffect } from "react"

// פותח את חלון ההדפסה פעם אחת, כשהדף נטען אחרי "להדפסה". בלי זה דניאל היה
// צריך לחפש Ctrl+P, מול לקוח שמחכה בדלפק.
export function AutoPrint({ when }: { when: boolean }) {
  useEffect(() => {
    if (when) setTimeout(() => window.print(), 300)
  }, [when])
  return null
}

export function PrintButton() {
  return (
    <button type="button" className="btn quiet" onClick={() => window.print()}>
      הדפסה
    </button>
  )
}
