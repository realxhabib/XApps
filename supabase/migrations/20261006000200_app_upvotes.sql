-- =============================================================================
-- App upvotes: people upvote the apps they like; the marketplace sorts by them.
--
--  * app_upvotes (app_slug, user_id): one upvote per person per app. RLS: a
--    signed-in user reads only their own rows; nobody writes the table
--    directly (set_app_upvote is the only way in).
--  * apps.upvotes: the denormalised count, kept in sync by a trigger on
--    app_upvotes (so deleting a profile or an app keeps it right). Direct
--    client writes (developers editing their row, admins included) keep the
--    current value, like play_count; `npm run sync-apps` never sends it.
--  * set_app_upvote(p_app, p_on): upvotes (true) or takes the upvote back
--    (false) for the signed-in viewer; idempotent; returns
--    { upvotes, upvoted }. Only published apps can be upvoted, and developers
--    can't upvote their own apps (no self-upvotes). Taking an upvote back
--    always works. Rate limited to 30 calls a minute per person.
--  * app_row_json gains `viewer_upvoted` (open_app, the review queue). The web
--    reads apps rows directly and reads the viewer's own app_upvotes rows
--    alongside them.
-- Mirrors the demo backend. Safe to re-run.
-- =============================================================================

alter table public.apps
  add column if not exists upvotes integer not null default 0;
alter table public.apps drop constraint if exists apps_upvotes_check;
alter table public.apps add constraint apps_upvotes_check check (upvotes >= 0);
create index if not exists apps_upvotes_idx on public.apps (upvotes desc, created_at desc);

create table if not exists public.app_upvotes (
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (app_slug, user_id)
);
create index if not exists app_upvotes_user_idx on public.app_upvotes (user_id);

alter table public.app_upvotes enable row level security;
revoke all on public.app_upvotes from public, anon, authenticated;
grant select on public.app_upvotes to authenticated;
drop policy if exists "people see their own upvotes" on public.app_upvotes;
create policy "people see their own upvotes" on public.app_upvotes
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The count
-- ---------------------------------------------------------------------------

-- apps.upvotes follows app_upvotes (runs as the owner, so the apps guards let it through).
create or replace function public.app_upvotes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.apps set upvotes = upvotes + 1 where slug = new.app_slug;
    return new;
  end if;
  -- After an app is deleted its upvotes cascade here and the update finds nothing.
  update public.apps set upvotes = greatest(upvotes - 1, 0) where slug = old.app_slug;
  return old;
end;
$$;

drop trigger if exists app_upvotes_count on public.app_upvotes;
create trigger app_upvotes_count
  after insert or delete on public.app_upvotes
  for each row execute function public.app_upvotes_count();

-- Only upvoting moves apps.upvotes: direct client writes keep the current value.
create or replace function public.apps_guard_upvotes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.upvotes := 0;
  else
    new.upvotes := old.upvotes;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_guard_upvotes on public.apps;
create trigger apps_guard_upvotes
  before insert or update on public.apps
  for each row execute function public.apps_guard_upvotes();

-- Re-runs (and anything that drifted): recount from the rows.
update public.apps a
   set upvotes = c.n
  from (select a2.slug, (select count(*)::integer from public.app_upvotes u where u.app_slug = a2.slug) as n
          from public.apps a2) c
 where c.slug = a.slug and a.upvotes is distinct from c.n;

-- ---------------------------------------------------------------------------
-- Upvoting
-- ---------------------------------------------------------------------------

-- Upvotes (p_on) or takes the upvote back (not p_on) for the viewer. Returns
-- { upvotes, upvoted }. Upvoting needs a published app that isn't the
-- viewer's own; taking an upvote back works on any app.
create or replace function public.set_app_upvote(p_app text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps;
begin
  if p_on is null then
    raise exception 'Say whether to upvote' using errcode = '22023';
  end if;
  select * into a from public.apps where slug = p_app;
  -- Hidden apps (unpublished, not yours to test) are not found, unless you're taking an upvote back.
  if not found or (a.status <> 'published' and not public.can_test_app(a.slug, v_me)
                   and not (not p_on and exists (select 1 from public.app_upvotes u where u.app_slug = a.slug and u.user_id = v_me))) then
    raise exception 'App not found' using errcode = 'P0002';
  end if;
  if not public.rate_limit_hit('upvotes', v_me, 30) then
    raise exception 'Too many upvotes — slow down' using errcode = '54000';
  end if;
  if p_on then
    if a.developer_id = v_me then
      raise exception 'You can''t upvote your own app' using errcode = '42501';
    end if;
    if a.status <> 'published' then
      raise exception 'Only published apps can be upvoted' using errcode = '22023';
    end if;
    insert into public.app_upvotes (app_slug, user_id) values (a.slug, v_me)
    on conflict (app_slug, user_id) do nothing;
  else
    delete from public.app_upvotes where app_slug = a.slug and user_id = v_me;
  end if;
  return jsonb_build_object('upvotes', (select upvotes from public.apps where slug = a.slug), 'upvoted', p_on);
end;
$$;

-- The apps row as the web reads it (select *, developer:profiles(handle, name)),
-- plus whether the viewer upvoted it.
create or replace function public.app_row_json(a public.apps)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) || jsonb_build_object(
    'developer', (select jsonb_build_object('handle', p.handle, 'name', p.name) from public.profiles p where p.id = a.developer_id),
    'viewer_upvoted', exists (select 1 from public.app_upvotes u where u.app_slug = a.slug and u.user_id = auth.uid())
  );
$$;

revoke execute on function public.app_upvotes_count() from public, anon, authenticated;
revoke execute on function public.apps_guard_upvotes() from public, anon, authenticated;
revoke execute on function public.app_row_json(public.apps) from public, anon, authenticated;
revoke execute on function public.set_app_upvote(text, boolean) from public, anon;
grant execute on function public.set_app_upvote(text, boolean) to authenticated;
