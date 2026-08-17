// ─── Muse profile refresh ───────────────────────────────────────────────────
// Deliberately its own file: everything about "when" (N) and "how" (the
// summary prompt) a block's muse_profile gets updated lives here and only
// here, so either can change without touching the conversation flow in
// MuseFloatNode or the companion prompt in museApi.js.
//
// No song-level rollup — that used to exist (summarizeSongProfile,
// building a cached "song_summary") and got removed: the muse already
// gets the full raw song text every turn via describeSongStructure in
// museApi.js, real and always current, so a second AI call to
// re-summarize what the model already reads in full was pure redundancy.

import { incrementMuseInteraction, getRecentMuseUserMessages, saveMuseSummary } from './museData.js';
import { summarizeBlockProfile } from '../utils/museApi.js';

export const MUSE_PROFILE_UPDATE_EVERY = 5;

/**
 * Call after every user turn (each time they ask the muse something on a
 * given block) — always increments first (atomically, via an RPC, see
 * schema.sql's muse_increment_interaction), then only refreshes the
 * block's summary once its own count has reached N. >= rather than a
 * strict === guards against ever getting stuck if a previous refresh
 * failed after incrementing but before the reset-to-0 landed.
 * @param {{songId: string, sectionId: string, existingBlockProfile?: string}} args
 * @returns {Promise<string|null>} the updated block summary on success,
 *   null if it didn't run or failed outright — never throws, a failed
 *   background refresh shouldn't break the turn that triggered it.
 */
export async function recordMuseTurnAndMaybeUpdateProfile({ songId, sectionId, existingBlockProfile = '' }) {
  const { data: newCount, error: incrementError } = await incrementMuseInteraction(sectionId, songId);
  if (incrementError || newCount < MUSE_PROFILE_UPDATE_EVERY) return null;

  const { data: recent, error: fetchError } = await getRecentMuseUserMessages(sectionId, MUSE_PROFILE_UPDATE_EVERY);
  if (fetchError || !recent.length) return null;

  try {
    // Oldest-first, so the summary reads like a chronological account of
    // what the user has been asking for rather than most-recent-first.
    const userMessages = [...recent].reverse().map((e) => e.content);
    const updatedProfile = await summarizeBlockProfile({ currentSummary: existingBlockProfile, userMessages });
    const { error } = await saveMuseSummary(sectionId, songId, updatedProfile);
    return error ? null : updatedProfile;
  } catch (err) {
    console.error('muse profile update failed:', err);
    return null;
  }
}
