create extension if not exists pgcrypto;

do $$ begin
  create type public.voting_status_enum as enum ('NOT_STARTED', 'OPEN', 'CLOSED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.evaluation_status_enum as enum ('IN_PROGRESS', 'COMPLETED');
exception when duplicate_object then null;
end $$;

create table if not exists public.global_settings (
  id integer primary key default 1 check (id = 1),
  voting_status public.voting_status_enum not null default 'NOT_STARTED',
  updated_at timestamptz not null default now()
);

insert into public.global_settings (id, voting_status)
values (1, 'NOT_STARTED')
on conflict (id) do nothing;

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  intranet_login varchar(50) not null unique,
  student_name varchar(100) not null,
  costume_name varchar(100) not null,
  created_at timestamptz not null default now()
);

create unique index if not exists candidates_intranet_login_lower_idx
  on public.candidates (lower(intranet_login));

create table if not exists public.judges (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  pin_hash char(64) not null unique,
  status public.evaluation_status_enum not null default 'IN_PROGRESS',
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_token uuid not null unique default gen_random_uuid(),
  has_voted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references public.devices(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references public.judges(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  creativity_score numeric(4,2) not null check (creativity_score between 0 and 15),
  execution_score numeric(4,2) not null check (execution_score between 0 and 15),
  visual_impact_score numeric(4,2) not null check (visual_impact_score between 0 and 10),
  performance_score numeric(4,2) not null check (performance_score between 0 and 5),
  theme_fidelity_score numeric(4,2) not null check (theme_fidelity_score between 0 and 5),
  total_score numeric(5,2) generated always as (
    creativity_score + execution_score + visual_impact_score + performance_score + theme_fidelity_score
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_judge_candidate unique (judge_id, candidate_id)
);

create table if not exists public.judge_sessions (
  token_hash char(64) primary key,
  judge_id uuid not null references public.judges(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists votes_candidate_id_idx on public.votes(candidate_id);
create index if not exists evaluations_candidate_id_idx on public.evaluations(candidate_id);
create index if not exists judge_sessions_expires_at_idx on public.judge_sessions(expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists global_settings_updated_at on public.global_settings;
create trigger global_settings_updated_at
before update on public.global_settings
for each row execute function public.set_updated_at();

drop trigger if exists evaluations_updated_at on public.evaluations;
create trigger evaluations_updated_at
before update on public.evaluations
for each row execute function public.set_updated_at();

create or replace function public.submit_public_vote(p_device_token uuid, p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_record public.devices%rowtype;
begin
  if not exists (
    select 1 from public.global_settings where id = 1 and voting_status = 'OPEN'
  ) then
    raise exception using errcode = 'P0001', message = 'VOTING_NOT_OPEN';
  end if;

  select * into device_record
  from public.devices
  where device_token = p_device_token
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEVICE_NOT_FOUND';
  end if;
  if device_record.has_voted then
    raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_VOTED';
  end if;
  if not exists (select 1 from public.candidates where id = p_candidate_id) then
    raise exception using errcode = 'P0001', message = 'CANDIDATE_NOT_FOUND';
  end if;

  insert into public.votes (device_id, candidate_id)
  values (device_record.id, p_candidate_id);

  update public.devices set has_voted = true where id = device_record.id;
end;
$$;

create or replace function public.finalize_judge_evaluations(p_judge_id uuid, p_evaluations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  judge_record public.judges%rowtype;
  candidate_count integer;
  submitted_count integer;
  distinct_submitted_count integer;
begin
  select * into judge_record from public.judges where id = p_judge_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'JUDGE_NOT_FOUND';
  end if;
  if judge_record.status = 'COMPLETED' then
    raise exception using errcode = 'P0001', message = 'JUDGE_ALREADY_COMPLETED';
  end if;
  if jsonb_typeof(p_evaluations) <> 'array' then
    raise exception using errcode = 'P0001', message = 'EVALUATION_SET_MISMATCH';
  end if;

  select count(*) into candidate_count from public.candidates;
  select count(*), count(distinct evaluation_item ->> 'candidate_id')
    into submitted_count, distinct_submitted_count
  from jsonb_array_elements(p_evaluations) as evaluation_items(evaluation_item);

  if submitted_count <> candidate_count
     or distinct_submitted_count <> submitted_count
     or exists (
       select 1
       from jsonb_array_elements(p_evaluations) as evaluation_items(evaluation_item)
       left join public.candidates c on c.id = (evaluation_item ->> 'candidate_id')::uuid
       where c.id is null
     ) then
    raise exception using errcode = 'P0001', message = 'EVALUATION_SET_MISMATCH';
  end if;

  insert into public.evaluations (
    judge_id,
    candidate_id,
    creativity_score,
    execution_score,
    visual_impact_score,
    performance_score,
    theme_fidelity_score,
    notes
  )
  select
    p_judge_id,
    (item ->> 'candidate_id')::uuid,
    (item ->> 'creativity_score')::numeric,
    (item ->> 'execution_score')::numeric,
    (item ->> 'visual_impact_score')::numeric,
    (item ->> 'performance_score')::numeric,
    (item ->> 'theme_fidelity_score')::numeric,
    nullif(item ->> 'notes', '')
  from jsonb_array_elements(p_evaluations) as evaluation_items(item)
  on conflict (judge_id, candidate_id) do update set
    creativity_score = excluded.creativity_score,
    execution_score = excluded.execution_score,
    visual_impact_score = excluded.visual_impact_score,
    performance_score = excluded.performance_score,
    theme_fidelity_score = excluded.theme_fidelity_score,
    notes = excluded.notes;

  update public.judges set status = 'COMPLETED' where id = p_judge_id;
  delete from public.judge_sessions where judge_id = p_judge_id;
end;
$$;

alter table public.global_settings enable row level security;
alter table public.candidates enable row level security;
alter table public.judges enable row level security;
alter table public.devices enable row level security;
alter table public.votes enable row level security;
alter table public.evaluations enable row level security;
alter table public.judge_sessions enable row level security;

revoke all on public.global_settings, public.candidates, public.judges, public.devices,
  public.votes, public.evaluations, public.judge_sessions from anon, authenticated;
revoke all on function public.submit_public_vote(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_judge_evaluations(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_vote(uuid, uuid) to service_role;
grant execute on function public.finalize_judge_evaluations(uuid, jsonb) to service_role;
