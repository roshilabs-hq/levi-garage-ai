-- 070: הביקורת השביעית (8.10, 77/100), ממצאים 1 ו-5. זו הביקורת האחרונה לפני ההגשה.
--
-- 1 (גבוה). קבלת רכב בדלפק הייתה חמש כתיבות נפרדות מהאפליקציה: כרטיס, פריטי הצעה, התור, בקשת
--    האישור, והמסמך. כישלון באמצע (למשל בפריטי ההצעה) לא נבדק ולא החזיר אחורה: היה יכול להיווצר
--    כרטיס בלי הצעה, ואפילו קישור ללקוח להצעה ריקה. עכשיו הכול בפעולה אחת במסד: או שהכול נרשם,
--    או שכלום. הפונקציה בודקת בעצמה את התפקיד, את התור, את הפריטים ואת ההסכמה (ס' 132(ב)), ואז
--    קוראת ל-send_intake_request מבפנים. המסמך והמייל נשארים באפליקציה, אחרי שהגרעין נרשם.
-- 5 (בינוני, מותנה). ניסיון תמלול חוזר: שתי בקשות במקביל ראו שתיהן finding_id ריק ויצרו שתי
--    טיוטות. עכשיו הניסיון החוזר "תופס" את ההקלטה בפעולה אחת (retry_at), ותפיסה שנייה בתוך שתי
--    דקות נדחית. אם המודל נפל, אפשר לנסות שוב אחרי שתי דקות.
-- בלי drop.

-- 1 ---------------------------------------------------------------------------------------------
create or replace function public.receive_car(
  p_booking_id bigint,
  p_lines jsonb,
  p_email text,
  p_odometer integer,
  p_consent boolean,
  p_on_paper boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_booking public.bookings%rowtype;
  v_job_id bigint;
  v_token text;
  v_line jsonb;
  v_item public.price_list%rowtype;
  v_consent boolean;
  v_seen bigint[] := '{}';
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner receives a car' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'no services chosen' using errcode = '22023', hint = 'missing';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'no such booking' using errcode = 'P0002', hint = 'missing';
  end if;
  if v_booking.status = 'arrived' then
    raise exception 'the car was already received' using errcode = '22023', hint = 'arrived';
  end if;
  -- ס' 132(ב): קישור לאישור רק למי שהסכים לעדכונים אלקטרוניים. בלי הסכמה, עותק מודפס וחתימה.
  v_consent := coalesce(p_consent, false) or coalesce(v_booking.whatsapp_consent, false);
  if not coalesce(p_on_paper, false) and not v_consent then
    raise exception 'the customer did not agree to electronic updates' using errcode = '22023', hint = 'paper';
  end if;

  -- תקנה 8: לא מתחילים עבודה שהלקוח לא אישר, גם לא אבחון. האישור מגיע מהלקוח (036).
  insert into public.job_cards (
    booking_id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, fuel,
    customer_name, customer_phone, customer_email, odometer_km,
    whatsapp_consent, updates_consent_at, work_approved_at, lift, status, opened_by
  ) values (
    v_booking.id, v_booking.plate, v_booking.vehicle_make, v_booking.vehicle_model, v_booking.vehicle_year,
    v_booking.engine_code, v_booking.fuel,
    v_booking.customer_name, v_booking.customer_phone, nullif(btrim(coalesce(p_email, '')), ''), p_odometer,
    v_consent, case when coalesce(p_consent, false) then now() end, null, null, 'open', (select auth.uid())
  ) returning id into v_job_id;

  -- כמה עבודות בקבלה אחת. כל שורה: {"id": מזהה במחירון, "choice": "original" או "aftermarket"}.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.price_list where id = (v_line->>'id')::bigint;
    if not found then
      raise exception 'unknown price list item' using errcode = '22023', hint = 'missing';
    end if;
    if v_item.id = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_item.id;
    insert into public.quote_items (
      job_card_id, price_list_id, title, labor_hours, price_original, price_aftermarket,
      warranty_original, warranty_aftermarket, part_diff, single_reason, part_choice, created_by
    ) values (
      v_job_id, v_item.id, v_item.title, v_item.labor_hours, v_item.price_original, v_item.price_aftermarket,
      v_item.warranty_original, v_item.warranty_aftermarket, v_item.part_diff, v_item.single_reason,
      case when v_line->>'choice' = 'aftermarket' and v_item.price_aftermarket is not null then 'aftermarket' else 'original' end,
      (select auth.uid())
    );
  end loop;

  update public.bookings set status = 'arrived' where id = v_booking.id;

  -- הקישור לאישור, באותה טרנזקציה: אם הוא נכשל, גם הכרטיס לא נרשם.
  if not coalesce(p_on_paper, false) then
    v_token := public.send_intake_request(v_job_id);
  end if;

  return jsonb_build_object('job_id', v_job_id, 'token', v_token);
end;
$$;
revoke all on function public.receive_car(bigint, jsonb, text, integer, boolean, boolean) from public, anon;
grant execute on function public.receive_car(bigint, jsonb, text, integer, boolean, boolean) to authenticated;

-- 5 ---------------------------------------------------------------------------------------------
alter table public.media add column if not exists retry_at timestamptz;

create or replace function public.claim_media_retry(p_media_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.media%rowtype;
begin
  if not public.is_worker() then
    return false;
  end if;
  select * into v_media from public.media where id = p_media_id for update;
  if not found or v_media.kind <> 'audio' or v_media.finding_id is not null or not public.can_see_job(v_media.job_card_id) then
    return false;
  end if;
  if v_media.retry_at is not null and v_media.retry_at > now() - interval '2 minutes' then
    return false;
  end if;
  update public.media set retry_at = now() where id = p_media_id;
  return true;
end;
$$;
revoke all on function public.claim_media_retry(bigint) from public, anon;
grant execute on function public.claim_media_retry(bigint) to authenticated;
