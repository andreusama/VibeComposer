import { useState, useRef, useEffect, useCallback } from 'react';
import { NodeResizer } from '@xyflow/react';
import { DIMENSIONS, ENERGY_LABELS, rgbToHsl, moodFromHsl, energyIdFromValue } from '../constants.js';
import { composeProgression } from '../utils/api.js';

const TOTAL_STEPS = 5;
const STEP_LABELS = ['phrase', 'location', 'photo', 'genre & colour', 'energy & texture'];

// Same five accents already in the Manuscript palette — picking one is a
// quick proxy for "mood" (via the same rgbToHsl/moodFromHsl the old RGB
// sliders used) without needing a full color picker inside a canvas node.
const SWATCHES = [
  { hex: '#4552D6', rgb: { r: 69,  g: 82,  b: 214 } },
  { hex: '#1F6F63', rgb: { r: 31,  g: 111, b: 99  } },
  { hex: '#B8842A', rgb: { r: 184, g: 132, b: 42  } },
  { hex: '#B04A4A', rgb: { r: 176, g: 74,  b: 74  } },
  { hex: '#6E6A62', rgb: { r: 110, g: 106, b: 98  } },
];

// Ported as-is from the old photo.js — samples a downscaled canvas and
// averages non-extreme pixels so a single dominant color falls out without
// any external library.
function extractDominantRgb(imgEl) {
  const canvas = document.createElement('canvas');
  const SIZE = 50;
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (brightness > 30 && brightness < 230) {
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      count++;
    }
  }
  if (!count) return { r: 107, g: 140, b: 174 };
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

