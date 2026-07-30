-- =========================================================================
-- Coral Annotation — initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- -------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  role        text not null default 'annotator' check (role in ('annotator', 'admin')),
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up / is invited.
-- The FIRST user ever created becomes admin automatically, so there is
-- always at least one admin without manual SQL. Every user after that
-- defaults to 'annotator' and can be promoted from the Admin dashboard.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'annotator' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------------
-- images
-- -------------------------------------------------------------------------
create table if not exists public.images (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  storage_path  text not null,       -- path inside the "coral-images" bucket
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- patches
-- -------------------------------------------------------------------------
create table if not exists public.patches (
  id            uuid primary key default gen_random_uuid(),
  image_id      uuid not null references public.images(id) on delete cascade,
  patch_index   int not null,
  storage_path  text not null,       -- path inside the "coral-patches" bucket
  x             int not null default 0,
  y             int not null default 0,
  width         int not null default 0,
  height        int not null default 0,
  status        text not null default 'unannotated' check (status in ('unannotated', 'annotated')),
  locked_by     uuid references public.profiles(id) on delete set null,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (image_id, patch_index)
);

create index if not exists idx_patches_status on public.patches(status);
create index if not exists idx_patches_locked on public.patches(locked_by, locked_at);

-- -------------------------------------------------------------------------
-- annotations  (one "current" row per patch; updated in place on re-label)
-- -------------------------------------------------------------------------
create table if not exists public.annotations (
  id            uuid primary key default gen_random_uuid(),
  patch_id      uuid not null references public.patches(id) on delete cascade,
  annotator_id  uuid not null references public.profiles(id) on delete set null,
  label         text not null check (label in ('LC', 'PB', 'DC', 'DCA')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (patch_id)
);

create index if not exists idx_annotations_annotator on public.annotations(annotator_id);
create index if not exists idx_annotations_label on public.annotations(label);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_annotations_updated_at on public.annotations;
create trigger trg_annotations_updated_at
  before update on public.annotations
  for each row execute function public.set_updated_at();

-- =========================================================================
-- Locking: claim_next_patch()
-- Atomically finds one unannotated, unlocked (or stale-locked) patch,
-- locks it to the calling user, and returns it. Prevents two annotators
-- from racing onto the same patch.
-- =========================================================================
create or replace function public.claim_next_patch(lock_minutes int default 5)
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

-- Release a lock without saving (e.g. user navigates away).
create or replace function public.release_patch_lock(p_patch_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.patches
  set locked_by = null, locked_at = null
  where id = p_patch_id and locked_by = auth.uid();
end;
$$;

-- Save/update an annotation and mark the patch annotated in one transaction.
create or replace function public.save_annotation(p_patch_id uuid, p_label text)
returns public.annotations
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.annotations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_label not in ('LC','PB','DC','DCA') then
    raise exception 'Invalid label: %', p_label;
  end if;

  insert into public.annotations (patch_id, annotator_id, label)
  values (p_patch_id, auth.uid(), p_label)
  on conflict (patch_id)
  do update set label = excluded.label, annotator_id = auth.uid(), updated_at = now()
  returning * into v_row;

  update public.patches
  set status = 'annotated', locked_by = null, locked_at = null
  where id = p_patch_id;

  return v_row;
end;
$$;

-- Promote a user to admin. Only callable by an existing admin.
create or replace function public.promote_to_admin(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can promote users';
  end if;
  update public.profiles set role = 'admin' where id = p_user_id;
end;
$$;

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.profiles enable row level security;
alter table public.images enable row level security;
alter table public.patches enable row level security;
alter table public.annotations enable row level security;

-- profiles: everyone authenticated can read all profiles (needed to show
-- "annotated by" names in the admin dashboard); users can only update
-- their own row's non-role fields... actually role changes go through
-- promote_to_admin() (security definer), so no direct UPDATE policy is
-- granted for role at all — only self-select and self-insert(handled by trigger).
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- images: any authenticated user can read (needed to display patches);
-- only admins can write (bulk import is expected to happen via the
-- Supabase dashboard / service-role script, not the frontend, but this
-- policy allows an in-app importer down the line if desired).
create policy "images_select_authenticated"
  on public.images for select
  to authenticated
  using (true);

create policy "images_write_admin"
  on public.images for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- patches: any authenticated user can read; direct writes are blocked —
-- all mutations happen through the security-definer functions above
-- (claim_next_patch / save_annotation / release_patch_lock), so annotators
-- can never edit x/y/width/height or forge a lock, and admins can still
-- manage patches directly if needed.
create policy "patches_select_authenticated"
  on public.patches for select
  to authenticated
  using (true);

create policy "patches_write_admin"
  on public.patches for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- annotations: annotators can read all annotations (needed for progress
-- stats / admin review) but can only insert/update their OWN annotations
-- directly; admins can write any annotation (for correcting mistakes).
-- Normal save flow still goes through save_annotation() for the
-- lock-release side effect, but these policies are the real backstop.
create policy "annotations_select_authenticated"
  on public.annotations for select
  to authenticated
  using (true);

create policy "annotations_insert_own"
  on public.annotations for insert
  to authenticated
  with check (annotator_id = auth.uid());

create policy "annotations_update_own_or_admin"
  on public.annotations for update
  to authenticated
  using (
    annotator_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    annotator_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "annotations_delete_admin"
  on public.annotations for delete
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- =========================================================================
-- Storage buckets (private; access via signed URLs generated server-side)
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('coral-images', 'coral-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('coral-patches', 'coral-patches', false)
on conflict (id) do nothing;

create policy "coral_images_read_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'coral-images');

create policy "coral_patches_read_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'coral-patches');

create policy "coral_buckets_write_admin"
  on storage.objects for all
  to authenticated
  using (
    bucket_id in ('coral-images', 'coral-patches')
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    bucket_id in ('coral-images', 'coral-patches')
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
