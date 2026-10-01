import {KeyColorType, type VIADefinitionV3, type VIAKey} from '@the-via/reader';
import {type FC, useEffect, useMemo, useRef, useState} from 'react';
import styled from 'styled-components';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedTheme} from 'src/store/settingsSlice';
import {getDarkenedColor} from 'src/utils/color-math';
import {DisplayMode} from 'src/types/keyboard-rendering';
import {
  getBoardDefinitions,
  parseUsbId,
  type FirmwareData,
} from 'src/utils/era-firmware-catalog';
import {useSize} from 'src/utils/use-size';
import {useKeyboardAreaHeight} from 'src/utils/keyboard-area';
import {KeyboardCanvas} from '../two-string/keyboard-canvas';

// A board's page shows that board where Configure shows the connected keyboard:
// its own layout, drawn from its bundled definition on the same background, keys
// without legends. It needs no device and no WebHID. Each half of a split pair
// already describes the whole board, so the left half's definition is drawn.

const Stage = styled.div<{$height: number}>`
  position: relative;
  flex: none;
  height: ${(props) => props.$height}px;
  overflow: hidden;
`;

const Background = styled.div<{$color: string}>`
  position: absolute;
  inset: 0;
  background: ${(props) =>
    `linear-gradient(30deg, rgba(150,150,150,1) 10%,${getDarkenedColor(
      props.$color,
    )} 50%, rgba(150,150,150,1) 90%)`};
`;

// Centre the board in the same full stage as Configure and key testing.
const Board = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const definitionRequests = new Map<number, Promise<VIADefinitionV3 | null>>();

const loadDefinition = (vendorProductId: number) => {
  let request = definitionRequests.get(vendorProductId);
  if (!request) {
    request = fetch(`/definitions/era/v3/${vendorProductId}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    definitionRequests.set(vendorProductId, request);
  }
  return request;
};

/** The board's keys, each layout option at its first choice as Design shows it. */
export const boardKeys = (definition: VIADefinitionV3): VIAKey[] => [
  ...definition.layouts.keys,
  ...Object.values(definition.layouts.optionKeys ?? {}).flatMap(
    (options) => options[0] ?? [],
  ),
];

const useBoardDefinition = (data: FirmwareData, boardId: string) => {
  const [definition, setDefinition] = useState<VIADefinitionV3 | null>(null);
  useEffect(() => {
    let current = true;
    setDefinition(null);
    const entries = getBoardDefinitions(data.manifest, boardId);
    const entry =
      entries.find((candidate) => candidate.id.endsWith('-left')) ?? entries[0];
    const vendorId = entry ? parseUsbId(entry.vendorId) : null;
    const productId = entry ? parseUsbId(entry.productId) : null;
    if (vendorId !== null && productId !== null) {
      loadDefinition(vendorId * 0x10000 + productId).then((loaded) => {
        if (current) {
          setDefinition(loaded);
        }
      });
    }
    return () => {
      current = false;
    };
  }, [data, boardId]);
  return definition;
};

export const FirmwareKeyboard: FC<{
  data: FirmwareData;
  boardId: string;
}> = ({data, boardId}) => {
  const theme = useAppSelector(getSelectedTheme);
  const board = useRef<HTMLDivElement>(null);
  const size = useSize(board);
  const areaHeight = useKeyboardAreaHeight(size?.width);
  const definition = useBoardDefinition(data, boardId);
  const keys = useMemo(
    () => (definition ? boardKeys(definition) : []),
    [definition],
  );
  return (
    <Stage data-firmware-keyboard={boardId} $height={areaHeight}>
      <Background $color={theme[KeyColorType.Accent].c} />
      <Board ref={board}>
        {definition && size && (
          <KeyboardCanvas
            keys={keys}
            matrixKeycodes={[]}
            selectable={false}
            definition={definition}
            containerDimensions={size}
            mode={DisplayMode.Design}
            showMatrix={false}
          />
        )}
      </Board>
    </Stage>
  );
};
