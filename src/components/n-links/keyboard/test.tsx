import type {VIADefinitionV2, VIADefinitionV3} from '@the-via/reader';
import {VIAKey} from '@the-via/reader';
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import {TestKeyboardSounds} from 'src/components/void/test-keyboard-sounds';
import {
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
} from 'src/store/devicesSlice';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {getSelectedKeymap, setLayer} from 'src/store/keymapSlice';
import {getTestKeyboardSoundsSettings} from 'src/store/settingsSlice';
import {DisplayMode, NDimension} from 'src/types/keyboard-rendering';
import {TestKeyState} from 'src/types/types';
import {getTestKeyboardKeys, matrixKeycodes} from 'src/utils/key-event';
import {getKeyboardRowPartitions} from 'src/utils/keyboard-rendering';
import {useGlobalKeys} from 'src/utils/use-global-keys';
import {useMatrixTest} from 'src/utils/use-matrix-test';
import {PROTOCOL_GAMMA} from 'src/utils/keyboard-api';
import styled, {keyframes} from 'styled-components';
import {useLocation} from 'wouter';
import fullKeyboardDefinition from '../../../utils/test-keyboard-definition.json';
import {TestContext} from '../../panes/test';
import {getKeyboardCanvas} from './configure';
const EMPTY_ARR = [] as any[];
const EMPTY_KEYMAP: number[] = [];

const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

// A key the picture has no place for, named for a moment in its corner.
const UnplacedKeyName = styled.div`
  color: var(--color_label);
  font-size: 18px;
  white-space: nowrap;
  pointer-events: none;
  animation: ${fadeOut} 1.5s ease-in forwards;
`;

