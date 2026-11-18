# VibeComposer

A songwriting app: write lyrics with an AI co-writer (La Musa) and place chords by hand on the words. Terms below are the ones the team has agreed to use.

## Access

**Guest session**:
Any anonymous Supabase session — someone using the app without an account.
_Avoid_: anonymous user, temporary account

**Demo guest**:
A guest session opened with "try the demo", which owns a ready-made sample song.
_Avoid_: demo user, trial user

**Link visitor**:
Someone viewing a shared song without an account. Read-only, no session, no collaborator slot.
_Avoid_: invited guest, anonymous user

**Guest name**:
The playful stand-in name shown for a guest session or link visitor (e.g. "Vibaldi"), in place of a real name.
_Avoid_: nickname, username

**Input mode**:
Whether the person is currently using touch or a mouse, taken from the last pointer they used.
_Avoid_: device type, platform

## Song structure

**Part**:
One block of a song — a verse, a chorus, a bridge — holding its lines and their chords.
_Avoid_: note, section, node, block
