-- Run this in the Supabase SQL editor. Adds the song-level language/dialect
-- setting the rhyme module (src/utils/rhyme.js) reads lines as. Defaults to
-- Castilian/central so existing songs behave sensibly with no action needed.

alter table songs add column if not exists lyric_language text not null default 'es';
alter table songs add column if not exists lyric_dialect text not null default 'central';

alter table songs drop constraint if exists songs_lyric_language_dialect_check;
alter table songs
  add constraint songs_lyric_language_dialect_check
  check (
    (lyric_language = 'es' and lyric_dialect = 'central') or
    (lyric_language = 'ca' and lyric_dialect in ('oriental', 'occidental'))
  );
