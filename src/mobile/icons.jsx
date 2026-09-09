// One line-icon set for the whole mobile UI — replaces the grab-bag of emoji
// (🌐 🔁 🎙 🗑 💬 ✦ …) and stray typographic glyphs (‹ › ✕ ↔ ↩ …) that used to
// stand in for icons. All drawn on a 24-unit grid, 1.75 stroke, currentColor,
// round caps/joins, so they inherit size from `font-size`/`width` and colour
// from the button they sit in, and read as one family.
//
// Usage: <IcMuse /> (20px default) or <IcTrash size={18} />.

function Svg({ size = 20, filled = false, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── navigation / disclosure ─────────────────────────────────────────────── */
export const IcChevronLeft = (p) => <Svg {...p}><path d="M15 4.5 7.5 12 15 19.5" /></Svg>;
export const IcChevronRight = (p) => <Svg {...p}><path d="M9 4.5 16.5 12 9 19.5" /></Svg>;
export const IcChevronUp = (p) => <Svg {...p}><path d="M4.5 15 12 7.5 19.5 15" /></Svg>;
export const IcChevronDown = (p) => <Svg {...p}><path d="M4.5 9 12 16.5 19.5 9" /></Svg>;
export const IcMore = (p) => (
  <Svg {...p} filled>
    <circle cx="5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="19" cy="12" r="1.9" />
  </Svg>
);
export const IcClose = (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IcPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IcCheck = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;

/* ── the muse ────────────────────────────────────────────────────────────── */
export const IcMuse = (p) => (
  <Svg {...p}>
    <path d="M12 2.5c.9 4.6 1.9 5.6 6.5 6.5-4.6.9-5.6 1.9-6.5 6.5-.9-4.6-1.9-5.6-6.5-6.5C10.1 8.1 11.1 7.1 12 2.5Z" />
    <path d="M18.5 15c.4 2 .9 2.5 2.9 2.9-2 .4-2.5.9-2.9 2.9-.4-2-.9-2.5-2.9-2.9 2-.4 2.5-.9 2.9-2.9Z" />
  </Svg>
);

/* ── editor actions ──────────────────────────────────────────────────────── */
export const IcPencil = (p) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5 17.5 10.5" /></Svg>;
export const IcRhyme = (p) => <Svg {...p}><path d="M8 6.5 3.5 12 8 17.5M4 12h16M16 6.5 20.5 12 16 17.5" /></Svg>;
export const IcUndo = (p) => <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Svg>;
export const IcRedo = (p) => <Svg {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Svg>;
export const IcSyllables = (p) => <Svg {...p}><path d="M4 6h16M4 12h11M4 18h14" /></Svg>;
export const IcHistory = (p) => (
  <Svg {...p}>
    <path d="M3.5 9A9 9 0 1 1 4 15" />
    <path d="M3.5 4v5h5" />
    <path d="M12 7.5V12l3.5 2" />
  </Svg>
);
export const IcRegenerate = (p) => <Svg {...p}><path d="M20 11a8 8 0 1 0-.6 4" /><path d="M20 4v6h-6" /></Svg>;

/* ── list / project chrome ───────────────────────────────────────────────── */
export const IcSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const IcTrash = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    <path d="M9.5 7V4.5h5V7" />
  </Svg>
);
export const IcGlobe = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.4 2.3 3.6 5.4 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.4-3.6-8.5S9.6 5.8 12 3.5Z" />
  </Svg>
);
export const IcMetronome = (p) => <Svg {...p}><path d="M8 21 12 4h.5L17 21z" /><path d="M6.5 16h11" /><path d="M12 15l4.5-3.5" /></Svg>;
export const IcRepeat = (p) => <Svg {...p}><path d="M17 3l3.5 3.5L17 10" /><path d="M20.5 6.5H9A4.5 4.5 0 0 0 4.5 11v1" /><path d="M7 21l-3.5-3.5L7 14" /><path d="M3.5 17.5H15a4.5 4.5 0 0 0 4.5-4.5v-1" /></Svg>;
export const IcCopy = (p) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></Svg>;
export const IcExport = (p) => <Svg {...p}><path d="M12 15V3.5" /><path d="M8 7l4-4 4 4" /><path d="M4 13v5a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" /></Svg>;
export const IcTools = (p) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="7" cy="17" r="2.2" />
  </Svg>
);

/* ── audio ───────────────────────────────────────────────────────────────── */
export const IcMic = (p) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21M8.5 21h7" />
  </Svg>
);
export const IcPlay = (p) => <Svg {...p} filled><path d="M8 5.5v13l11-6.5z" /></Svg>;
export const IcPause = (p) => <Svg {...p} filled><rect x="6.5" y="5" width="3.6" height="14" rx="1" /><rect x="13.9" y="5" width="3.6" height="14" rx="1" /></Svg>;

/* ── sheets / misc ───────────────────────────────────────────────────────── */
export const IcComment = (p) => <Svg {...p}><path d="M20 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3v3.5L11.5 17H20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" /></Svg>;
export const IcImage = (p) => <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="m21 15-4.5-4.5L7 20" /></Svg>;
export const IcNote = (p) => <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M13.5 3v5H19M9 13h6M9 17h4" /></Svg>;
export const IcPaperclip = (p) => <Svg {...p}><path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4l8.5-8.5a3 3 0 0 1 4.3 4.3l-8.5 8.5a1.5 1.5 0 0 1-2.2-2.1l7.8-7.8" /></Svg>;
export const IcMusicNote = (p) => <Svg {...p}><path d="M9 17V5l11-2v12" /><circle cx="6" cy="17" r="3" /><circle cx="17" cy="15" r="3" /></Svg>;
export const IcRadioOn = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none" /></Svg>;
export const IcRadioOff = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /></Svg>;
