import { setState } from '../state/store.js';
import { energyIdFromValue, paletteFromRgb } from '../constants.js';
import { buildSongStructure } from '../audio/songStructure.js';

// ─── Chord name → frequencies ──────────────────────────────────────────────────
const CHORD_FREQS = {
    'C': { bass: 65.41,  notes: [261.63, 329.63, 392.00] },
    'Cm': { bass: 65.41, notes: [261.63, 311.13, 392.00] },
    'Cmaj7': { bass: 65.41, notes: [261.63, 329.63, 392.00, 493.88] },
    'C7': { bass: 65.41, notes: [261.63, 329.63, 392.00, 466.16] },
    'D': { bass: 73.42,  notes: [293.66, 369.99, 440.00] },
    'Dm': { bass: 73.42, notes: [293.66, 349.23, 440.00] },
    'Dm7': { bass: 73.42, notes: [293.66, 349.23, 440.00, 523.25] },
    'E': { bass: 82.41,  notes: [329.63, 415.30, 493.88] },
    'Em': { bass: 82.41, notes: [329.63, 392.00, 493.88] },
    'E7': { bass: 82.41, notes: [329.63, 415.30, 493.88, 587.33] },
    'F': { bass: 87.31,  notes: [349.23, 440.00, 523.25] },
    'Fm': { bass: 87.31, notes: [349.23, 415.30, 523.25] },
    'Fmaj7': { bass: 87.31, notes: [349.23, 440.00, 523.25, 659.25] },
    'G': { bass: 98.00,  notes: [392.00, 493.88, 587.33] },
    'Gm': { bass: 98.00, notes: [392.00, 466.16, 587.33] },
    'G7': { bass: 98.00, notes: [392.00, 493.88, 587.33, 698.46] },
    'A': { bass: 110.00, notes: [440.00, 554.37, 659.25] },
    'Am': { bass: 110.00, notes: [440.00, 523.25, 659.25] },
    'Am7': { bass: 110.00, notes: [440.00, 523.25, 659.25, 783.99] },
    'B7': { bass: 123.47, notes: [493.88, 622.25, 740.00, 880.00] },
    'Bb': { bass: 116.54, notes: [466.16, 587.33, 698.46] },
    'Bm': { bass: 123.47, notes: [493.88, 587.33, 740.00] },
};

