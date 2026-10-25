alter table public.judges
  add column if not exists pin_encrypted text;
