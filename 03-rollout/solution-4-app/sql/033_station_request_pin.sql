-- 033: דניאל מאשר עמדה על הטאבלט עצמו, בקוד שלו (רועי, 2.10).
--
-- ב-032 דניאל מאשר מהלוח במחשב. אבל אם הוא כבר עומד ליד הליפט, הקישור
-- "מנהל העבודה נכנס כאן" מוציא את הטאבלט מהמסך שלו לכניסת צוות. עכשיו על
-- הטאבלט עצמו: "דניאל כאן? לאשר עם הקוד שלו" — בוחר ליפט, נוגע בשם, מקיש קוד.
-- בדיוק כמו "הגעתי" לקריאה בעמדה (026): אותו קוד, אותה נעילה אחרי 5 ניסיונות.
--
-- הסוד של הבקשה (שבעוגייה של הטאבלט) הוא שמוכיח שזה המכשיר שביקש; הקוד של
-- דניאל הוא שמוכיח שדניאל אישר. בלי שניהם, לא קורה כלום.

-- מי יכול לאשר: שמות בלבד, ורק למכשיר שיש לו בקשה פתוחה.
create or replace function public.station_request_approvers(p_secret text)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.full_name from public.staff s
  where p_secret ~ '^[0-9a-f]{32}$'
    and exists (
      select 1 from public.station_requests r
       where r.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
         and r.approved_at is null and r.consumed_at is null and r.expires_at > now()
    )
    and s.active and s.role in ('manager', 'owner') and s.pin_hash is not null
  order by (s.role = 'manager') desc, s.full_name
$$;

create or replace function public.approve_station_request_with_pin(p_secret text, p_staff_id uuid, p_pin text, p_lift smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.station_requests%rowtype;
  v_staff public.staff%rowtype;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if p_lift is not null and p_lift not between 1 and 4 then
    return jsonb_build_object('ok', false, 'reason', 'lift');
  end if;
  select * into v_req from public.station_requests
   where secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
     and approved_at is null and consumed_at is null and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  select * into v_staff from public.staff
   where id = p_staff_id and active and role in ('manager', 'owner') for update;
  if not found or v_staff.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'who');
  end if;
  if v_staff.pin_locked_until is not null and v_staff.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' or extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    update public.staff
       set pin_failed = case when pin_failed + 1 >= 5 then 0 else pin_failed + 1 end,
           pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '15 minutes' else pin_locked_until end
     where id = v_staff.id;
    return jsonb_build_object('ok', false, 'reason', case when v_staff.pin_failed + 1 >= 5 then 'locked' else 'pin' end,
                              'left', greatest(0, 4 - v_staff.pin_failed));
  end if;

  update public.staff set pin_failed = 0, pin_locked_until = null where id = v_staff.id;
  update public.station_requests
     set approved_at = now(), approved_by = v_staff.id, lift = p_lift,
         label = case when p_lift is null then 'עמדת האבחון' else 'ליפט ' || p_lift end
   where id = v_req.id;
  return jsonb_build_object('ok', true, 'name', v_staff.full_name);
end;
$$;

revoke all on function public.station_request_approvers(text) from public;
grant execute on function public.station_request_approvers(text) to anon, authenticated;
revoke all on function public.approve_station_request_with_pin(text, uuid, text, smallint) from public;
grant execute on function public.approve_station_request_with_pin(text, uuid, text, smallint) to anon, authenticated;
