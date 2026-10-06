// ההנחיות לבוחני הפרויקט (6.10): מה צריך, תרחיש של 15 דקות בשישה שלבים עם "מצופה" בכל צעד,
// מה עוד אפשר לנסות, ומה עושים כשמשהו נתקע. אותו קובץ נקרא גם במסמך ההגשה.

import steps from "@/lib/training/exam-steps.json"

type Item = { b: string; t: string }

// כתובות ומספרים בין גרשיים הפוכים (`/wall`) נכתבים משמאל לימין, כדי שלא יתהפכו בתוך שורה בעברית.
function Txt({ s }: { s: string }) {
  return (
    <>
      {s.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} dir="ltr" className="ex-code">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

function Items({ items, className }: { items: Item[]; className: string }) {
  return (
    <ul className={className}>
      {items.map((i) => (
        <li key={i.b}>
          <strong>{i.b}:</strong> <Txt s={i.t} />
        </li>
      ))}
    </ul>
  )
}

export function ExamSteps() {
  let n = 0
  return (
    <div className="ex">
      <p className="ex-lead">{steps.lead}</p>

      <h2 className="tp-group">מי זה מי</h2>
      <Items items={steps.cast} className="ex-need" />

      <h2 className="tp-group">מה צריך</h2>
      <Items items={steps.need} className="ex-need" />

      <h2 className="tp-group">התרחיש, צעד אחרי צעד</h2>
      <ol className="ex-stages">
        {steps.stages.map((st, i) => (
          <li key={st.title} className="ex-stage">
            <h3>
              <span className="ex-n">{i + 1}</span> {st.title} <span className="ex-min">· כ-{st.min} דקות</span>
            </h3>
            <ol className="ex-steps">
              {st.steps.map((s) => {
                n++
                return (
                  <li key={n}>
                    <span className="ex-who">{s.who}</span>
                    <span className="ex-do">
                      <Txt s={s.do} />
                    </span>
                    {"ok" in s && s.ok && (
                      <span className="ex-ok">
                        <span aria-hidden="true">✅</span> מצופה: <Txt s={s.ok} />
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </li>
        ))}
      </ol>

      <h2 className="tp-group">אם נשאר זמן</h2>
      <Items items={steps.more} className="ex-need" />

      <h2 className="tp-group">אם משהו נתקע</h2>
      <Items items={steps.stuck} className="ex-need" />
    </div>
  )
}
