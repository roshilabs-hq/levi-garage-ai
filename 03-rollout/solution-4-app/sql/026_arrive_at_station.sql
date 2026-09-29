-- 026: דניאל מאשר "הגעתי" על מסך העמדה, עם הקוד שלו (רועי, 29.9).
--
-- עד עכשיו: אלכס לוחץ "דניאל, בוא לעמדה", ודניאל סוגר את הקריאה רק מלוח היום
-- שבדלפק. אבל כשהוא כבר עומד ליד הליפט, הוא לא חוזר לדלפק כדי ללחוץ "הגעתי".
-- עכשיו: על המסך של אלכס, "דניאל כאן?", דניאל נוגע בשם שלו ומקיש את הקוד שלו.
--
-- למה קוד ולא כפתור פתוח: הכפתור על מכשיר של מכונאי. בלי קוד, המכונאי היה סוגר
-- את הקריאה לבד, ולוח היום היה מראה שדניאל הגיע כשהוא לא הגיע. הקוד של דניאל עובד
-- כמו הקוד של המכונאים: 6 ספרות, bcrypt, ונעילה של 15 דקות אחרי 5 טעויות.

-- 1. קוד גם למנהל ולבעלים (קודם: רק מכונאי).
create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can set a code' using errcode = '42501';
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    raise exception 'the code is 6 digits' using errcode = '22023';
  end if;
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), pin_failed = 0, pin_locked_until = null
   where id = p_staff_id and role in ('mechanic', 'manager', 'owner');
  if not found then
    raise exception 'no such staff member' using errcode = 'P0002';
  end if;
end;
$$;

-- 2. במסך העמדות: גם דניאל ואבי ברשימת הקודים. המכונאים קודם.
drop function if exists public.staff_pin_status();
create function public.staff_pin_status()
returns table (id uuid, full_name text, role text, has_pin boolean, locked_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner' using errcode = '42501';
  end if;
  return query
    select s.id, s.full_name, s.role::text, s.pin_hash is not null, case when s.pin_locked_until > now() then s.pin_locked_until end
    from public.staff s
    where s.active and s.role in ('mechanic', 'manager', 'owner')
    order by (s.role = 'mechanic') desc, s.full_name;
end;
$$;
revoke all on function public.staff_pin_status() from public;
revoke execute on function public.staff_pin_status() from anon;
grant execute on function public.staff_pin_status() to authenticated;

-- 3. מי יכול לאשר "הגעתי" בעמדה: שמות בלבד, בלי שום פרט אחר.
create or replace function public.call_answerers()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.full_name from public.staff s
  where public.is_worker() and s.active and s.role in ('manager', 'owner') and s.pin_hash is not null
  order by (s.role = 'manager') desc, s.full_name
$$;
revoke all on function public.call_answerers() from public;
revoke execute on function public.call_answerers() from anon;
grant execute on function public.call_answerers() to authenticated;

-- 4. "הגעתי" עם קוד. נקרא מהמכשיר של המכונאי, ולכן הזהות המחוברת היא המכונאי,
--    ומי שנרשם כמי שהגיע הוא בעל הקוד.
create or replace function public.answer_call_with_pin(p_call_id bigint, p_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
begin
  if not public.is_worker() then
    return jsonb_build_object('ok', false, 'reason', 'who');
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
  update public.help_calls set resolved_at = now(), resolved_by = v_staff.id
   where id = p_call_id and resolved_at is null;
  return jsonb_build_object('ok', true, 'name', v_staff.full_name);
end;
$$;
revoke all on function public.answer_call_with_pin(bigint, uuid, text) from public;
revoke execute on function public.answer_call_with_pin(bigint, uuid, text) from anon;
grant execute on function public.answer_call_with_pin(bigint, uuid, text) to authenticated;
