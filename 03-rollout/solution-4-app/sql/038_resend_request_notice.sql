-- 038: "לשלוח שוב" באמת שולח שוב (2.10).
--
-- claim_request_notice (027) תופס הודעה אחת לכל קישור, ושולח שוב רק אם הקודמת
-- נכשלה. בקבלה (036) דניאל לוחץ "לשלוח שוב" כשהלקוח אומר "לא קיבלתי", ואז אותו
-- קישור צריך לצאת שוב גם אם הוואטסאפ הקודם "נשלח". עכשיו: שליחה חוזרת מותרת גם
-- אחרי שליחה מוצלחת או דילוג, אבל רק אחרי 10 דקות, כדי שלחיצה כפולה לא תשלח פעמיים.
-- כל השאר כמו ב-027, מילה במילה.

create or replace function public.claim_request_notice(p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_req public.quote_requests%rowtype;
  v_job public.job_cards%rowtype;
  v_id bigint;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can send a price to a customer' using errcode = '42501';
  end if;
  select * into v_req from public.quote_requests where id = p_request_id;
  if not found or v_req.decided_at is not null or v_req.expires_at < now() then
    return null;
  end if;
  select * into v_job from public.job_cards where id = v_req.job_card_id;

  insert into public.customer_notices (job_card_id, kind, ref, created_by)
  values (v_job.id, 'quote', v_req.token, (select auth.uid()))
  on conflict (job_card_id, kind, ref) do update
    set status = 'pending', reason = null, sent_at = null, created_at = now(), created_by = excluded.created_by
    where public.customer_notices.status = 'failed'
       or (public.customer_notices.status = 'pending' and public.customer_notices.created_at < now() - interval '2 minutes')
       or (public.customer_notices.status in ('sent', 'skipped') and public.customer_notices.created_at < now() - interval '10 minutes')
  returning id into v_id;
  if v_id is null then
    return null;
  end if;

  if not coalesce(v_job.whatsapp_consent, false) then
    update public.customer_notices set status = 'skipped', reason = 'no_consent' where id = v_id;
    return jsonb_build_object('id', v_id, 'send', false);
  end if;
  if coalesce(btrim(v_job.customer_phone), '') = '' then
    update public.customer_notices set status = 'skipped', reason = 'no_phone' where id = v_id;
    return jsonb_build_object('id', v_id, 'send', false);
  end if;

  return jsonb_build_object(
    'id', v_id, 'send', true,
    'phone', v_job.customer_phone, 'name', v_job.customer_name,
    'make', v_job.vehicle_make, 'model', v_job.vehicle_model, 'plate', v_job.plate,
    'token', v_req.token
  );
end;
$$;
