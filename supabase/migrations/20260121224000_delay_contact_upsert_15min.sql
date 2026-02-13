insert into public.automation_messages (event_type, send_delay_minutes)
values ('contact.upsert', 15)
on conflict (event_type)
do update set send_delay_minutes = excluded.send_delay_minutes;

