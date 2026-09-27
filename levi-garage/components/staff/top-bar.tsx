import Link from "next/link"

import { signOut } from "@/app/(he)/staff/actions"
import { stationSwitch } from "@/app/(he)/station/actions"
import { roleLabel, type StaffMember } from "@/lib/staff/session"
import { ThemeToggle } from "@/components/site/theme-toggle"

// פס עליון אחד לכל מסכי הצוות, כדי שתמיד יהיה ברור מי מחובר ואיך חוזרים.
// המכונאי לא צריך ציים ומדדים, ולכן הוא לא רואה אותם.

export function TopBar({
  staff,
  current,
}: {
  staff: StaffMember
  current: "board" | "floor" | "wall" | "lift" | "fleets" | "dashboard" | "stations" | "other"
}) {
  const links: { href: string; label: string; key: string }[] = [
    { href: "/staff", label: "לוח היום", key: "board" },
    // גם מכונאי רואה את המפה: היא עונה לו על "איפה יש ליפט פנוי" בלי לשאול.
    { href: "/staff/floor", label: "מפת המוסך", key: "floor" },
    ...(staff.role === "mechanic" ? [{ href: "/staff/lift", label: "הליפט שלי", key: "lift" }] : []),
    ...(staff.role !== "mechanic"
      ? [
          { href: "/staff/fleets", label: "ציים", key: "fleets" },
          { href: "/staff/dashboard", label: "מדדים", key: "dashboard" },
          { href: "/staff/stations", label: "עמדות", key: "stations" },
        ]
      : []),
    // לוח הסדנה לא יושב כאן בכוונה: פותחים אותו פעם אחת על הטלוויזיה
    // ומשאירים, ולשם כך יש את דף המסכים. פס ניווט בטלפון צריך להישאר קצר.
  ]

  return (
    <div className="topbar">
      <nav className="topbar-links" aria-label="ניווט אזור הצוות">
        {links.map((l) => (
          <Link key={l.key} href={l.href} aria-current={current === l.key ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="topbar-me">
        <span>
          {staff.full_name}
          <small>
            {roleLabel[staff.role]}
            {staff.role === "mechanic" ? (staff.lift ? ` · ליפט ${staff.lift}` : " · עמדת אבחון") : ""}
          </small>
        </span>
        <ThemeToggle compact />
        {/* מכונאי נכנס רק מעמדה קבועה (016), ולכן היציאה שלו מחזירה את העמדה
            לרשימת השמות, לעובד הבא. */}
        <form action={staff.role === "mechanic" ? stationSwitch : signOut}>
          <button type="submit">{staff.role === "mechanic" ? "החלפת עובד" : "יציאה"}</button>
        </form>
      </div>
    </div>
  )
}
