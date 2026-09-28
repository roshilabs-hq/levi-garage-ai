import type { Metadata } from "next"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { redeemPairCode } from "../../actions"

export const metadata: Metadata = { title: "צימוד עמדה | מוסך לוי ובניו", robots: { index: false, follow: false } }

// הטלפון סרק את הקוד שדניאל יצר. כאן רק שואלים — המימוש הוא בלחיצה, כי מקדימי
// קישורים (וואטסאפ, אפליקציות מצלמה) פותחים את הכתובת לבד, וזה היה שורף את הקוד.

const WHY: Record<string, string> = {
  used: "הקוד הזה כבר שימש לחיבור מכשיר. כל קוד עובד פעם אחת.",
  expired: "הקוד פג (הוא תקף 10 דקות).",
  bad: "הקוד לא תקין.",
}

export default async function PairPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const { code } = await params
  const { e } = await searchParams
  const supabase = await createClient()
  const { data } = await supabase.rpc("pair_code_info", { p_code: code })
  const info = data as { ok: boolean; label?: string; reason?: string } | null
  const problem = e ?? (info?.ok ? null : (info?.reason ?? "bad"))

  return (
    <main className="station">
      <div className="station-box">
        {problem ? (
          <>
            <h1>אי אפשר לחבר עם הקוד הזה</h1>
            <p>{WHY[problem] ?? WHY.bad} מנהל העבודה יוצר קוד חדש במסך &quot;עמדות&quot;.</p>
            <Link className="btn" href="/station">למסך העמדה</Link>
          </>
        ) : (
          <>
            <p className="station-where">{info!.label}</p>
            <h1>לחבר את המכשיר הזה ל{info!.label}?</h1>
            <p>
              מעכשיו המכשיר הזה שייך לעמדה, לא לאדם. המכונאים נכנסים בו בשם ובקוד של 6 ספרות. אם מישהו מחובר כאן — הוא
              יתנתק.
            </p>
            <form action={redeemPairCode}>
              <input type="hidden" name="code" value={code} />
              <button className="btn big" type="submit">לחבר את המכשיר הזה</button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
