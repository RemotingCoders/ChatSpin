-- Replace only ChatSpin's existing save function. No tables or data are removed.
-- 40001 triggers automatic PostgREST transaction retries; PT409 returns HTTP 409
-- so the application can reload the revision and retry at most four times.
begin;
create or replace function public.chatspin_commit(p_channel_id text, p_revision bigint, p_state jsonb, p_snapshot boolean default false)
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
commit;