export const Test = (props: {dimensions?: DOMRect; nDimension: NDimension}) => {
  const dispatch = useAppDispatch();
  const [path] = useLocation();
  const isShowingTest = path === '/test';
  const api = useAppSelector(getSelectedKeyboardAPI);
  const device = useAppSelector(getSelectedConnectedDevice);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const keyDefinitions = useAppSelector(getSelectedKeyDefinitions);
  const testKeyboardSoundsSettings = useAppSelector(
    getTestKeyboardSoundsSettings,
  );
  const selectedMatrixKeycodes = useAppSelector(
    (state) => getSelectedKeymap(state) || EMPTY_KEYMAP,
  );

  const [testContextObj, setTestContextObj] = useContext(TestContext);
  const matrixAvailable =
    !!api && !!device && !!selectedDefinition && device.protocol >= PROTOCOL_GAMMA;
  const showsBoard = matrixAvailable && testContextObj.testMatrix;
  const stopBoard = useCallback(() => {
    setTestContextObj((prev) => ({
      ...prev,
      testMatrix: false,
      matrixReadFailed: true,
    }));
  }, [setTestContextObj]);

  useEffect(() => {
    setTestContextObj((prev) =>
      prev.matrixAvailable === matrixAvailable
        ? prev
        : {...prev, matrixAvailable, testMatrix: false, matrixReadFailed: false},
    );
  }, [matrixAvailable, setTestContextObj]);

  // Each connected keyboard starts with the ordinary browser key test.
  useEffect(() => {
    setTestContextObj((prev) => ({
      ...prev,
      testMatrix: false,
      matrixReadFailed: false,
    }));
  }, [device?.path, setTestContextObj]);
  const globalKeys = useGlobalKeys(isShowingTest && !showsBoard);
  const {setPressedKeys: setGlobalPressedKeys} = globalKeys;
  const [matrixPressedKeys, setMatrixPressedKeys] = useMatrixTest(
    isShowingTest && showsBoard,
    api as any,
    device as any,
    selectedDefinition as any,
    stopBoard,
  );

  const clearTestKeys = useCallback(() => {
    setGlobalPressedKeys({});
    setMatrixPressedKeys(EMPTY_ARR);
  }, [setGlobalPressedKeys, setMatrixPressedKeys]);

  // Share the clear action without replacing the selected test mode.
  useEffect(() => {
    setTestContextObj((prev) =>
      prev.clearTestKeys === clearTestKeys ? prev : {...prev, clearTestKeys},
    );
  }, [setTestContextObj, clearTestKeys]);

  useEffect(() => {
    if (path !== '/test') {
      clearTestKeys();
      setTestContextObj((prev) => ({
        ...prev,
        testMatrix: false,
        matrixReadFailed: false,
      }));
    }
    if (path !== '/') {
      dispatch(setLayer(0));
    }
  }, [path]); // Empty array ensures that effect is only run on mount and unmount

  // A picture starts untested, including when the screen changes pictures.
  useEffect(() => {
    clearTestKeys();
  }, [showsBoard]);

  const fullKeys = useMemo(
    () => getTestKeyboardKeys(globalKeys.layout),
    [globalKeys.layout],
  );
  const testDefinition = (
    showsBoard ? selectedDefinition : fullKeyboardDefinition
  ) as VIADefinitionV2 | VIADefinitionV3;
  const testKeys = (showsBoard ? keyDefinitions : fullKeys) as VIAKey[];
  const testKeycodes = useMemo(
    () =>
      showsBoard
        ? selectedMatrixKeycodes
        : fullKeys.map(({col}) => matrixKeycodes[col]),
    [showsBoard, selectedMatrixKeycodes, fullKeys],
  );
  // Pressed states by matrix position: row * cols + col.
  const pressedByPosition = (
    showsBoard ? matrixPressedKeys : globalKeys.pressedKeys
  ) as TestKeyState[];
  const cols = testDefinition.matrix.cols;
  const testPressedKeys = useMemo(
    () => testKeys.map(({row, col}) => pressedByPosition[row * cols + col]),
    [testKeys, pressedByPosition, cols],
  );

  const {partitionedKeys} = useMemo(
    () => getKeyboardRowPartitions(testKeys),
    [testKeys],
  );
  const partitionedPressedKeys: TestKeyState[][] = partitionedKeys.map(
    (rowArray) =>
      rowArray.map(({row, col}) => pressedByPosition[row * cols + col]),
  );

  const {unplacedKey} = globalKeys;
  return (
    <>
      <TestKeyboard
        definition={testDefinition}
        keys={testKeys}
        pressedKeys={testPressedKeys}
        matrixKeycodes={testKeycodes}
        containerDimensions={props.dimensions}
        nDimension={props.nDimension}
        cornerNote={
          unplacedKey ? (
            <UnplacedKeyName key={unplacedKey.id}>
              {unplacedKey.name}
            </UnplacedKeyName>
          ) : undefined
        }
      />
      {testKeyboardSoundsSettings.isEnabled && (
        <TestKeyboardSounds pressedKeys={partitionedPressedKeys} />
      )}
    </>
  );
};

const TestKeyboard = (props: {
  selectable?: boolean;
  containerDimensions?: DOMRect;
  pressedKeys?: TestKeyState[];
  matrixKeycodes: number[];
  keys: (VIAKey & {ei?: number})[];
  definition: VIADefinitionV2 | VIADefinitionV3;
  nDimension: NDimension;
  cornerNote?: ReactNode;
}) => {
  const {
    selectable,
    containerDimensions,
    matrixKeycodes,
    keys,
    pressedKeys,
    definition,
    nDimension,
    cornerNote,
  } = props;
  if (!containerDimensions) {
    return null;
  }

  const KeyboardCanvas = getKeyboardCanvas(nDimension);
  return (
    <KeyboardCanvas
      matrixKeycodes={matrixKeycodes}
      keys={keys}
      selectable={!!selectable}
      definition={definition}
      pressedKeys={pressedKeys}
      containerDimensions={containerDimensions}
      mode={DisplayMode.Test}
      cornerNote={cornerNote}
    />
  );
};