export default function VibeComposeNode({ id, data, selected }) {
  const { onGenerated, onClose } = data;

  const [step, setStep] = useState(1);
  const [phrase, setPhrase] = useState('');
  const [place, setPlace] = useState('');
  const [photo, setPhoto] = useState(null); // { url, rgb }
  const [genre, setGenre] = useState(null);
  const [colourIdx, setColourIdx] = useState(0);
  const [texture, setTexture] = useState(null);
  const [energy, setEnergy] = useState(50);
  const [easyMode, setEasyMode] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState(null);
  const [justGenerated, setJustGenerated] = useState(null);
  const fileInputRef = useRef(null);
  const photoUrlRef = useRef(null);

  useEffect(() => {
    if (!justGenerated) return;
    const t = setTimeout(() => setJustGenerated(null), 4000);
    return () => clearTimeout(t);
  }, [justGenerated]);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    const url = URL.createObjectURL(file);
    photoUrlRef.current = url;
    const img = new Image();
    img.onload = () => setPhoto({ url, rgb: extractDominantRgb(img) });
    img.src = url;
  }, []);

  useEffect(() => () => { if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current); }, []);

  const handleGenerate = async () => {
    setComposing(true);
    setComposeError(null);
    const swatch = SWATCHES[colourIdx];
    const [h, s, l] = rgbToHsl(swatch.rgb.r, swatch.rgb.g, swatch.rgb.b);
    const mood = moodFromHsl(h, s, l);
    const energyId = energyIdFromValue(energy);

    try {
      const composed = await composeProgression({
        phrase: phrase.trim() || null,
        place: place.trim() || null,
        mood, energy: energyId, flavour: genre, texture, easyMode,
      });
      const meta = {
        mood, energy: energyId, flavour: genre, texture, easyMode,
        place: place.trim() || null, photoUrl: photo?.url || null, rgb: swatch.rgb,
      };
      onGenerated?.(composed, meta);
      setJustGenerated(composed.title);
      setStep(1); setPhrase(''); setPlace(''); setPhoto(null);
      setGenre(null); setColourIdx(0); setTexture(null); setEnergy(50); setEasyMode(true);
    } catch (e) {
      setComposeError(e.message === 'LIMIT_REACHED'
        ? "today's free composes are used up — try again tomorrow."
        : "couldn't compose — try again.");
    } finally {
      setComposing(false);
    }
  };

  const goNext = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div className={`vibe-node${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={340} minHeight={380} isVisible={selected} />

      <div className="vibe-head">
        <div className="vibe-head-title">
          <span className="vibe-sparkle">✦</span>
          <span>Create progression by vibes</span>
        </div>
        <button className="vibe-icon-btn nodrag" onClick={() => onClose?.(id)} title="remove this tool">✕</button>
      </div>

      <div className="vibe-step-track">
        {Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => i + 2).map((n) => (
          <div key={n} className={`vibe-seg ${n < step ? 'done' : n === step ? 'current' : 'upcoming'}`}>
            <div className="vibe-seg-fill" />
          </div>
        ))}
      </div>
      <div className="vibe-step-label">step <strong>{String(step).padStart(2, '0')}</strong> · {STEP_LABELS[step - 1]}</div>

      {justGenerated && (
        <div className="vibe-generated-banner">✓ generated "{justGenerated}" — added to the canvas</div>
      )}
      {composeError && <div className="vibe-error-banner">{composeError}</div>}

      <div className="vibe-stage nodrag nowheel">
        {step === 1 && (
          <div className="vibe-page">
            <div className="vibe-page-title">What's the feeling?</div>
            <div className="vibe-page-hint">One line is enough. Write it the way it sounds in your head, not the way it'd read in the song.</div>
            <textarea
              className="vibe-phrase-box"
              placeholder="a quiet night after the rain stopped…"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              maxLength={280}
            />
          </div>
        )}

        {step === 2 && (
          <div className="vibe-page">
            <div className="vibe-page-title">Where does it happen?</div>
            <div className="vibe-page-hint">A real place, a remembered one, or one you're inventing — all count.</div>
            <div className="vibe-loc-visual">
              <div className="vibe-loc-ring" />
              <span className="vibe-loc-pin">📍</span>
            </div>
            <div className="vibe-input-field">
              <input
                placeholder="Caldes de Montbui, matinada"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="vibe-page">
            <div className="vibe-page-title">Show, don't tell</div>
            <div className="vibe-page-hint">A photo the progression should sound like. Colour and light matter more than the subject.</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
            {photo ? (
              <div className="vibe-photo-preview" onClick={() => fileInputRef.current?.click()}>
                <img src={photo.url} alt="mood reference" />
                <div className="vibe-photo-swatch" style={{ background: `rgb(${photo.rgb.r},${photo.rgb.g},${photo.rgb.b})` }} />
              </div>
            ) : (
              <div
                className={`vibe-dropzone${dragOver ? ' drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              >
                <span className="vibe-dropzone-icon">🖼</span>
                <div className="vibe-dropzone-main">Drop an image, or click to upload</div>
                <div className="vibe-dropzone-sub">JPG, PNG — used only as a mood reference</div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="vibe-page">
            <div className="vibe-page-title">Genre &amp; colour</div>
            <div className="vibe-page-hint">Pick the frame, then the hue that matches it.</div>
            <div className="vibe-field-label">genre</div>
            <div className="vibe-chips">
              {DIMENSIONS.flavour.tags.map((tag) => (
                <button
                  key={tag}
                  className={`vibe-chip${genre === tag ? ' sel' : ''}`}
                  onClick={() => setGenre(genre === tag ? null : tag)}
                >{tag}</button>
              ))}
            </div>
            <div className="vibe-field-label">colour</div>
            <div className="vibe-swatches">
              {SWATCHES.map((sw, i) => (
                <button
                  key={sw.hex}
                  className={`vibe-sw${colourIdx === i ? ' sel' : ''}`}
                  style={{ background: sw.hex }}
                  onClick={() => setColourIdx(i)}
                  title={sw.hex}
                />
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="vibe-page">
            <div className="vibe-page-title">Energy &amp; texture</div>
            <div className="vibe-page-hint">How much movement does it have, and what does it feel like under the hand.</div>
            <div className="vibe-field-label">energy</div>
            <input
              type="range" min="0" max="100" value={energy}
              className="vibe-energy-slider"
              onChange={(e) => setEnergy(Number(e.target.value))}
            />
            <div className="vibe-energy-labels">
              {ENERGY_LABELS.map((l) => (
                <span key={l.id} className={energyIdFromValue(energy) === l.id ? 'on' : ''}>{l.id}</span>
              ))}
            </div>
            <div className="vibe-field-label">texture</div>
            <div className="vibe-chips">
              {DIMENSIONS.texture.tags.map((tag) => (
                <button
                  key={tag}
                  className={`vibe-chip${texture === tag ? ' sel' : ''}`}
                  onClick={() => setTexture(texture === tag ? null : tag)}
                >{tag}</button>
              ))}
            </div>
            <label className="vibe-easy-toggle">
              <input type="checkbox" checked={easyMode} onChange={(e) => setEasyMode(e.target.checked)} />
              <span>easy chords only</span>
            </label>
          </div>
        )}
      </div>

      <div className="vibe-nav nodrag">
        <button className="vibe-nav-btn" onClick={goPrev} disabled={step === 1}>‹</button>
        <div className="vibe-dots">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <div key={n} className={`vibe-dot${n === step ? ' on' : ''}`} />
          ))}
        </div>
        {step === TOTAL_STEPS ? (
          <button className="vibe-generate-btn" onClick={handleGenerate} disabled={composing}>
            {composing ? 'composing…' : '✦ generate'}
          </button>
        ) : (
          <button className="vibe-nav-btn" onClick={goNext}>›</button>
        )}
      </div>
    </div>
  );
}
