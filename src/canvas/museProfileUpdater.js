// ─── Muse profile refresh ───────────────────────────────────────────────────
// Deliberately its own file: everything about "when" (N) and "how"
// (the summary prompt) the muse's per-register profile gets updated lives
// here and only here, so either can change without touching the
// conversation flow in NoteSidePanel or the companion prompt in museApi.js.

import { incrementMuseInteraction, getRecentMuseUserMessages, saveMuseSummary } from './museData.js';
import { summarizeMuseProfile } from '../utils/museApi.js';

export const MUSE_PROFILE_UPDATE_EVERY = 5;

/**
 * Call after every user turn (each time they ask the muse something) —
 * always increments first (atomically, via an RPC, see schema.sql's
 * muse_increment_interaction), then only refreshes the summary once that
 * register's count has actually reached N. >= rather than a strict ===
 * guards against ever getting stuck if a previous refresh failed after
 * incrementing but before the reset-to-0 landed.
 * @returns {Promise<{register: string, summary: string}|null>} the updated
 *   summary on success, null if it didn't run or failed (never throws — a
 *   failed background refresh shouldn't break the turn that triggered it).
 */
export async function recordMuseTurnAndMaybeUpdateProfile({ songId, register, existingSummary }) {
  const { data: newCount, error: incrementError } = await incrementMuseInteraction(songId, register);
  if (incrementError || newCount < MUSE_PROFILE_UPDATE_EVERY) return null;

  const { data: recent, error: fetchError } = await getRecentMuseUserMessages(
    songId, register, MUSE_PROFILE_UPDATE_EVERY
  );
  if (fetchError || !recent.length) return null;

  try {
    // Oldest-first, so the summary reads like a chronological account of
    // what the user has been asking for rather than most-recent-first.
    const userMessages = [...recent].reverse().map((e) => e.content);
    const updatedSummary = await summarizeMuseProfile({ register, existingSubProfile: existingSummary, userMessages });
    const { error } = await saveMuseSummary(songId, register, updatedSummary);
    return error ? null : { register, summary: updatedSummary };
  } catch (err) {
    console.error('muse profile update failed:', err);
    return null;
  }
}
