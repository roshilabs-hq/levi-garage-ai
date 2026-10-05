// התוכן של המדריך, מחובר למיקומים מהצילום האחרון. ההתאמה עצמה ב-match.ts.

import { ROLES } from "./guide"
import hotspots from "./hotspots.json"
import { matchGuide, type Shot } from "./match"

export type { ResolvedRole, ResolvedScreen, ResolvedSpot } from "./match"

export const resolveGuide = () => matchGuide(ROLES, hotspots as Record<string, Shot>)
