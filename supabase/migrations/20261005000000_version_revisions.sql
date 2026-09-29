-- =============================================================================
-- Version revisions: one submission per app in review.
--
--  * Submitting a version supersedes any other version of the same app that is
--    still in review (status 'superseded', superseded_by = the new one), so the
--    review queue only ever holds an app's latest submission.
--  * revise_app_version edits a submission in review: the changes are saved as
--    the next patch version (1.1.0 -> 1.1.1), which is submitted and replaces
--    the edited one in the queue.
--  * list_review_queue reports which earlier submissions an entry replaced.
-- Mirrors the demo backend (src/platform/demo/demo-backend.ts). Safe to re-run.
-- =============================================================================

alter table public.app_versions
  add column if not exists superseded_by uuid references public.app_versions (id);

alter table public.app_versions drop constraint if exists app_versions_status_check;
alter table public.app_versions add constraint app_versions_status_check
  check (status in ('draft', 'in_review', 'approved', 'rejected', 'published', 'retired', 'superseded'));

-- Apps with several versions in review keep only the latest submission queued.
update public.app_versions v
   set status = 'superseded', superseded_by = keep.id
  from (select distinct on (app_slug) app_slug, id
          from public.app_versions
         where status = 'in_review'
         order by app_slug, submitted_at desc nulls last, created_at desc, id desc) keep
 where v.app_slug = keep.app_slug and v.status = 'in_review' and v.id <> keep.id;

create unique index if not exists app_versions_one_in_review on public.app_versions (app_slug) where status = 'in_review';

-- Adds supersededBy (the replacing version's label) for superseded versions.
create or replace function public.app_version_json(v public.app_versions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when v.id is null then null else jsonb_build_object(
    'id', v.id, 'appSlug', v.app_slug, 'version', v.version, 'url', v.url, 'manifest', v.manifest,
    'status', v.status, 'notes', v.notes, 'reviewNotes', v.review_notes, 'createdAt', v.created_at,
    'submittedAt', v.submitted_at, 'reviewedAt', v.reviewed_at, 'publishedAt', v.published_at,
    'supersededBy', (select s.version from public.app_versions s where s.id = v.superseded_by)
  ) end;
$$;

-- The next free patch in a version's major.minor line: 1.1.0 -> 1.1.1 (or 1.1.3 when 1.1.2 exists).
create or replace function public.next_patch_version(p_app text, p_version text)
returns text
language sql
stable
set search_path = ''
as $$
  select split_part(p_version, '.', 1) || '.' || split_part(p_version, '.', 2) || '.' ||
         (greatest(split_part(p_version, '.', 3)::numeric,
                   coalesce(max(split_part(v.version, '.', 3)::numeric), 0)) + 1)::text
    from public.app_versions v
   where v.app_slug = p_app
     and split_part(v.version, '.', 1) = split_part(p_version, '.', 1)
     and split_part(v.version, '.', 2) = split_part(p_version, '.', 2);
$$;

create or replace function public.submit_app_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions := public.managed_version(p_version_id);
  a public.apps;
begin
  if v.status not in ('draft', 'rejected') then
    raise exception 'Only drafts and rejected versions can be submitted' using errcode = '55000';
  end if;
  select * into a from public.apps where slug = v.app_slug for update;
  perform public.version_authority_check(a, v.manifest);
  -- One submission per app in review: this one takes the place of any other.
  update public.app_versions
     set status = 'superseded', superseded_by = v.id
   where app_slug = v.app_slug and status = 'in_review' and id <> v.id;
  update public.app_versions set status = 'in_review', submitted_at = now() where id = v.id
  returning * into v;
  -- A new app that was turned down is back in review.
  if a.published_version_id is null and a.status = 'rejected' then
    update public.apps set status = 'pending', updated_at = now() where slug = a.slug;
  end if;
  return public.app_version_json(v);
end;
$$;

-- Edits a submission in review. null arguments keep the edited version's value.
-- Returns the new version (in review).
create or replace function public.revise_app_version(
  p_version_id uuid,
  p_url text default null,
  p_manifest jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions := public.managed_version(p_version_id);
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_next uuid;
begin
  if v.status <> 'in_review' then
    raise exception 'Only versions in review can be edited this way' using errcode = '55000';
  end if;
  v_next := (public.create_app_version(
    v.app_slug,
    public.next_patch_version(v.app_slug, v.version),
    coalesce(v_url, v.url),
    coalesce(p_manifest, v.manifest),
    coalesce(btrim(p_notes), v.notes)
  )->>'id')::uuid;
  return public.submit_app_version(v_next);
end;
$$;

-- In-review versions (one per app), oldest submission first:
-- [{ version, app, developer, published, replaces: [earlier submissions it replaced, newest first] }].
create or replace function public.list_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_admin();
  result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', public.app_version_json(v),
           'app', public.app_row_json(a),
           'developer', (select public.profile_json(p) from public.profiles p where p.id = a.developer_id),
           'published', (select public.app_version_json(pv) from public.app_versions pv where pv.id = a.published_version_id),
           'replaces', (
             with recursive chain as (
               select s.id, s.version, s.created_at, 1 as depth
                 from public.app_versions s where s.superseded_by = v.id
               union all
               select s.id, s.version, s.created_at, c.depth + 1
                 from public.app_versions s join chain c on s.superseded_by = c.id
                where c.depth < 200
             )
             select coalesce(jsonb_agg(chain.version order by chain.depth, chain.created_at desc), '[]'::jsonb)
               from chain
           )
         ) order by v.submitted_at, v.created_at, v.id), '[]'::jsonb)
    into result
    from public.app_versions v
    join public.apps a on a.slug = v.app_slug
   where v.status = 'in_review';
  return result;
