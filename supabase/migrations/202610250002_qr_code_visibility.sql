alter table public.global_settings
  add column if not exists show_qr_code boolean not null default false;
