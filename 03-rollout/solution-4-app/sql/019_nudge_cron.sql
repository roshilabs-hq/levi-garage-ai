-- 019: השעון של התזכורות (018). להריץ אחרי שהאתר עם /api/cron/nudges עלה.
--
-- כל 5 דקות המסד קורא לאתר עם הטוקן המשותף (private.settings), והאתר שולח
-- תזכורת לכל קישור שלא נענה 30 דקות. הטוקן לא יוצא מהמסד לשום מקום אחר.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule('quote-nudges') where exists (select 1 from cron.job where jobname = 'quote-nudges');
select cron.schedule(
  'quote-nudges',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://levi-garage.vercel.app/api/cron/nudges',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-garage-secret', (select value from private.settings where key = 'garage_bot_token')
      ),
      body := '{}'::jsonb
    );
  $job$
);
