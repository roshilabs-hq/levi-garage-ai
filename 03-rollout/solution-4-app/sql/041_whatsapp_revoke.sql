-- 041: "הסר" מבטל את ההסכמה לוואטסאפ (4.10, ההרצה של רועי).
--
-- מדיניות הפרטיות מבטיחה: "לבטל בכל רגע את ההסכמה להודעות בוואטסאפ. מספיק
-- לכתוב 'הסר'". בהרצה של 4.10 הלקוח כתב "הסר", הבוט ענה על מצב הרכב, וההסכמה
-- נשארה. זה ההפך של grant_whatsapp_consent (039): אותו מזהה לקוח, אותם תורים
-- וכרטיסים פתוחים, והפעם whatsapp_consent = false.
--
-- כל פונקציות השליחה בוואטסאפ (claim_due_reminders, claim_due_nudges,
-- claim_quote_notice, claim_request_notice, claim_ready_notice) כבר בודקות את
-- whatsapp_consent, ולכן אחרי הביטול לא יוצאת יותר שום הודעה יזומה. ההסכמה
-- להצעות במייל (updates_consent_at) לא משתנה: "הסר" נכתב בוואטסאפ, ועליו הוא חל.
--
-- whatsapp_revoked_at: מתי ביקש. רישום, כדי שאפשר יהיה להראות שהבקשה כובדה.
-- הודעה חדשה של "אשמח לקבל עדכונים" מחזירה את ההסכמה, וזו הסכמה חדשה ומפורשת.

alter table public.bookings add column if not exists whatsapp_revoked_at timestamptz;
alter table public.job_cards add column if not exists whatsapp_revoked_at timestamptz;

create or replace function public.revoke_whatsapp_consent(p_secret text, p_client text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_b integer;
  v_j integer;
begin
  select value into v_key from private.settings where key = 'garage_bot_token';
  if v_key is null or p_secret is null or p_secret <> v_key then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_client is null or p_client !~ '^wa-[0-9a-f]{16}$' then
    return 0;
  end if;

  update public.bookings b set whatsapp_consent = false, whatsapp_revoked_at = now()
   where b.whatsapp_consent
     and b.status in ('booked', 'rescheduled', 'arrived')
     and b.drop_off_at > now() - interval '2 days'
     and private.garage_client_id(b.customer_phone, v_key) = p_client;
  get diagnostics v_b = row_count;

  update public.job_cards j set whatsapp_consent = false, whatsapp_revoked_at = now()
   where coalesce(j.whatsapp_consent, false)
     and j.status not in ('delivered', 'cancelled')
     and private.garage_client_id(j.customer_phone, v_key) = p_client;
  get diagnostics v_j = row_count;

  return v_b + v_j;
end;
$$;
revoke all on function public.revoke_whatsapp_consent(text, text) from public;
grant execute on function public.revoke_whatsapp_consent(text, text) to anon, authenticated;
