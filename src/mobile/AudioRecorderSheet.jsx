import { useState, useEffect, useRef, useCallback } from 'react';
import { uploadLineAudio } from '../canvas/lineAudioData.js';

// Opened by a 400ms long-press on a LineRow (see NoteEditorScreen.jsx) —
// recording starts immediately on mount, matching the voice-memo UX the
// gesture already implies ("press and hold to talk"), not a separate
// "press record" step. Browser-native getUserMedia + MediaRecorder, no new
// package; on Android this requires the RECORD_AUDIO manifest permission
// (see android/app/src/main/AndroidManifest.xml) once this ships as a
// native build — Capacitor's WebView forwards the permission prompt
// automatically, nothing else to wire up.
export default function AudioRecorderSheet({ sectionId, songId, lineIndex, onClose, onSaved }) {
  const [state, setState] = useState('requesting'); // requesting | recording | saving | error
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.start();
        startedAtRef.current = Date.now();
        setState('recording');
        timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)), 250);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.name === 'NotAllowedError' ? 'microphone permission denied' : (err.message || 'could not start recording'));
        setState('error');
      });
    return () => {
      cancelled = true;
      cleanupStream();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    cleanupStream();
    onClose();
  }, [cleanupStream, onClose]);

  const handleStop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    setState('saving');
    const durationSeconds = (Date.now() - startedAtRef.current) / 1000;
    recorder.onstop = async () => {
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const { data, error: uploadError } = await uploadLineAudio(sectionId, songId, lineIndex, blob, durationSeconds);
      if (uploadError) {
        setError(uploadError.message || 'could not save the recording');
        setState('error');
        return;
      }
      onSaved?.(data);
      onClose();
    };
    recorder.stop();
  }, [cleanupStream, sectionId, songId, lineIndex, onSaved, onClose]);

  return (
    <div className="ts-backdrop" onClick={state === 'recording' ? undefined : onClose}>
      <div className="ar-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />

        {state === 'requesting' && <p className="ar-status">asking for the microphone…</p>}

        {state === 'error' && (
          <>
            <p className="ar-status ar-error">{error}</p>
            <button className="ar-btn-cancel" onClick={onClose}>Close</button>
          </>
        )}

        {(state === 'recording' || state === 'saving') && (
          <>
            <div className="ar-pulse-wrap">
              <span className={`ar-pulse${state === 'recording' ? ' ar-pulse-live' : ''}`} />
            </div>
            <p className="ar-timer">{String(Math.floor(elapsed / 60)).padStart(1, '0')}:{String(elapsed % 60).padStart(2, '0')}</p>
            <div className="ar-actions">
              <button className="ar-btn-cancel" onClick={handleCancel} disabled={state === 'saving'}>Discard</button>
              <button className="ar-btn-stop" onClick={handleStop} disabled={state === 'saving'}>
                {state === 'saving' ? 'Saving…' : 'Stop'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
