-- השער החוקי על שליחת הצעה ללקוח (27.9). חלק שני של 013.
--
-- למה בקובץ נפרד: המסד משותף לאתר החי ולפיתוח. עם השער הזה, המסך הישן של
-- דניאל (בלי שדות לשעות ולאחריות) היה נכשל בשליחת הצעה. לכן 013 (תוספות
-- בלבד) רץ מיד, וזה רץ יחד עם העלאת הגרסה החדשה של האתר.

-- ---------------------------------------------------------------- שליחת ממצא
-- כמו ב-006, ועוד שער אחד: הצעה חסרה לא יוצאת. זה המקום היחיד שדרכו מחיר
-- מגיע ללקוח, ולכן זה המקום לאכוף את החוק — לא הטופס.
create or replace function public.send_finding(p_finding_id bigint, p_message text, p_channel text default 'link')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_token text;
  v_f public.findings%rowtype;
  v_job public.job_cards%rowtype;
begin
  select s.role into v_role
  from public.staff s
  where s.id = (select auth.uid()) and s.active;

  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can send a price to a customer'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_message), '') = '' then
    raise exception 'the message to the customer cannot be empty' using errcode = '22023';
  end if;

  if p_channel not in ('link', 'whatsapp') then
    raise exception 'unknown channel' using errcode = '22023';
  end if;

  select * into v_f from public.findings where id = p_finding_id;
  if not found then
    raise exception 'no such finding' using errcode = 'P0002';
  end if;
  select * into v_job from public.job_cards where id = v_f.job_card_id;

  -- ס' 132(א)(1): מחיר, שעות עבודה ואחריות
  if v_f.price_original is null or v_f.labor_hours is null or coalesce(btrim(v_f.warranty_original), '') = '' then
    raise exception 'quote incomplete: price, labor hours and warranty are required'
      using errcode = '22023', hint = 'law-132a';
  end if;
  -- ס' 131: יותר מסוג חלק אחד, או הסבר למה אין
  if v_f.price_aftermarket is null and coalesce(btrim(v_f.single_reason), '') = '' then
    raise exception 'offer more than one part type, or say why there is only one'
      using errcode = '22023', hint = 'law-131';
  end if;
  if v_f.price_aftermarket is not null
     and (coalesce(btrim(v_f.warranty_aftermarket), '') = '' or coalesce(btrim(v_f.part_diff), '') = '') then
    raise exception 'explain the difference between the part types, and the warranty of each'
      using errcode = '22023', hint = 'law-131';
  end if;
  -- ס' 132(ב): עדכון באמצעי אלקטרוני רק בהסכמת הלקוח
  if v_job.updates_consent_at is null and not coalesce(v_job.whatsapp_consent, false) then
    raise exception 'the customer did not agree to electronic updates'
      using errcode = '22023', hint = 'law-132b';
  end if;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');

  insert into public.approvals (finding_id, token, channel, message_text)
  values (p_finding_id, v_token, p_channel, btrim(p_message))
  on conflict (finding_id) do update
    set token = excluded.token,
        channel = excluded.channel,
        message_text = excluded.message_text,
        sent_at = now(),
        decision = null,
        decided_at = null,
        price_chosen = null,
        part_choice = null,
        photo_paths = '{}',
        expires_at = now() + interval '7 days';

  update public.findings
     set status = 'sent', sent_at = now(), sent_by = (select auth.uid())
   where id = p_finding_id;

  update public.job_cards
     set status = 'waiting_approval'
   where id = v_f.job_card_id
     and status in ('open', 'in_progress', 'waiting_quote');

  return v_token;
end;
$$;

revoke all on function public.send_finding(bigint, text, text) from public;
revoke execute on function public.send_finding(bigint, text, text) from anon;
grant execute on function public.send_finding(bigint, text, text) to authenticated;

