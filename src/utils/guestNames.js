// Playful stand-in names for people who haven't given one — demo guests and
// link visitors — in the spirit of Google Docs' anonymous animals. See
// GLOSSARY.md ("Guest name").
export const GUEST_NAMES = [
  'Mozart venido a menos', 'Vibaldi', 'Vivaldi Cuatro Quesos', 'Beethoven con Tapones',
  'Chopin en Pijama', 'Bach to the Future', 'Schubert Inacabado', 'Händel y Grétel',
  'Brahms con Resaca', 'Ravel y su Bolero Infinito', 'Paganini sin Cuerdas', 'Rossini al Dente',
  'Wagner de Karaoke', 'Stravinsky sin Ritmo', 'Metrónomo Despistado', 'Corchea Cansada',
  'Semifusa Perdida', 'Bemol Misterioso', 'Sostenido Vergonzoso', 'Do de Pecho Prestado',
  'Diapasón Desafinado', 'Pentagrama de Cartón', 'Violín de Hojalata', 'Clave de Sol y Sombra',
  'Maestro sin Batuta', 'Fa Sostenido en la Ducha',
];

const STORAGE_KEY = 'vibecomposer_guest_name';

// A name per browser, not per visit: someone reopening a link should still be
// "Vibaldi". `random` is injectable so tests don't depend on Math.random.
export function guestName(random = Math.random) {
  try {
    const kept = localStorage.getItem(STORAGE_KEY);
    if (kept && GUEST_NAMES.includes(kept)) return kept;
  } catch { /* storage unavailable (private window) — a fresh name each time is fine */ }
  const picked = GUEST_NAMES[Math.min(GUEST_NAMES.length - 1, Math.floor(random() * GUEST_NAMES.length))];
  try { localStorage.setItem(STORAGE_KEY, picked); } catch { /* same */ }
  return picked;
}
