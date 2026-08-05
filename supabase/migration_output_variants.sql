-- Run this in the Supabase SQL editor. Lets a song have several final-mix
-- nodes (variants) instead of exactly one — drops the old one-per-song
-- uniqueness and adds a title so variants can be told apart.

alter table song_outputs drop constraint if exists song_outputs_song_id_key;
alter table song_outputs add column if not exists title text not null default 'Final mix';
