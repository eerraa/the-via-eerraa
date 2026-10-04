import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {getKeycodes} from './key';
import {mapEvtToKeycode} from './key-event';
import {RawKeycodeSequence, RawKeycodeSequenceAction} from './macro-api/types';
import {createMacroRecordingPreview} from './macro-recording-preview';

// Input is captured immediately. Only the preview is paced, so rendering a long
// recording cannot turn its render time into a recorded wait.
export const RECORDING_PREVIEW_INTERVAL_MS = 50;

export const useKeycodeRecorder = (
  enableRecording: boolean,
  recordDelays: boolean,
  smartOptimize = false,
  delaySupported = true,
) => {
  const [preview, setPreview] = useState({
    sequence: [] as RawKeycodeSequence,
    totalItems: 0,
    byteCount: 1,
  });
  const buffer = useRef<RawKeycodeSequence>([]);
  const processor = useRef(
    createMacroRecordingPreview(smartOptimize, delaySupported),
  );
  const processed = useRef(0);
  const lastEventTime = useRef<number>();
  const firstEventTime = useRef<number>();
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
    firstEventTime.current = undefined;
    processor.current = createMacroRecordingPreview(
      smartOptimize,
      delaySupported,
    );
    processed.current = 0;
    setPreview({sequence: [], totalItems: 0, byteCount: 1});
  }, [cancelPreview, smartOptimize, delaySupported]);
  // Stop, slot changes and unmount must read the input, not the last paint.
  const read = useCallback(() => buffer.current.slice(), []);

  useEffect(() => {
    if (!enableRecording) return;
    const record = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.repeat) return;
      const code = mapEvtToKeycode(event);
      if (!code || !keycodes.has(code)) return;
      firstEventTime.current ??= event.timeStamp;
      const time = Math.round(event.timeStamp - firstEventTime.current);
      if (recordDelays && lastEventTime.current !== undefined) {
        const delay = Math.max(0, time - lastEventTime.current);
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
          while (processed.current < buffer.current.length) {
            processor.current.append(buffer.current[processed.current++]);
          }
          setPreview(processor.current.read());
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

  return {...preview, reset, read};
};
