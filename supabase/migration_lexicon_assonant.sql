-- Adds rhyme_key_assonant to `lexicon` — WORD_BANK needs a real rhyme
-- dictionary that distinguishes "rima consonante" from "rima asonante";
-- the table originally only stored the consonant key. Additive only —
-- safe to re-run, nothing here touches existing data. The column itself
-- stays null until scripts/backfill-assonant-key.ts populates it (derived
-- straight from the already-stored `word`, no need to re-stream Kaikki).

alter table lexicon add column if not exists rhyme_key_assonant varchar(20);

create index if not exists idx_lexicon_rhyme_assonant on lexicon(lang_code, rhyme_key_assonant, charisma_score desc);
