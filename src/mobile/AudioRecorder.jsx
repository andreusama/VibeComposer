import { useState, useEffect, useRef, useCallback } from 'react';
import { uploadNoteAudio, MAX_CLIP_SECONDS } from '../canvas/lineAudioData.js';
import { IcClose } from './icons.jsx';

// While a musician records a take they need to SEE the verse — so the
// recorder is not a sheet, it's a single floating red button in the bottom
// corner. Tap it to stop and save. Mounting IS "the user tapped ● Gravar",
// so capture starts immediately; auto-stops at MAX_CLIP_SECONDS.
export default function AudioRecorder({ sectionId, songId, onSaved, onCancel }) {
  const [state, setState] = useState('requesting'); // requesting | recording | saving | error
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const stopRef = useRef(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    setState('saving');
    const durationSeconds = Math.min(MAX_CLIP_SECONDS, (Date.now() - startedAtRef.current) / 1000);
    recorder.onstop = async () => {
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const { data, error: uploadError } = await uploadNoteAudio(sectionId, songId, blob, durationSeconds);
      if (uploadError) { setError(uploadError.message || 'no se pudo guardar'); setState('error'); return; }
      onSaved?.(data);
    };
    recorder.stop();
  }, [cleanupStream, sectionId, songId, onSaved]);
  stopRef.current = handleStop;

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        const recorder = new MediaRecorder(s);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.start();
        startedAtRef.current = Date.now();
        setState('recording');
        timerRef.current = setInterval(() => {
          const secs = (Date.now() - startedAtRef.current) / 1000;
          setElapsed(Math.floor(secs));
          if (secs >= MAX_CLIP_SECONDS) stopRef.current?.();
        }, 250);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.name === 'NotAllowedError' ? 'hace falta permiso del micrófono' : (err.message || 'no se pudo grabar'));
        setState('error');
      });
    return () => {
      cancelled = true;
      cleanupStream();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDiscard = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r && r.state === 'recording') { r.onstop = null; r.stop(); }
    cleanupStream();
    onCancel?.();
  }, [cleanupStream, onCancel]);

  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  if (state === 'error') {
    return (
      <div className="na-rec-error">
        <span>{error}</span>
        <button onClick={onCancel}>Cerrar</button>
      </div>
    );
  }

  return (
    <div className="na-rec-dock">
      <button className="na-rec-discard" onClick={handleDiscard} disabled={state === 'saving'} title="descartar"><IcClose size={16} /></button>
      <span className="na-rec-time">{mmss(elapsed)}</span>
      <button
        className={`na-rec-stop${state === 'recording' ? ' live' : ''}`}
        onClick={handleStop}
        disabled={state !== 'recording'}
        title="parar y guardar"
      >
        <span className="na-rec-square" />
      </button>
    </div>
  );
}
