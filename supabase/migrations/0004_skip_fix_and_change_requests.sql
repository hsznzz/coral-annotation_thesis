-- =========================================================================
-- 1) Fix "Skip" not actually skipping.
--    claim_next_patch() previously re-served the same patch you were just
--    looking at, because it stays locked to you (locked_by = auth.uid())
--    and is the lowest patch_index unannotated row — the exact row the
--    query picks again. We add an optional p_exclude_patch_id so the
--    frontend can say "give me the next one, NOT this one" when skipping.
-- 2) Add an annotator "request a change" workflow: annotators can propose
--    a different label for an already-annotated patch; only an admin can
--    actually apply it (via review_change_request).
-- Run this AFTER 0001, 0002, 0003.
-- =========================================================================

create or replace function public.claim_next_patch(lock_minutes int default 5, p_exclude_patch_id uuid default null)
returns table (
  id uuid, image_id uuid, patch_index int, storage_path text,
  x int, y int, width int, height int, status text,
  locked_by uuid, locked_at timestamptz, created_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_patch_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select p.id into v_patch_id
  from public.patches p
  where p.status = 'unannotated'
    and (p_exclude_patch_id is null or p.id <> p_exclude_patch_id)
    and (
      p.locked_by is null
      or p.locked_by = auth.uid()
      or p.locked_at < now() - (lock_minutes || ' minutes')::interval
    )
  order by p.patch_index asc
  for update skip locked
  limit 1;

  if v_patch_id is null then
    return;
  end if;

  update public.patches
  set locked_by = auth.uid(), locked_at = now()
  where patches.id = v_patch_id;

  return query
  select p.id, p.image_id, p.patch_index, p.storage_path, p.x, p.y, p.width, p.height,
         p.status, p.locked_by, p.locked_at, p.created_at
  from public.patches p
  where p.id = v_patch_id;
end;
$$;

-- =========================================================================
-- Annotation change requests
-- =========================================================================
create table if not exists public.annotation_change_requests (
  id                uuid primary key default gen_random_uuid(),
  annotation_id     uuid not null references public.annotations(id) on delete cascade,
  patch_id          uuid not null references public.patches(id) on delete cascade,
  requested_by      uuid not null references public.profiles(id) on delete set null,
  current_label     text not null,
  requested_label   text not null check (requested_label in ('LC', 'PB', 'DC', 'DCA', 'OTHER')),
  requested_note    text,
  reason            text,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_change_requests_status on public.annotation_change_requests(status);
create index if not exists idx_change_requests_requested_by on public.annotation_change_requests(requested_by);
create index if not exists idx_change_requests_annotation on public.annotation_change_requests(annotation_id);

alter table public.annotation_change_requests enable row level security;

create policy "change_requests_select_authenticated"
  on public.annotation_change_requests for select
  to authenticated
  using (true);

-- Direct inserts/updates are blocked; everything goes through the
-- security-definer RPCs below so business rules (one pending request per
-- annotation, admin-only review, etc.) can't be bypassed.
create policy "change_requests_insert_admin_or_rpc"
  on public.annotation_change_requests for insert
  to authenticated
  with check (false);

create policy "change_requests_update_admin_or_rpc"
  on public.annotation_change_requests for update
  to authenticated
  using (false);

-- An annotator requests a different label for a patch that's already
-- been annotated (by anyone). Only one pending request per annotation
-- at a time — resubmitting while pending just updates that same request.
create or replace function public.request_annotation_change(
  p_annotation_id uuid,
  p_requested_label text,
  p_requested_note text default null,
  p_reason text default null
)
returns public.annotation_change_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_annotation public.annotations;
  v_row public.annotation_change_requests;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_requested_label not in ('LC', 'PB', 'DC', 'DCA', 'OTHER') then
    raise exception 'Invalid label: %', p_requested_label;
  end if;

  select * into v_annotation from public.annotations where id = p_annotation_id;
  if v_annotation.id is null then
    raise exception 'Annotation not found';
  end if;

  update public.annotation_change_requests
  set requested_label = p_requested_label,
      requested_note = nullif(btrim(p_requested_note), ''),
      reason = nullif(btrim(p_reason), ''),
      created_at = now()
  where annotation_id = p_annotation_id
    and requested_by = auth.uid()
    and status = 'pending'
  returning * into v_row;

  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.annotation_change_requests
    (annotation_id, patch_id, requested_by, current_label, requested_label, requested_note, reason)
  values
    (p_annotation_id, v_annotation.patch_id, auth.uid(), v_annotation.label,
     p_requested_label, nullif(btrim(p_requested_note), ''), nullif(btrim(p_reason), ''))
  returning * into v_row;

  return v_row;
end;
$$;

-- Admin-only: approve (applies the requested label to the annotation) or
-- reject a pending change request.
create or replace function public.review_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns public.annotation_change_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_request public.annotation_change_requests;
  v_row public.annotation_change_requests;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can review change requests';
  end if;

  select * into v_request from public.annotation_change_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'Change request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  if p_approve then
    update public.annotations
    set label = v_request.requested_label,
        note = case when v_request.requested_label = 'OTHER' then v_request.requested_note else null end,
        annotator_id = auth.uid(),
        updated_at = now()
    where id = v_request.annotation_id;
  end if;

  update public.annotation_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(btrim(p_review_note), '')
  where id = p_request_id
  returning * into v_row;

  return v_row;
end;
$$;
