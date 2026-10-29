-- Provider-owned allowances, independent of editable/restorable channel state.
-- Only ChatSpin objects. Install BEFORE deploying quota-enabled cloud workers.
begin;
create table if not exists public.chatspin_ai_quotas (
  period date not null,
  scope text not null check(scope='global' or scope ~ '^channel:[0-9]+$'),
  calls bigint not null default 0 check(calls>=0),
  tokens bigint not null default 0 check(tokens>=0),
  primary key(period,scope)
);
create table if not exists public.chatspin_entitlements (
  channel_id text primary key references public.chatspin_channels(channel_id) on delete cascade,
  enabled boolean not null default true,
  daily_call_limit bigint check(daily_call_limit>=0),
  daily_token_limit bigint check(daily_token_limit>=0),
  plan text not null default 'standard',
  updated_at timestamptz not null default now()
);
alter table public.chatspin_ai_quotas enable row level security;
alter table public.chatspin_entitlements enable row level security;
revoke all on public.chatspin_ai_quotas,public.chatspin_entitlements from public,anon,authenticated;
grant select,insert,update,delete on public.chatspin_ai_quotas,public.chatspin_entitlements to service_role;
create or replace function public.chatspin_reserve_ai(
 p_channel_id text,p_tokens bigint,p_channel_calls bigint,p_channel_tokens bigint,
 p_global_calls bigint,p_global_tokens bigint,p_require_entitlement boolean default false
) returns void language plpgsql security invoker set search_path='' as $$
declare
 current_period date := (now() at time zone 'UTC')::date;
 global_usage public.chatspin_ai_quotas%rowtype;
 channel_usage public.chatspin_ai_quotas%rowtype;
 entitlement public.chatspin_entitlements%rowtype;
 channel_scope text := 'channel:' || p_channel_id;
 allowed_calls bigint := p_channel_calls;
 allowed_tokens bigint := p_channel_tokens;
begin
 if p_channel_id is null or p_channel_id !~ '^[0-9]{1,30}$' or p_tokens<0 or p_channel_calls<0 or p_channel_tokens<0 or p_global_calls<0 or p_global_tokens<0
    or p_tokens is null or p_channel_calls is null or p_channel_tokens is null or p_global_calls is null or p_global_tokens is null then
  raise exception 'Invalid quota request' using errcode='22023';
 end if;
 select * into entitlement from public.chatspin_entitlements where channel_id=p_channel_id;
 if (not found and p_require_entitlement) or (found and not entitlement.enabled) then
  raise exception 'Channel AI disabled' using errcode='PT403';
 end if;
 -- Entitlements can lower the operator's ceilings, never exceed them.
 allowed_calls := least(p_channel_calls,coalesce(entitlement.daily_call_limit,p_channel_calls));
 allowed_tokens := least(p_channel_tokens,coalesce(entitlement.daily_token_limit,p_channel_tokens));
 -- Every transaction locks global before channel: concurrent channels cannot
 -- overspend the global allowance and acquire locks in a consistent order.
 insert into public.chatspin_ai_quotas(period,scope) values(current_period,'global') on conflict do nothing;
 select * into global_usage from public.chatspin_ai_quotas where period=current_period and scope='global' for update;
 insert into public.chatspin_ai_quotas(period,scope) values(current_period,channel_scope) on conflict do nothing;
 select * into channel_usage from public.chatspin_ai_quotas where period=current_period and scope=channel_scope for update;
 if global_usage.calls>=p_global_calls or p_tokens>p_global_tokens-global_usage.tokens
   or channel_usage.calls>=allowed_calls or p_tokens>allowed_tokens-channel_usage.tokens then
  raise exception 'Hosted AI quota exhausted' using errcode='PT429';
 end if;
 update public.chatspin_ai_quotas set calls=calls+1,tokens=tokens+p_tokens
  where period=current_period and scope in ('global',channel_scope);
end $$;
revoke all on function public.chatspin_reserve_ai(text,bigint,bigint,bigint,bigint,bigint,boolean) from public,anon,authenticated;
grant execute on function public.chatspin_reserve_ai(text,bigint,bigint,bigint,bigint,bigint,boolean) to service_role;
commit;
