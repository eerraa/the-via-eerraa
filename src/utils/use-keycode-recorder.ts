import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {getKeycodes} from './key';
import {mapEvtToKeycode} from './key-event';
import {RawKeycodeSequence, RawKeycodeSequenceAction} from './macro-api/types';

// Input is captured immediately. Only the preview is paced, so rendering a long
// recording cannot turn its render time into a recorded wait.
export const RECORDING_PREVIEW_INTERVAL_MS = 50;

export const useKeycodeRecorder = (
  enableRecording: boolean,
  recordDelays: boolean,
) => {
  const [sequence, setSequence] = useState<RawKeycodeSequence>([]);
  const buffer = useRef<RawKeycodeSequence>([]);
  const lastEventTime = useRef<number>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const keycodes = useMemo(
    () =>
      new Set(
        getKeycodes().flatMap((menu) => menu.keycodes.map((k) => k.code)),
      ),
    [],
  );
  const cancelPreview = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const reset = useCallback(() => {
    cancelPreview();
    buffer.current = [];
    lastEventTime.current = undefined;
    setSequence([]);
  }, [cancelPreview]);
  // Stop, slot changes and unmount must read the input, not the last paint.
  const read = useCallback(() => buffer.current.slice(), []);

  useEffect(() => {
    if (!enableRecording) return;
    const record = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.repeat) return;
      const code = mapEvtToKeycode(event);
      if (!code || !keycodes.has(code)) return;
      const time = event.timeStamp;
      if (recordDelays && lastEventTime.current !== undefined) {
        const delay = Math.max(0, Math.round(time - lastEventTime.current));
        if (delay > 0)
          buffer.current.push([RawKeycodeSequenceAction.Delay, delay]);
      }
      buffer.current.push([
        event.type === 'keydown'
          ? RawKeycodeSequenceAction.Down
          : RawKeycodeSequenceAction.Up,
        code,
      ]);
      lastEventTime.current = time;
      if (timer.current === undefined) {
        timer.current = setTimeout(() => {
          timer.current = undefined;
          setSequence(read());
        }, RECORDING_PREVIEW_INTERVAL_MS);
      }
    };
    window.addEventListener('keydown', record);
    window.addEventListener('keyup', record);
    return () => {
      window.removeEventListener('keydown', record);
      window.removeEventListener('keyup', record);
      cancelPreview();
    };
  }, [enableRecording, recordDelays, keycodes, read, cancelPreview]);

  return {sequence, reset, read};
};
