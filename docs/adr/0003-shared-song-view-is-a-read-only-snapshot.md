---
status: accepted
---
# A shared song opened without an account is a read-only snapshot

Opening a share link without signing in shows the song's final read-through (each Part set apart, chords shown), fetched through a security-definer function and refreshed every few seconds. It creates no session, takes no collaborator slot and leaves nothing to clean up. Signing in from that view joins the song as an editor under the existing invite rules (four people at most, single-use, expiry); viewing never spends a single-use link. An owner can make a link that never grants editing.

**Considered:** an anonymous session with a "viewer" collaborator role, which would update live but means splitting read from write across the ~15 tables whose row-level policies use `is_song_participant` today. Revisit only if live viewing becomes a real need.
