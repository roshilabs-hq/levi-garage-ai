import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { INSPECTION_ITEMS, progress, type InspectionState } from "@/lib/staff/inspection"
import { TopBar } from "@/components/staff/top-bar"
import { AutoRefresh } from "@/components/staff/auto-refresh"
import { CaptureButton } from "@/components/staff/capture-button"
import { AddPhoto } from "@/components/staff/add-photo"
import { Mentor } from "@/components/staff/mentor"
import { completeInspection, setInspectionItem } from "../../actions"

export const metadata: Metadata = { title: "אבחון | מוסך לוי ובניו", robots: { index: false, follow: false } }

// האבחון, על הליפט (רועי, 28.9): הראשון והאחרון, ואחריו עובדים. תשעה פריטים,
// שלושה צבעים. ירוק — לחיצה אחת וזהו.
// צהוב או אדום — צילום ודיבור, ודניאל מקבל טיוטה עם העבודה שכנראה תידרש.

const LIGHTS = [
  { key: "green", label: "תקין" },
  { key: "yellow", label: "לשים לב" },
  { key: "red", label: "לתקן" },
] as const

export default async function InspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const staff = await requireStaff()
  const { id } = await params
  const { e } = await searchParams
  const jobId = Number(id)
  if (!Number.isFinite(jobId)) notFound()

  const supabase = await createClient()
  const [{ data: job }, { data: ins }, { data: findings }] = await Promise.all([
    supabase.from("job_cards").select("id, plate, vehicle_make, vehicle_model, vehicle_year, inspected_at").eq("id", jobId).maybeSingle(),
    supabase.from("inspections").select("items, completed_at").eq("job_card_id", jobId).maybeSingle(),
    supabase.from("findings").select("id, title, status, media(kind)").eq("job_card_id", jobId).eq("source", "intake"),
  ])
  if (!job) notFound()

  const items = (ins?.items as InspectionState) ?? {}
  const byId = new Map((findings ?? []).map((f) => [f.id, f]))
  const p = progress(items)
  const undocumented = INSPECTION_ITEMS.filter((i) => {
    const s = items[i.key]
    return (s?.light === "yellow" || s?.light === "red") && !s.finding_id
  })

  return (
    <main className="staff-wrap inspect-page">
      <TopBar staff={staff} current="lift" />
      <AutoRefresh seconds={30} live />

      <header className="staff-top">
        <div>
          <Link className="staff-back" href="/staff/lift">חזרה לעמדה</Link>
          <h1>
            אבחון · <span className="plate-chip num" dir="ltr">{job.plate}</span>
          </h1>
          <p>
            {[job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "רכב"}
            {job.vehicle_year ? `, ${job.vehicle_year}` : ""} · {p.done} מתוך {p.total} נבדקו
          </p>
        </div>
      </header>

      <Mentor jobId={jobId} />

      {job.inspected_at && <p className="staff-note">האבחון הסתיים. אפשר לעבוד לפי מה שאושר.</p>}
      {e === "incomplete" && (
        <p className="staff-error" role="alert">
          כל תשעת הפריטים צריכים צבע, וכל צהוב או אדום צריך צילום ודיבור. חסר עוד.
        </p>
      )}

      <ol className="inspect-list">
        {INSPECTION_ITEMS.map((item) => {
          const state = items[item.key]
          const light = state?.light
          const fid = state?.finding_id ?? null
          return (
            <li key={item.key} className={`inspect-item ${light ?? "none"}`}>
              <div className="inspect-head">
                <b>{item.label}</b>
                {item.safety && <span className="inspect-safety">בטיחות</span>}
                <span className="staff-meta">{item.hint}</span>
              </div>

              <div className="inspect-lights" role="group" aria-label={`${item.label}: מצב`}>
                {LIGHTS.map((l) => (
                  <form key={l.key} action={setInspectionItem}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="item" value={item.key} />
                    <input type="hidden" name="light" value={l.key} />
                    <button
                      type="submit"
                      className={`light-btn ${l.key}${light === l.key ? " on" : ""}`}
                      aria-pressed={light === l.key}
                    >
                      {l.label}
                    </button>
                  </form>
                ))}
              </div>

              {(light === "yellow" || light === "red") &&
                (fid ? (
                  <div className="inspect-done">
                    <p>נרשם: {byId.get(fid)?.title ?? "ממצא"}. דניאל קיבל.</p>
                    {/* עוד תמונה לאותו פריט, כל עוד דניאל לא שלח ללקוח */}
                    {byId.get(fid)?.status === "draft" && (
                      <AddPhoto
                        findingId={fid}
                        missing={!(byId.get(fid)?.media ?? []).some((m) => m.kind === "photo")}
                      />
                    )}
                  </div>
                ) : (
                  <CaptureButton
                    jobId={job.id}
                    item={{ key: item.key, light }}
                    label="לצלם ולהגיד מה ראית"
                    size="small"
                    requirePhoto={light === "red" || item.safety}
                  />
                ))}
            </li>
          )
        })}
      </ol>

      <form action={completeInspection} className="inspect-finish">
        <input type="hidden" name="job_id" value={job.id} />
        <button className="btn" type="submit" disabled={!p.complete || undocumented.length > 0 || Boolean(job.inspected_at)}>
          סיום אבחון · לעבודה שאושרה
        </button>
        {!p.complete && <span className="staff-meta">עוד {p.total - p.done} פריטים.</span>}
        {p.complete && undocumented.length > 0 && (
          <span className="staff-meta">חסר צילום ודיבור ל: {undocumented.map((i) => i.label).join(", ")}.</span>
        )}
      </form>
    </main>
  )
}