end;
$$;

-- Same decisions as before; a superseded version says what replaced it.
create or replace function public.review_app_version(p_version_id uuid, p_decision text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_admin();
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v public.app_versions;
  a public.apps;
  v_label text;
begin
  select * into v from public.app_versions where id = p_version_id for update;
  if not found then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Decide approve or reject' using errcode = '22023';
  end if;
  if v.status = 'superseded' then
    raise exception 'v% was replaced by v%. Review that one instead', v.version,
      coalesce((select s.version from public.app_versions s where s.id = v.superseded_by), '?') using errcode = '55000';
  end if;
  if v.status <> 'in_review' then
    raise exception 'This version isn''t in review' using errcode = '55000';
  end if;
  if p_decision = 'reject' and v_notes is null then
    raise exception 'Tell the developer why' using errcode = '22023';
  end if;
  if char_length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Notes must be at most 2000 characters' using errcode = '22023';
  end if;

  select * into a from public.apps where slug = v.app_slug for update;
  v_label := a.name || ' ' || v.version;
  update public.app_versions
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         reviewed_at = now(), reviewed_by = v_me, review_notes = v_notes
   where id = v.id
  returning * into v;

  if p_decision = 'approve' then
    if a.published_version_id is null then
      v := public.publish_version(v.id);
      perform public.notify_developer(a, v, 'version_published',
        v_label || ' was approved and is now live.' || coalesce(' Reviewer notes: ' || v_notes, ''));
    else
      perform public.notify_developer(a, v, 'version_approved',
        v_label || ' was approved. Publish it when you''re ready.' || coalesce(' Reviewer notes: ' || v_notes, ''));
    end if;
  else
    if a.published_version_id is null then
      update public.apps set status = 'rejected', updated_at = now() where slug = a.slug;
    end if;
    perform public.notify_developer(a, v, 'version_rejected', v_label || ' was not approved: ' || v_notes);
  end if;
  return public.app_version_json(v);
end;
$$;

revoke execute on function public.next_patch_version(text, text) from public, anon, authenticated;
-- Signed-in developers (managed_version checks ownership).
revoke execute on function public.revise_app_version(uuid, text, jsonb, text) from public, anon;
grant execute on function public.revise_app_version(uuid, text, jsonb, text) to authenticated;
