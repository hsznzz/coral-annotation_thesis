-- =========================================================================
-- Add first_name / last_name to profiles, and teach the auto-profile
-- trigger to pull them from the sign-up form's metadata.
-- Run this AFTER 0001_init.sql (safe to run once on a project that
-- already has 0001 applied).
-- =========================================================================

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

-- Replace the trigger function so new signups store first/last name too.
-- (Existing users just get null names until they're updated separately.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'annotator' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
