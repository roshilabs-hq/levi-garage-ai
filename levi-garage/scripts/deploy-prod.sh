#!/usr/bin/env bash
# פריסה ידנית של האתר (levi-garage) לייצור, מהמחשב. רק האתר: לא הבוט, לא משתני סביבה, לא מיגרציות.
#
# הדרך הרגילה היא כבר לא זו: כל דחיפה ל-main שנוגעת באתר נפרסת לבד מ-GitHub
# (.github/workflows/deploy-site.yml). הסקריפט נשאר לגיבוי, כשצריך לפרוס בלי לדחוף.
#
# ב-Vercel מוגדר Root Directory = levi-garage (2.10), ולכן מריצים משורש המאגר,
# ו-.vercelignore שבשורש משאיר בחוץ את כל השאר, כולל קבצי .env המקומיים.
# שתי המלכודות של המחשב הזה מטופלות כאן:
#  - VERCEL_TOKEN ישן בסביבה גובר על ההתחברות של ה-CLI
#  - שם המחשב בעברית שובר את כותרות ה-HTTP של Vercel (ascii-hostname.cjs)
set -euo pipefail
cd "$(dirname "$0")/.."
# ב-Git Bash ‏pwd מחזיר /c/...; ‏Node ב-Windows צריך C:/..., ולכן pwd -W כשיש
export NODE_OPTIONS="--require $(pwd -W 2>/dev/null || pwd)/scripts/ascii-hostname.cjs"
cd ..
unset VERCEL_TOKEN
# הפרויקט במפורש, כדי שה-CLI לא יציע לקשר את שורש המאגר לפרויקט חדש.
export VERCEL_ORG_ID=team_jPmGFy97S4lNbWq3qoNJUYqx
export VERCEL_PROJECT_ID=prj_BJKdF77HQ0Vq8yDAwTOI2XIuqAAZ
npx vercel --prod --yes
