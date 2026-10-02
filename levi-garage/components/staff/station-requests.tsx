import { createClient } from "@/lib/supabase/server"
import { approveStationRequest, declineStationRequest } from "@/app/(he)/station/actions"

// הצד של דניאל ב"חיבור הפוך" (032): מכשירים שמבקשים להיות עמדה. מופיע בלוח
// היום (שמתרענן לבד כשמכשיר מבקש) ובמסך העמדות. רק מנהל העבודה והבעלים.

type Req = { id: string; code: string; created_at: string; expires_at: string }

const minutesLeft = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000))

export async function StationRequests({ variant = "board" }: { variant?: "board" | "page" }) {
  const supabase = await createClient()
  const { data } = await supabase.rpc("open_station_requests")
  const rows = (data ?? []) as Req[]
  if (rows.length === 0) return null

  const { data: stations } = await supabase.from("stations").select("lift").is("revoked_at", null)
  const taken = new Set((stations ?? []).map((s) => (s.lift === null ? "diag" : String(s.lift))))
  const options = [
    ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: `ליפט ${n}` })),
    { value: "diag", label: "עמדת האבחון" },
  ]

  return (
    <section className={variant === "board" ? "board-group hot" : "staff-section"} aria-labelledby="g-station-req">
      <h2 id="g-station-req">{rows.length === 1 ? "מכשיר מבקש להיות עמדה" : `${rows.length} מכשירים מבקשים להיות עמדה`}</h2>
      <p className="board-why">
        לאשר רק אם המספר זהה למה שרואים על המסך של המכשיר שליד הליפט. בקשה שלא מכירים, או שנפתחה בטעות: &quot;לא לאשר&quot;, והיא יורדת מכאן.
      </p>
      <ul className="board-rows">
        {rows.map((r) => (
          <li key={r.id} className="station-req-row">
            <span className="station-req-chip num" dir="ltr">
              {r.code}
            </span>
            <div>
              <b>מכשיר {r.code} מבקש להיות עמדה</b>
              <span className="staff-meta">פג בעוד {minutesLeft(r.expires_at)} דק&apos;</span>
            </div>
            <form action={approveStationRequest} className="pair-form">
              <input type="hidden" name="id" value={r.id} />
              <select name="lift" defaultValue="" required aria-label={`איזו עמדה זה מכשיר ${r.code}`}>
                <option value="" disabled>
                  איזה ליפט?
                </option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                    {taken.has(o.value) ? " · כבר יש שם עמדה" : ""}
                  </option>
                ))}
              </select>
              <button className="btn" type="submit">
                לאשר
              </button>
            </form>
            <form action={declineStationRequest}>
              <input type="hidden" name="id" value={r.id} />
              <button className="btn quiet" type="submit">
                לא לאשר
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}
