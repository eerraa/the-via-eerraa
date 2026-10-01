import {useEffect, useRef, useState} from 'react';
import {TestKeyState} from 'src/types/types';
import {ANSI_TEST_LAYOUT, locateTestKey, TestLayout} from './key-event';

type TestKeys = {[col: number]: TestKeyState};

// The test pane marks its settings with this attribute (panes/test.tsx).
const TEST_SETTINGS = '[data-key-test-settings]';
const CONTROL =
  'button, input, select, [role=switch], [role=slider], [role=combobox]';

/**
 * Whether a key goes to the test setting that has focus, so Tab, Space, Enter
 * and the arrows work there. Everywhere else, and for browser shortcuts even
 * there, the key test keeps the browser from acting on the key: no reload, zoom
 * or leaving the page mid-test.
 */
export const reachesSettingsControl = (evt: KeyboardEvent) => {
  const target = evt.target as Element | null;
  return (
    !evt.ctrlKey &&
    !evt.metaKey &&
    !evt.altKey &&
    !/^F\d+$/.test(evt.key) &&
    typeof target?.closest === 'function' &&
    !!target.closest(TEST_SETTINGS) &&
    !!target.closest(CONTROL)
  );
};

/** Keys still held when the page loses focus never get their keyup. */
export const releaseHeldKeys = (keys: TestKeys): TestKeys => {
  const held = Object.keys(keys).filter(
    (col) => keys[+col] === TestKeyState.KeyDown,
  );
  return held.length
    ? held.reduce((next, col) => ({...next, [col]: TestKeyState.KeyUp}), {
        ...keys,
      })
    : keys;
};

const UNPLACED_KEY_MS = 1500;

export const useGlobalKeys = (enableGlobalKeys: boolean) => {
  const [pressedKeys, setPressedKeys] = useState<TestKeys>({});
  const [layout, setLayout] = useState<TestLayout>(ANSI_TEST_LAYOUT);
  const [unplacedKey, setUnplacedKey] = useState<{
    name: string;
    id: number;
  } | null>(null);
  const layoutRef = useRef(layout);

  useEffect(() => {
    if (!enableGlobalKeys) {
      return;
    }
    let unplacedTimer: ReturnType<typeof setTimeout> | undefined;
    const record = (evt: KeyboardEvent, state: TestKeyState) => {
      if (!reachesSettingsControl(evt)) {
        evt.preventDefault();
      }
      const found = evt.repeat ? null : locateTestKey(evt, layoutRef.current);
      if (!found) {
        return;
      }
      if (found.col < 0) {
        if (state === TestKeyState.KeyDown) {
          clearTimeout(unplacedTimer);
          setUnplacedKey((last) => ({
            name: evt.key === 'Unidentified' ? evt.code : evt.key,
            id: (last?.id ?? 0) + 1,
          }));
          unplacedTimer = setTimeout(
            () => setUnplacedKey(null),
            UNPLACED_KEY_MS,
          );
        }
        return;
      }
      if (found.layout !== layoutRef.current) {
        layoutRef.current = found.layout;
        setLayout(found.layout);
      }
      setPressedKeys((keys) =>
        keys[found.col] === state ? keys : {...keys, [found.col]: state},
      );
    };
    const downHandler = (evt: KeyboardEvent) =>
      record(evt, TestKeyState.KeyDown);
    const upHandler = (evt: KeyboardEvent) => record(evt, TestKeyState.KeyUp);
    // Held keys stop sounding and show as tested once the page loses focus.
    const releaseHandler = () => setPressedKeys(releaseHeldKeys);
    const visibilityHandler = () => {
      if (document.hidden) {
        releaseHandler();
      }
    };
    window.addEventListener('keydown', downHandler);
    window.addEventListener('keyup', upHandler);
    window.addEventListener('blur', releaseHandler);
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      window.removeEventListener('keydown', downHandler);
      window.removeEventListener('keyup', upHandler);
      window.removeEventListener('blur', releaseHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
      clearTimeout(unplacedTimer);
      setUnplacedKey(null);
    };
  }, [enableGlobalKeys]);

  return {pressedKeys, setPressedKeys, layout, unplacedKey};
};
