-- 031: "המוסכניק הוותיק" בתוך העמדה (סבב 2.10, ממצאים 2–5).
--
-- ה-Gem (פתרון 1) נפתח בחלון חדש ומוציא את המכונאי מהאבחון, לא יודע איזה רכב על
-- הליפט ומי שואל ("קרא לאלכס" — לאלכס עצמו), ואין בו תיעוד מרוכז של השאלות. בעמדה
-- אותו מוח (אותן הנחיות, הרשימה האדומה ובסיס הידע), עם ההקשר של הכרטיס, וכל שאלה
-- ותשובה נשמרות כאן: אבי ודניאל רואים מה נשאל, ומה כדאי להוסיף לבסיס הידע.

create table if not exists public.mentor_questions (
  id bigserial primary key,
  job_card_id bigint references public.job_cards (id) on delete set null,
  asked_by uuid not null default auth.uid() references public.staff (id),
  question text not null check (length(question) between 1 and 2000),
  had_photo boolean not null default false,
  answer text,
  red_list boolean not null default false,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists mentor_questions_created_idx on public.mentor_questions (created_at desc);
create index if not exists mentor_questions_job_idx on public.mentor_questions (job_card_id);
create index if not exists mentor_questions_asked_by_idx on public.mentor_questions (asked_by);

alter table public.mentor_questions enable row level security;

-- (בלי "drop policy if exists": הכלי של Supabase מסווג אותו כהרסני, ובקשת האישור לא
-- מגיעה מהשליטה מרחוק. הטבלה חדשה, אז אין מה למחוק. 2.10)

-- מי ששואל הוא עובד מחובר, ונרשם בשמו בלבד.
create policy mentor_questions_create on public.mentor_questions
  for insert to authenticated
  with check (public.is_worker() and asked_by = (select auth.uid()));

-- מכונאי רואה את השאלות שלו; אבי ודניאל רואים הכול.
create policy mentor_questions_read on public.mentor_questions
  for select to authenticated
  using (asked_by = (select auth.uid()) or public.my_role() in ('owner', 'manager'));

revoke all on table public.mentor_questions from anon;
grant select, insert on table public.mentor_questions to authenticated;
grant usage on sequence public.mentor_questions_id_seq to authenticated;
