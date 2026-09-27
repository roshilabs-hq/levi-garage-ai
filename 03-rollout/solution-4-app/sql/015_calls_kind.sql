-- שני סוגי קריאות מהעמדה לדניאל (27.9): "בוא לעמדה" ו"סיימתי".
--
-- "סיימתי" לא מסמן את הרכב כמוכן בעצמו: "מוכן" שולח ללקוח הודעה ומפנה את
-- הליפט, וזה נשאר אצל מנהל העבודה, שבודק לפני. מה שהמכונאי עושה הוא להודיע,
-- בלחיצה אחת, במקום לחפש את דניאל בחצר.

alter table public.help_calls add column if not exists kind text not null default 'help'
  check (kind in ('help', 'done'));

-- לא יותר מקריאה פתוחה אחת מאותו סוג לאותו רכב: לחיצה כפולה בכפפה לא תציף את הלוח.
create unique index if not exists help_calls_one_open
  on public.help_calls (job_card_id, kind) where resolved_at is null;
