-- =========================================================================
-- Add an "OTHER" (not-coral) label option with a free-text note, and
-- keyboard-shortcut-friendly save flow support.
-- Run this AFTER 0001_init.sql and 0002_add_names.sql.
-- =========================================================================

-- Allow a free-text note on any annotation (used by OTHER, optional elsewhere).
alter table public.annotations
  add column if not exists note text;

-- Widen the label check constraint to include 'OTHER'.
alter table public.annotations
  drop constraint if exists annotations_label_check;

alter table public.annotations
  add constraint annotations_label_check
  check (label in ('LC', 'PB', 'DC', 'DCA', 'OTHER'));

-- Replace save_annotation to accept and store the optional note, and to
-- require one when the label is OTHER (mirrors the frontend requirement,
-- so the rule holds even if something calls the RPC directly).
create or replace function public.save_annotation(p_patch_id uuid, p_label text, p_note text default null)
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

  if p_label not in ('LC','PB','DC','DCA','OTHER') then
    raise exception 'Invalid label: %', p_label;
  end if;

  if p_label = 'OTHER' and (p_note is null or btrim(p_note) = '') then
    raise exception 'A note is required when the label is OTHER';
  end if;

  insert into public.annotations (patch_id, annotator_id, label, note)
  values (p_patch_id, auth.uid(), p_label, nullif(btrim(p_note), ''))
  on conflict (patch_id)
  do update set
    label = excluded.label,
    note = excluded.note,
    annotator_id = auth.uid(),
    updated_at = now()
  returning * into v_row;

  update public.patches
  set status = 'annotated', locked_by = null, locked_at = null
  where id = p_patch_id;

  return v_row;
end;
$$;