function getChordFreqs(name) {
    if (CHORD_FREQS[name]) return CHORD_FREQS[name];
    const root = name.replace(/[^A-Gb#]/g, '');
    return CHORD_FREQS[root] || CHORD_FREQS['Am'];
}

const ENERGY_BPM = { quiet: 68, mellow: 80, medium: 95, vibrant: 115, intense: 132 };

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
    const { progression } = state;
    const energyId = energyIdFromValue(state.energy);
    const bpm      = ENERGY_BPM[energyId] || 95;
    const accent   = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];

    const chordBoxes = progression.progression.map((ch, i) => `
        <div class="studio-chord-box" id="studio-chord${i}">
            <div class="studio-chord-name">${ch.chord}</div>
            <div class="studio-chord-feel">${ch.feel}</div>
        </div>
    `).join('');

    return `
        <div class="header">
            <h1>vibe composer</h1>
            <span class="tagline">${progression.title}</span>
        </div>
        <div class="studio-wrap">

            <div class="studio-meta">
                <div class="studio-title">${progression.title}</div>
                <div class="studio-bpm">
                    <span class="studio-bpm-number">${bpm}</span>
                    <span class="studio-bpm-label">BPM</span>
                </div>
            </div>

            <!-- Mode tabs -->
            <div class="studio-tabs">
                <button class="studio-tab active" id="tab-loop">LOOP</button>
                <button class="studio-tab" id="tab-song">SONG STRUCTURE</button>
            </div>

            <!-- Loop mode -->
            <div id="mode-loop">
                <div class="studio-chord-track">${chordBoxes}</div>
            </div>

            <!-- Song structure mode -->
            <div id="mode-song" style="display:none">
                <div class="studio-timeline" id="studio-timeline"></div>
                <div class="studio-section-panel" id="studio-section-panel">
                    <div class="studio-section-top">
                        <div class="studio-section-name" id="studio-section-name">—</div>
                        <div class="studio-section-insight" id="studio-section-insight"></div>
                    </div>
                    <div class="studio-chord-row" id="studio-chord-row"></div>
                </div>
                <div class="studio-theory-note" id="studio-theory-note">press play to start the song</div>
            </div>

            <div class="studio-section-label">DRAWBARS <span class="studio-hint">drag to shape the tone</span></div>
            <div class="studio-drawbars" id="studio-drawbars"></div>

            <div class="studio-leslie-row">
                <span class="studio-section-label">LESLIE</span>
                <button class="studio-leslie-btn" id="sl-off">OFF</button>
                <button class="studio-leslie-btn active" id="sl-slow" style="border-color:${accent};color:${accent}">SLOW ♩</button>
                <button class="studio-leslie-btn" id="sl-fast">FAST ≋</button>
            </div>

            <div class="studio-sequencer" id="studio-sequencer"></div>

            <div class="studio-controls">
                <button class="studio-play-btn" id="studio-play" style="border-color:${accent};color:${accent}">▶ PLAY</button>
                <div class="studio-scope-wrap">
                    <canvas id="studio-scope" width="500" height="36"></canvas>
                </div>
            </div>

            <div class="studio-nav">
                <button class="ghost-btn" id="btn-back-result">← back to progression</button>
            </div>

        </div>
    `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
    const accent   = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];
    const energyId = energyIdFromValue(state.energy);
    const bpm      = ENERGY_BPM[energyId] || 95;
    document.documentElement.style.setProperty('--accent', accent);

    const CHORDS   = state.progression.progression.map(ch => getChordFreqs(ch.chord));
    const STEPS    = 16;
    const stepDur  = 60 / bpm / 4;

    const DRAWBAR_DEFS = [
        { label: "16'",  mult: 0.5 }, { label: "5⅓'", mult: 1.5 },
        { label: "8'",   mult: 1.0 }, { label: "4'",   mult: 2.0 },
        { label: "2⅔'", mult: 3.0 }, { label: "2'",   mult: 4.0 },
        { label: "1⅗'", mult: 5.0 }, { label: "1⅓'", mult: 6.0 },
        { label: "1'",   mult: 8.0 },
    ];

    let drawbarValues = [6, 5, 8, 7, 5, 3, 1, 0, 0];
    let leslieRate    = 0.7;

    const DRUM_PATTERNS = {
        kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
        snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        chh:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
        ohh:   [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1],
    };
    let pattern = JSON.parse(JSON.stringify(DRUM_PATTERNS));

    // ─── Song structure state ──────────────────────────────────────────────────
    let songMode       = false;
    let songStructure  = null;
    let songSectionIdx = 0;
    let songStepCount  = 0;
    const STEPS_PER_SECTION = STEPS * 4; // 4 bars per section

    // ─── Audio state ───────────────────────────────────────────────────────────
    let audioCtx = null, masterGain = null, analyser = null;
    let isPlaying = false, currentStep = 0, nextStepTime = 0;
    let schedulerID = null, loopCount = 0, chordIndex = 0;

    // ── Build drawbars ─────────────────────────────────────────────────────────
    const dbEl = document.getElementById('studio-drawbars');
    DRAWBAR_DEFS.forEach((db, i) => {
        const col = document.createElement('div');
        col.className = 'studio-db-col';
        col.innerHTML = `
            <div class="studio-db-val" id="sdbval${i}">${drawbarValues[i]}</div>
            <div class="studio-db-track" id="sdbtrack${i}">
                <div class="studio-db-fill" id="sdbfill${i}" style="height:${drawbarValues[i]/8*100}%;background:${i < 2 ? '#c05020' : i < 4 ? accent : '#4080c0'}"></div>
            </div>
            <div class="studio-db-label">${db.label}</div>
        `;
        dbEl.appendChild(col);

        const track = col.querySelector('.studio-db-track');
        let dragging = false;
        function setFromEvent(e) {
            const rect   = track.getBoundingClientRect();
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const pct    = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            drawbarValues[i] = Math.round(pct * 8);
            document.getElementById(`sdbfill${i}`).style.height = (drawbarValues[i]/8*100) + '%';
            document.getElementById(`sdbval${i}`).textContent   = drawbarValues[i];
        }
        track.addEventListener('mousedown', e => { dragging = true; setFromEvent(e); });
        track.addEventListener('touchstart', e => { dragging = true; setFromEvent(e); e.preventDefault(); }, { passive: false });
        document.addEventListener('mousemove', e => { if (dragging) setFromEvent(e); });
        document.addEventListener('touchmove', e => { if (dragging) setFromEvent(e); });
        document.addEventListener('mouseup',  () => dragging = false);
        document.addEventListener('touchend', () => dragging = false);
    });

    // ── Leslie ─────────────────────────────────────────────────────────────────
    function setLeslie(rate, btnId) {
        leslieRate = rate;
        ['sl-off','sl-slow','sl-fast'].forEach(id => {
            const b = document.getElementById(id);
            b.classList.remove('active'); b.style.borderColor = ''; b.style.color = '';
        });
        const active = document.getElementById(btnId);
        active.classList.add('active'); active.style.borderColor = accent; active.style.color = accent;
    }
    document.getElementById('sl-off').addEventListener('click',  () => setLeslie(0,   'sl-off'));
    document.getElementById('sl-slow').addEventListener('click', () => setLeslie(0.7, 'sl-slow'));
    document.getElementById('sl-fast').addEventListener('click', () => setLeslie(6.1, 'sl-fast'));

    // ── Sequencer ──────────────────────────────────────────────────────────────
    const seqEl = document.getElementById('studio-sequencer');
    const ROWS  = [
        { id: 'kick',  label: 'KICK',  cls: 'studio-kick'  },
        { id: 'snare', label: 'SNARE', cls: 'studio-snare' },
        { id: 'chh',   label: 'C.HH',  cls: 'studio-chh'   },
        { id: 'ohh',   label: 'O.HH',  cls: 'studio-ohh'   },
    ];

    ROWS.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'studio-seq-row';
        rowEl.innerHTML = `<div class="studio-seq-label">${row.label}</div>`;
        const wrap = document.createElement('div');
        wrap.className = 'studio-steps';
        [0,1,2,3].forEach(beat => {
            if (beat > 0) { const d = document.createElement('div'); d.className = 'studio-beat-div'; wrap.appendChild(d); }
            const g = document.createElement('div'); g.className = 'studio-group';
            for (let s = 0; s < 4; s++) {
                const idx = beat * 4 + s;
                const btn = document.createElement('div');
                btn.className = `studio-step ${row.cls}${pattern[row.id][idx] ? ' on' : ''}`;
                btn.dataset.row = row.id; btn.dataset.step = idx;
                btn.addEventListener('click', () => { pattern[row.id][idx] ^= 1; btn.classList.toggle('on', !!pattern[row.id][idx]); });
                g.appendChild(btn);
            }
            wrap.appendChild(g);
        });
        rowEl.appendChild(wrap);
        seqEl.appendChild(rowEl);
    });

    // ── Audio engine ───────────────────────────────────────────────────────────
    function initAudio() {
        audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain(); masterGain.gain.value = 0.7;
        analyser   = audioCtx.createAnalyser(); analyser.fftSize = 256;
        masterGain.connect(analyser); analyser.connect(audioCtx.destination);
    }

    function playKick(t) {
        const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.frequency.setValueAtTime(160, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(1.2, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        osc.connect(g); g.connect(masterGain); osc.start(t); osc.stop(t + 0.45);
    }

    function playSnare(t) {
        const buf  = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.25, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const hpf = audioCtx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 1800;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
        src.connect(hpf); hpf.connect(g); g.connect(masterGain); src.start(t); src.stop(t + 0.25);
        const tone = audioCtx.createOscillator(), tg = audioCtx.createGain();
        tone.frequency.value = 185; tg.gain.setValueAtTime(0.2, t); tg.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        tone.connect(tg); tg.connect(masterGain); tone.start(t); tone.stop(t + 0.1);
    }

    function playHihat(t, open) {
        const buf  = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.1, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const hpf = audioCtx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 9000;
        const g = audioCtx.createGain();
        const decay = open ? 0.12 : 0.035;
        g.gain.setValueAtTime(open ? 0.22 : 0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay);
        src.connect(hpf); hpf.connect(g); g.connect(masterGain); src.start(t); src.stop(t + decay + 0.01);
    }

    function playBass(t, freq, dur) {
        const osc = audioCtx.createOscillator();
        const lpf = audioCtx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 300;
        const g = audioCtx.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.55, t); g.gain.setValueAtTime(0.55, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.01, t + dur * 0.95);
        osc.connect(lpf); lpf.connect(g); g.connect(masterGain); osc.start(t); osc.stop(t + dur);
    }

    function playHammond(t, notes, dur) {
        const ctx     = audioCtx;
        const clipper = ctx.createWaveShaper();
        const n = 512, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i*2/n)-1; curve[i] = (3/2)*x*(1-(x*x)/3)*0.8; }
        clipper.curve = curve;
        const envGain = ctx.createGain();
        envGain.gain.setValueAtTime(0, t);
        envGain.gain.linearRampToValueAtTime(0.65, t + 0.015);
        envGain.gain.setValueAtTime(0.65, t + dur - 0.06);
        envGain.gain.linearRampToValueAtTime(0, t + dur);
        let lfo = null, lfoGain = null;
        if (leslieRate > 0) {
            lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = leslieRate;
            lfoGain = ctx.createGain(); lfoGain.gain.value = leslieRate > 1 ? 0.22 : 0.12;
            lfo.connect(lfoGain); lfoGain.connect(envGain.gain);
        }
        const vibratoLFO = ctx.createOscillator(); vibratoLFO.type = 'sine';
        vibratoLFO.frequency.value = leslieRate > 0 ? leslieRate * 1.03 : 0;
        const vibratoDepth = ctx.createGain();
        vibratoDepth.gain.value = leslieRate > 1 ? 8 : (leslieRate > 0 ? 4 : 0);
        clipper.connect(envGain); envGain.connect(masterGain);
        notes.forEach((freq, noteIdx) => {
            const noteVol  = [0.9, 0.65, 0.45][noteIdx] || 0.3;
            const noteGain = ctx.createGain(); noteGain.gain.value = noteVol; noteGain.connect(clipper);
            const clickBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.009), ctx.sampleRate);
            const cd = clickBuf.getChannelData(0);
            for (let i = 0; i < cd.length; i++) cd[i] = (Math.random()*2-1)*(1-i/cd.length)*0.7;
            const clickSrc = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
            const clickG = ctx.createGain(); clickG.gain.value = 0.12;
            clickSrc.connect(clickG); clickG.connect(noteGain); clickSrc.start(t); clickSrc.stop(t + 0.015);
            DRAWBAR_DEFS.forEach((db, dbIdx) => {
                const level = drawbarValues[dbIdx]; if (level === 0) return;
                const osc = ctx.createOscillator(), oscGain = ctx.createGain();
                osc.type = 'sine'; osc.frequency.value = freq * db.mult;
                osc.detune.value = (Math.random()-0.5)*2.5;
                vibratoLFO.connect(vibratoDepth); vibratoDepth.connect(osc.detune);
                oscGain.gain.value = (level/8)*0.055;
                osc.connect(oscGain); oscGain.connect(noteGain);
                osc.start(t); osc.stop(t + dur + 0.1);
            });
        });
        if (lfo) { lfo.start(t); lfo.stop(t + dur + 0.1); }
        vibratoLFO.start(t); vibratoLFO.stop(t + dur + 0.1);
    }

    const BASS_PATTERN = [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0];
    let lastHighlighted = {};
    const ROW_IDS = ['kick','snare','chh','ohh'];
    const ROW_CLS = ['studio-kick','studio-snare','studio-chh','studio-ohh'];

    // ── Scheduler ──────────────────────────────────────────────────────────────
    function getCurrentChord() {
        if (songMode && songStructure) {
            const section   = songStructure[songSectionIdx];
            const chordIdx  = Math.floor(songStepCount / STEPS) % section.chords.length;
            return section.chords[chordIdx];
        }
        return CHORDS[chordIndex];
    }

    function scheduleStep(step, t) {
        const chord = getCurrentChord();
        if (pattern.kick[step])  playKick(t);
        if (pattern.snare[step]) playSnare(t);
        if (pattern.chh[step])   playHihat(t, false);
        if (pattern.ohh[step])   playHihat(t, true);
        if (BASS_PATTERN[step])  playBass(t, chord.bass, stepDur * 1.8);
        if (step === 0)          playHammond(t, chord.notes, stepDur * 15.5);
    }

    function updateUI(step) {
        ROW_IDS.forEach((id, ri) => {
            if (lastHighlighted[id] != null) {
                const prev = document.querySelector(`.${ROW_CLS[ri]}[data-step="${lastHighlighted[id]}"]`);
                if (prev) prev.classList.remove('playing');
            }
            const el = document.querySelector(`.${ROW_CLS[ri]}[data-step="${step}"]`);
            if (el && pattern[id][step]) el.classList.add('playing');
            lastHighlighted[id] = step;
        });
    }

    function updateLoopChordUI() {
        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`studio-chord${i}`);
            if (!el) continue;
            el.classList.toggle('active', i === chordIndex);
            el.style.borderColor = i === chordIndex ? accent : '';
            el.style.color       = i === chordIndex ? accent : '';
        }
    }

    function updateSongSectionUI() {
        if (!songStructure) return;
        const s = songStructure[songSectionIdx];

        document.querySelectorAll('.studio-tl-block').forEach((b, i) => {
            const isActive = i === songSectionIdx;
            b.classList.toggle('active', isActive);
            b.style.borderColor = isActive ? accent : '';
            b.style.color       = isActive ? accent : '';
        });

        const panel = document.getElementById('studio-section-panel');
        if (panel) {
            panel.className = `studio-section-panel studio-sp-${s.cls}`;
            document.getElementById('studio-section-name').textContent    = s.name;
            document.getElementById('studio-section-insight').textContent = s.insight;
        }

        const row = document.getElementById('studio-chord-row');
        if (row) {
            row.innerHTML = s.chords.map((ch, i) => `
                ${i > 0 ? '<span class="studio-chord-arrow">→</span>' : ''}
                <div class="studio-song-chord ${ch.borrowed ? 'borrowed' : ''}" id="studio-sc-${i}">
                    ${ch.borrowed ? '<div class="studio-borrowed-badge">♭ borrowed</div>' : ''}
                    <div class="studio-sc-name">${ch.name}</div>
                    <div class="studio-sc-fn">${ch.fn_bridge || ch.fn_verse || ''}</div>
                </div>
            `).join('');
        }

        // Sync leslie to section
        leslieRate = s.leslie;
        const leslieBtn = s.leslie === 0 ? 'sl-off' : s.leslie < 1 ? 'sl-slow' : 'sl-fast';
        ['sl-off','sl-slow','sl-fast'].forEach(id => {
            const b = document.getElementById(id);
            if (!b) return;
            b.classList.remove('active'); b.style.borderColor=''; b.style.color='';
        });
        const lb = document.getElementById(leslieBtn);
        if (lb) { lb.classList.add('active'); lb.style.borderColor = accent; lb.style.color = accent; }
    }

    function updateSongChordHighlight() {
        if (!songStructure) return;
        const s        = songStructure[songSectionIdx];
        const chordIdx = Math.floor(songStepCount / STEPS) % s.chords.length;
        document.querySelectorAll('.studio-song-chord').forEach((el, i) => {
            el.classList.toggle('active', i === chordIdx);
            el.style.borderColor = i === chordIdx ? accent : '';
        });
        const note = document.getElementById('studio-theory-note');
        if (note) {
            const ch = s.chords[chordIdx];
            note.textContent = `${ch.name} · ${ch.fn_bridge || ch.fn_verse || ''} · ${s.name.toLowerCase()}${ch.borrowed ? ' · ← modal mixture' : ''}`;
        }
    }

    function scheduler() {
        while (nextStepTime < audioCtx.currentTime + 0.1) {
            scheduleStep(currentStep, nextStepTime);
            updateUI(currentStep);
            currentStep = (currentStep + 1) % STEPS;

            if (currentStep === 0) {
                if (songMode && songStructure) {
                    songStepCount += STEPS;
                    // Advance section every 4 bars
                    if (songStepCount >= STEPS_PER_SECTION) {
                        songStepCount  = 0;
                        songSectionIdx = (songSectionIdx + 1) % songStructure.length;
                        updateSongSectionUI();
                    }
                    updateSongChordHighlight();
                } else {
                    loopCount++;
                    chordIndex = loopCount % 4;
                    updateLoopChordUI();
                }
            }
            nextStepTime += stepDur;
        }
        schedulerID = setTimeout(scheduler, 20);
    }

    function drawScope() {
        if (!isPlaying || !analyser) return;
        const canvas = document.getElementById('studio-scope');
        if (!canvas) return;
        const ctx2 = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(data);
        ctx2.fillStyle = '#0a0a0c'; ctx2.fillRect(0, 0, W, H);
        ctx2.strokeStyle = accent; ctx2.lineWidth = 1.5; ctx2.globalAlpha = 0.8;
        ctx2.beginPath();
        const sp = W / data.length;
        data.forEach((v, i) => { const x=i*sp, y=((v/128)-1)*(H/2)+H/2; i===0?ctx2.moveTo(x,y):ctx2.lineTo(x,y); });
        ctx2.stroke(); ctx2.globalAlpha = 1;
        requestAnimationFrame(drawScope);
    }

    function stopPlayback() {
        clearTimeout(schedulerID);
        isPlaying = false;
        document.getElementById('studio-play').textContent = '▶ PLAY';
        ROW_IDS.forEach((id, ri) => {
            document.querySelectorAll(`.${ROW_CLS[ri]}`).forEach(el => el.classList.remove('playing'));
        });
    }

    // ── Mode tabs ──────────────────────────────────────────────────────────────
    function buildTimeline() {
        const el = document.getElementById('studio-timeline');
        if (!el || !songStructure) return;
        el.innerHTML = '';
        songStructure.forEach((s, i) => {
            const b = document.createElement('div');
            b.className = `studio-tl-block studio-tl-${s.cls}`;
            b.id = `studio-tl${i}`;
            b.textContent = s.tag;
            el.appendChild(b);
        });
    }

    document.getElementById('tab-loop').addEventListener('click', () => {
        if (isPlaying) stopPlayback();
        songMode = false;
        document.getElementById('mode-loop').style.display = '';
        document.getElementById('mode-song').style.display = 'none';
        document.getElementById('tab-loop').classList.add('active');
        document.getElementById('tab-song').classList.remove('active');
    });

    document.getElementById('tab-song').addEventListener('click', () => {
        if (isPlaying) stopPlayback();
        songMode       = true;
        songSectionIdx = 0;
        songStepCount  = 0;
        songStructure  = buildSongStructure(state.progression.progression, state.progression.key);
        document.getElementById('mode-loop').style.display = 'none';
        document.getElementById('mode-song').style.display = '';
        document.getElementById('tab-song').classList.add('active');
        document.getElementById('tab-loop').classList.remove('active');
        buildTimeline();
        updateSongSectionUI();
    });

    // ── Play / Stop ────────────────────────────────────────────────────────────
    const playBtn = document.getElementById('studio-play');
    playBtn.addEventListener('click', () => {
        if (!audioCtx) initAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        isPlaying = !isPlaying;
        if (isPlaying) {
            currentStep   = 0; loopCount = 0; chordIndex = 0;
            songStepCount = 0; songSectionIdx = 0;
            nextStepTime  = audioCtx.currentTime + 0.05;
            playBtn.textContent = '■ STOP';
            if (songMode && songStructure) { updateSongSectionUI(); updateSongChordHighlight(); }
            else updateLoopChordUI();
            scheduler(); drawScope();
        } else {
            stopPlayback();
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(`studio-chord${i}`);
                if (el) { el.classList.remove('active'); el.style.borderColor=''; el.style.color=''; }
            }
        }
    });

    document.getElementById('btn-back-result').addEventListener('click', () => {
        clearTimeout(schedulerID);
        setState({ screen: 'result' });
    });
}