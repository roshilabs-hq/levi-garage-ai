"""בונה את service-agreement.pdf מתוך service-agreement.md.

המקור היחיד הוא קובץ ה-markdown. הסקריפט ממיר אותו ל-HTML מעוצב (A4, מימין לשמאל,
הגופנים והלוגו של האתר), ו-Chrome במצב headless מדפיס אותו ל-PDF.

הרצה, מתיקיית השורש של הריפו:
    python 04-empower/pdf/build_agreement.py
"""

import html
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "04-empower" / "service-agreement.md"
HTML_OUT = ROOT / "04-empower" / "pdf" / "service-agreement.html"
PDF_OUT = ROOT / "04-empower" / "service-agreement.pdf"
LOGO = ROOT / "levi-garage" / "public" / "brand" / "logo-plate.png"
CHROME = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
]


def inline(text: str) -> str:
    """markdown בתוך שורה: **מודגש** ו-*ציטוט*. כל השאר עובר escape."""
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r'<q class="quote">\1</q>', t)
    return t


def cells(row: str) -> list[str]:
    return [c.strip() for c in row.strip().strip("|").split("|")]


def table(rows: list[str]) -> str:
    head, body = cells(rows[0]), [cells(r) for r in rows[2:]]
    out = ['<table><thead><tr>']
    out += [f"<th>{inline(c)}</th>" for c in head]
    out.append("</tr></thead><tbody>")
    for r in body:
        cls = ' class="total"' if r and "סך הכול" in r[0] else ""
        out.append(f"<tr{cls}>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def signatures(rows: list[str]) -> str:
    """טבלת החתימות שבסוף ההסכם הופכת לשתי תיבות חתימה."""
    body = [cells(r) for r in rows[2:]]
    names = {r[0]: r[1:] for r in body}
    heads = cells(rows[0])[1:]
    boxes = []
    for i, who in enumerate(heads):
        boxes.append(
            f'<div class="sig"><div class="sig-who">{inline(who)}</div>'
            f'<div class="sig-name">{inline(names["שם"][i])}</div>'
            '<div class="sig-line"><span>חתימה</span></div>'
            '<div class="sig-line"><span>תאריך</span></div></div>'
        )
    return '<div class="sigs">' + "".join(boxes) + "</div>"


def parties(lines: list[str]) -> str:
    """"בין", "לבין" ו"תאריך" שבראש ההסכם, כתיבה מסודרת."""
    items = []
    for ln in lines:
        m = re.match(r"\*\*(.+?):\*\*\s*(.*)", ln)
        if m:
            items.append(f'<div class="party"><span class="party-k">{m.group(1)}</span>'
                         f'<span class="party-v">{inline(m.group(2))}</span></div>')
    return '<section class="parties">' + "".join(items) + "</section>"


def convert(md: str) -> tuple[str, str]:
    lines = md.splitlines()
    title = lines[0].lstrip("# ").strip()
    body: list[str] = []
    i = 1
    head_lines = []
    while i < len(lines) and lines[i].strip() != "---":
        if lines[i].strip():
            head_lines.append(lines[i].strip())
        i += 1
    body.append(parties(head_lines))

    in_list = False
    sign_next = False
    while i < len(lines):
        ln = lines[i].rstrip()
        s = ln.strip()
        if in_list and not s.startswith("- "):
            body.append("</ul>")
            in_list = False
        if not s or s == "---":
            i += 1
            continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            body.append(signatures(rows) if sign_next else table(rows))
            continue
        m = re.match(r"##\s+(\d+)\.\s+(.*)", s)
        if m:
            body.append(f'<h2><span class="num">{m.group(1)}</span>{inline(m.group(2))}</h2>')
        elif s.startswith("- "):
            if not in_list:
                body.append("<ul>")
                in_list = True
            body.append(f"<li>{inline(s[2:])}</li>")
        elif (m := re.match(r"(\d+\.\d+)\.\s+(.*)", s)):
            body.append(f'<p class="clause"><span class="cn">{m.group(1)}</span>'
                        f'<span class="ct">{inline(m.group(2))}</span></p>')
        elif s.startswith("**ולראיה"):
            body.append(f'<p class="witness">{inline(s)}</p>')
            sign_next = True
        else:
            body.append(f"<p>{inline(s)}</p>")
        i += 1
    if in_list:
        body.append("</ul>")
    return title, "\n".join(body)


CSS = """
@page {
  size: A4;
  margin: 20mm 17mm 20mm;
  @bottom-center { content: "עמוד " counter(page) " מתוך " counter(pages); font: 600 8.5pt Assistant, sans-serif; color: #8a8a86; }
  @top-left { content: "הסכם הקמה, הטמעה ושירות · מוסך לוי ובניו"; font: 600 8pt Assistant, sans-serif; color: #8a8a86; }
}
@page:first { @top-left { content: none; } }
:root { --ink: #111214; --muted: #55565a; --line: #d8d8d4; --soft: #f5f5f2; --brand: #f2c230; --blue: #1f3f94; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Assistant, sans-serif; font-size: 10.5pt; line-height: 1.6; color: var(--ink); }

.cover { display: flex; align-items: center; justify-content: space-between; gap: 18px;
  padding-bottom: 14px; border-bottom: 3px solid var(--ink); }
.cover h1 { font-family: "Frank Ruhl Libre", serif; font-weight: 900; font-size: 25pt; line-height: 1.15; margin: 0; }
.cover .sub { margin: 6px 0 0; color: var(--muted); font-size: 10.5pt; }
.cover img { height: 56px; flex: none; }

.parties { margin: 16px 0 6px; padding: 12px 16px; background: var(--soft); border-inline-start: 5px solid var(--brand); border-radius: 4px; }
.party { display: grid; grid-template-columns: 4.2em 1fr; gap: 10px; padding: 3px 0; }
.party-k { font-weight: 800; }

h2 { display: flex; align-items: center; gap: 10px; margin: 22px 0 8px; padding-bottom: 5px;
  border-bottom: 1px solid var(--line); font-family: "Frank Ruhl Libre", serif; font-weight: 700; font-size: 14.5pt;
  break-after: avoid; }
h2 .num { display: inline-grid; place-items: center; width: 1.7em; height: 1.7em; border-radius: 5px;
  background: var(--brand); border: 1.5px solid var(--ink); font-family: Assistant, sans-serif; font-weight: 800; font-size: 10.5pt; }
p { margin: 6px 0; }
.clause { display: grid; grid-template-columns: 2.6em 1fr; gap: 6px; break-inside: avoid; }
/* פסקה שמציגה טבלה לא נשארת לבד בתחתית העמוד */
p:has(+ table), p:has(+ ul) { break-after: avoid; }
.cn { font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
ul { margin: 4px 0 8px; padding-inline-start: 3.9em; }
li { margin: 2px 0; }
strong { font-weight: 800; }
q.quote { quotes: none; font-family: "Frank Ruhl Libre", serif; font-weight: 500; }

table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.5pt; line-height: 1.45; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { background: var(--ink); color: #fff; font-weight: 700; text-align: start; padding: 6px 8px; }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:nth-child(even) td { background: var(--soft); }
tr.total td { background: #fff5d1 !important; border-top: 2px solid var(--ink); }

.witness { margin-top: 26px; break-after: avoid; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 10px; break-inside: avoid; }
.sig { border: 1.5px solid var(--ink); border-radius: 6px; padding: 12px 16px 26px; }
.sig-who { font-family: "Frank Ruhl Libre", serif; font-weight: 700; font-size: 13pt; }
.sig-name { color: var(--muted); margin-bottom: 10px; }
.sig-line { margin-top: 38px; border-bottom: 1px solid var(--ink); position: relative; height: 1px; }
.sig-line span { position: absolute; top: 4px; inset-inline-start: 0; font-size: 8.5pt; color: var(--muted); }
"""


def main() -> None:
    title, body = convert(SRC.read_text(encoding="utf-8"))
    logo = LOGO.resolve().as_uri()
    doc = f"""<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&family=Frank+Ruhl+Libre:wght@500;700;900&display=block">
<style>{CSS}</style></head>
<body>
<header class="cover">
  <div><h1>{html.escape(title)}</h1>
  <p class="sub">ארבעה פתרונות ואתר, שעובדים יחד במוסך לוי ובניו</p></div>
  <img src="{logo}" alt="מוסך לוי ובניו">
</header>
{body}
</body></html>"""
    HTML_OUT.write_text(doc, encoding="utf-8")

    chrome = next((c for c in CHROME if c.exists()), None)
    if not chrome:
        raise SystemExit("לא נמצא Chrome או Edge")
    subprocess.run([str(chrome), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--virtual-time-budget=10000", f"--print-to-pdf={PDF_OUT}",
                    HTML_OUT.resolve().as_uri()], check=True, capture_output=True)
    print(f"נבנה: {PDF_OUT.relative_to(ROOT)} ({PDF_OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
