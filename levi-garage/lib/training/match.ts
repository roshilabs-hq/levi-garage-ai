// מחבר בין התוכן (guide.ts) לבין המיקומים שנרשמו בצילום (hotspots.json): לכל הסבר,
// הכפתור שלו בתמונה, באחוזים מגודל התמונה. כפתור שלא נמצא לא מוצג, ונרשם ב-missing.
//
// בלי imports בכוונה: הבדיקה (test/training.mjs) מריצה את הקובץ ישר ב-node.

type Spot = { m?: string; tag?: string; nth?: number; box?: { x: number; y: number; w: number; h: number }; t: string; b: string }
type Role = { id: string; name: string; who: string; why: string; screens: { id: string; title: string; intro: string; spots: Spot[] }[] }
type Item = { text: string; tag: string; x: number; y: number; w: number; h: number }
export type Shot = { width: number; height: number; items: Item[] }

export type ResolvedSpot = { n: number; t: string; b: string; x: number; y: number; w: number; h: number }
export type ResolvedScreen = { id: string; title: string; intro: string; width: number; height: number; spots: ResolvedSpot[] }
export type ResolvedRole = { id: string; name: string; who: string; why: string; screens: ResolvedScreen[] }

const pct = (v: number, of: number) => Math.round((v / of) * 10000) / 100

function locate(spot: Spot, shot: Shot, used: Set<Item>): Item | null {
  if (spot.box) return { text: "", tag: "box", ...spot.box }
  let seen = 0
  for (const it of shot.items) {
    if (used.has(it)) continue
    if (spot.tag && it.tag !== spot.tag) continue
    if (spot.m && !it.text.startsWith(spot.m)) continue
    if (seen === (spot.nth ?? 0)) return it
    seen++
  }
  return null
}

export function matchGuide(source: Role[], all: Record<string, Shot>) {
  const missing: string[] = []
  const roles: ResolvedRole[] = source.map((role) => ({
    ...role,
    screens: role.screens
      .filter((s) => {
        if (!all[s.id]) missing.push(`${s.id}: אין צילום`)
        return Boolean(all[s.id])
      })
      .map((s) => {
        const shot = all[s.id]
        const used = new Set<Item>()
        const spots: ResolvedSpot[] = []
        for (const spot of s.spots) {
          const it = locate(spot, shot, used)
          if (!it) {
            missing.push(`${s.id}: ${spot.m ?? spot.tag ?? spot.t}`)
            continue
          }
          if (it.tag !== "box") used.add(it)
          // כפתור שחתוך בקצה הצילום: הנקודה רק על החלק שנראה.
          const x0 = Math.max(0, it.x)
          const y0 = Math.max(0, it.y)
          const x1 = Math.min(shot.width, it.x + it.w)
          const y1 = Math.min(shot.height, it.y + it.h)
          spots.push({
            n: spots.length + 1, t: spot.t, b: spot.b,
            x: pct(x0, shot.width), y: pct(y0, shot.height), w: pct(x1 - x0, shot.width), h: pct(y1 - y0, shot.height),
          })
        }
        return { id: s.id, title: s.title, intro: s.intro, width: shot.width, height: shot.height, spots }
      }),
  }))
  return { roles, missing }
}
