alter table public.global_settings
  add column if not exists home_display_mode text not null default 'HIDDEN'
    check (home_display_mode in ('HIDDEN', 'QR', 'MEDIA')),
  add column if not exists event_media_path text,
  add column if not exists event_media_type text;

update public.global_settings
set home_display_mode = case when show_qr_code then 'QR' else 'HIDDEN' end
where id = 1;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
