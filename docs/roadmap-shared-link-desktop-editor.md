# Next three deliveries (agreed 2026-11-18)

Each ships on its own branch and merges on its own. Decisions: ADR 0001 (desktop = expanded mobile UI), 0002 (gestures branch on input mode), 0003 (shared view = read-only snapshot). Vocabulary: `GLOSSARY.md`.

## 1. `shared_readonly_link`
- Opening a share link without an account shows the final read-through of the song, Parts set apart, chords shown, refreshed every few seconds. A visible "Sign in to edit" joins as an editor.
- The owner can create a link that never grants editing (checkbox, "can edit on sign-in" on by default).
- Viewing never burns a single-use link.
- Demo guests are cleaned up after 3 days (was 1).
- Guests and link visitors get a **guest name** from the pool below.

## 2. `desktop_expanded_ui`
- The node canvas and the phone frame go. Wide screens show the mobile screens in a centred, wider column; bottom sheets become centred dialogs. Tempo stays (mobile settings). Generator, studio, output node: parked.
- A global **input mode** (touch or mouse), taken from the last pointer used, exposed as `data-input="touch|mouse"` and a hook.
- Mouse behaviour: press-and-drag chords after ~4 px (no long-press), hover × to delete a chord, hover icon instead of swipe-to-delete on project rows, sheets close with Esc / click outside / button, no long-press line copy. Touch is unchanged.

## 3. `editor_multiline_selection`
- Version A: lines not being edited are plain text with native selection across lines; a toolbar offers Copy / Cut / Delete, and typing over a multi-line selection is handled in code.
- Version B: one continuous editable surface per Part.
- A switch in the editor's tools menu changes between them, saved on the device, on phones and desktop. After testing, the version that loses is removed.
- The read-through (preview) containers stay copyable as they are.

## Guest-name pool
Mozart venido a menos · Vibaldi · Vivaldi Cuatro Quesos · Beethoven con Tapones · Chopin en Pijama · Bach to the Future · Schubert Inacabado · Händel y Grétel · Brahms con Resaca · Ravel y su Bolero Infinito · Paganini sin Cuerdas · Rossini al Dente · Wagner de Karaoke · Stravinsky sin Ritmo · Metrónomo Despistado · Corchea Cansada · Semifusa Perdida · Bemol Misterioso · Sostenido Vergonzoso · Do de Pecho Prestado · Diapasón Desafinado · Pentagrama de Cartón · Violín de Hojalata · Clave de Sol y Sombra · Maestro sin Batuta · Fa Sostenido en la Ducha
