-- ChatSpin only. Does not change any existing application tables or auth users.
-- Run as database owner in the existing project's SQL Editor.
begin;
create table public.chatspin_channels (
  channel_id text primary key check (channel_id ~ '^[0-9]+$'),
  state jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.chatspin_secrets (
  channel_id text not null references public.chatspin_channels(channel_id) on delete cascade,
  name text not null,
  ciphertext text not null,
  primary key (channel_id, name)
);
create table public.chatspin_sessions (
  id text primary key,
  ciphertext text not null,
  expires_at timestamptz not null
);
create index chatspin_sessions_expiry_idx on public.chatspin_sessions(expires_at);
create table public.chatspin_snapshots (
  id bigint generated always as identity primary key,
  channel_id text not null references public.chatspin_channels(channel_id) on delete cascade,
  state jsonb not null,
  created_at timestamptz not null default now()
);
create index chatspin_snapshots_channel_idx on public.chatspin_snapshots(channel_id,id desc);
-- No browser access, even with a logged-in Supabase account. Backend secret only.
alter table public.chatspin_channels enable row level security;
alter table public.chatspin_secrets enable row level security;
alter table public.chatspin_sessions enable row level security;
alter table public.chatspin_snapshots enable row level security;
revoke all on public.chatspin_channels, public.chatspin_secrets, public.chatspin_sessions, public.chatspin_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.chatspin_channels, public.chatspin_secrets, public.chatspin_sessions, public.chatspin_snapshots to service_role;
grant usage, select on sequence public.chatspin_snapshots_id_seq to service_role;
-- Compare-and-swap prevents two Vercel instances overwriting each other's state.
create function public.chatspin_commit(p_channel_id text, p_revision bigint, p_state jsonb, p_snapshot boolean default false)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint; previous_state jsonb;
begin
  select state into previous_state from public.chatspin_channels where channel_id=p_channel_id and revision=p_revision for update;
  if not found then raise exception 'CHATSPIN_CONFLICT' using errcode='PT409'; end if;
  update public.chatspin_channels set state=p_state, revision=revision+1, updated_at=now()
    where channel_id=p_channel_id and revision=p_revision returning revision into next_revision;
  if next_revision is null then raise exception 'CHATSPIN_CONFLICT' using errcode='PT409'; end if;
  if p_snapshot then
    insert into public.chatspin_snapshots(channel_id,state) values(p_channel_id,previous_state);
    delete from public.chatspin_snapshots where channel_id=p_channel_id and id not in
      (select id from public.chatspin_snapshots where channel_id=p_channel_id order by id desc limit 20);
  end if;
  return next_revision;
end $$;
revoke all on function public.chatspin_commit(text,bigint,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.chatspin_commit(text,bigint,jsonb,boolean) to service_role;
commit;
