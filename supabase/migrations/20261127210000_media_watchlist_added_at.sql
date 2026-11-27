-- True watchlist membership timestamp (Movies saved+unwatched / TV plan).
-- Independent of media_entries.created_at / updated_at so rating edits cannot fake "added" order.
-- Null means unknown (legacy rows); clients must not invent dates.

alter table public.media_entries
  add column if not exists watchlist_added_at timestamptz;

comment on column public.media_entries.watchlist_added_at is
  'When the title most recently joined the user watchlist (movie saved unwatched, or show plan). Cleared when leaving that list. Null for legacy/unknown.';
