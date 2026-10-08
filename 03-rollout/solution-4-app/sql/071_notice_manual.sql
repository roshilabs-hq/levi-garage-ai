-- 071: ביקורת השימושיות החוזרת (8.10, 68/100), ממצא 6: כשההודעה האוטומטית לא יצאה ודניאל שלח את
-- הקישור בעצמו מהוואטסאפ של המוסך, זה נרשם. עד היום הכרטיס המשיך להציג "הקישור לא יצא" גם אחרי
-- שנשלח ידנית, ולא היה תיעוד שמישהו שלח. עכשיו "שלחתי בעצמי" מסמן את ההודעה כנשלחה, עם הסיבה
-- 'manual', ורק מנהל עבודה או הבעלים. בלי drop.
create or replace function public.mark_notice_manual(p_notice_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_manager();
  update public.customer_notices
     set status = 'sent', reason = 'manual', sent_at = now()
   where id = p_notice_id and status in ('failed', 'skipped');
  return found;
end;
$$;
revoke all on function public.mark_notice_manual(bigint) from public, anon;
grant execute on function public.mark_notice_manual(bigint) to authenticated;
