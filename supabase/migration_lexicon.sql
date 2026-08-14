-- Adds the `lexicon` table — the Cultural Resonance Engine's deterministic
-- rhyme source (see src/utils/lexicon.js, scripts/seed-lexicon-kaikki.ts).
-- Additive only — safe to re-run, nothing here touches existing data.
--
-- Global reference data, not user data: no song_id/user_id, RLS is public
-- READ / no public WRITE (seeding only happens via the service-role key,
-- bypassing RLS — see scripts/seed-lexicon-kaikki.ts).

create table if not exists lexicon (
  id               bigint generated always as identity primary key,
  word             text not null,
  lang_code        varchar(5) not null default 'es',
  syllables        int not null,
  stress_type      text check (stress_type in ('aguda', 'llana', 'esdrujula')),
  rhyme_key        varchar(20) not null,
  charisma_score   int not null default 5 check (charisma_score between 1 and 10),
  freq_rank        int,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (word, lang_code)
);

create index if not exists idx_lexicon_rhyme on lexicon(lang_code, rhyme_key, charisma_score desc);

alter table lexicon enable row level security;

drop policy if exists lexicon_public_read on lexicon;
create policy lexicon_public_read on lexicon
  for select using (true);
