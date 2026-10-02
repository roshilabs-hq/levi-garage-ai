-- 037: הבוט יודע שהרכב מחכה לאישור של הלקוח על הצעת הקבלה (036).
--
-- בלי זה, לקוח שעוד לא אישר שואל "מה עם הרכב?" ושומע "בעבודה אצלנו עכשיו",
-- בזמן שהרכב עומד בחניה ומחכה לו. כאן: 'status' = 'waiting_intake' לרכב פתוח
-- שעוד לא אושר, וב-lib/site/customer.ts הנוסח. השאר כמו קודם, מילה במילה.

create or replace function public.garage_customer(p_secret text, p_client text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_key text;
begin
  select value into v_key from private.settings where key = 'garage_bot_token';
  if v_key is null or p_secret is null or p_secret <> v_key then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_client is null or p_client !~ '^wa-[0-9a-f]{16}$' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(x)
    from (
      select x
      from (
        select jsonb_build_object(
                 'kind', 'job',
                 'name', nullif(split_part(btrim(coalesce(j.customer_name, '')), ' ', 1), ''),
                 'car', nullif(concat_ws(' ', j.vehicle_make, j.vehicle_model), ''),
                 'plate_tail', right(regexp_replace(j.plate, '\D', '', 'g'), 3),
                 'status', case
                             when j.work_approved_at is null and j.status in ('open', 'in_progress') then 'waiting_intake'
                             else j.status
                           end,
                 'since', j.status_since,
                 'ready_at', j.ready_at,
                 'eta', (select f.eta from public.findings f
                         where f.job_card_id = j.id and f.eta is not null and f.status in ('sent', 'approved')
                         order by f.created_at desc limit 1)
               ) as x,
               j.opened_at as at
        from public.job_cards j
        where (j.status not in ('delivered', 'cancelled') or j.delivered_at > now() - interval '1 day')
          and private.garage_client_id(j.customer_phone, v_key) = p_client
        union all
        select jsonb_build_object(
                 'kind', 'booking',
                 'name', nullif(split_part(btrim(coalesce(b.customer_name, '')), ' ', 1), ''),
                 'car', nullif(concat_ws(' ', b.vehicle_make, b.vehicle_model), ''),
                 'plate_tail', right(b.plate, 3),
                 'status', b.status,
                 'drop_off_at', b.drop_off_at
               ),
               b.drop_off_at
        from public.bookings b
        where b.status in ('booked', 'rescheduled')
          and b.drop_off_at > now() - interval '12 hours'
          and not exists (select 1 from public.job_cards j where j.booking_id = b.id)
          and private.garage_client_id(b.customer_phone, v_key) = p_client
      ) all_rows
      order by at desc
      limit 3
    ) t
  ), '[]'::jsonb);
end;
$function$;
