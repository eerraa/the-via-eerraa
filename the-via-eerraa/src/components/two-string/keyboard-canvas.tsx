import React, {useMemo} from 'react';
import {shallowEqual} from 'react-redux';
import {
  calculateKeyboardFrameDimensions,
  CSSVarObject,
} from 'src/utils/keyboard-rendering';
import {useReportKeyboardFrame} from 'src/utils/keyboard-area';
import styled from 'styled-components';
import {
  KeyboardCanvasProps,
  KeyboardCanvasContentProps,
} from 'src/types/keyboard-rendering';
import {Case} from './case';
import {KeyGroup} from './key-group';
import {MatrixLines} from './matrix-lines';
export const KeyboardCanvas: React.FC<KeyboardCanvasProps<React.MouseEvent>> = (
  props,
) => {
  const {containerDimensions, shouldHide, cornerNote, ...otherProps} = props;
  const {width, height} = useMemo(
    () => calculateKeyboardFrameDimensions(otherProps.keys),
    [otherProps.keys],
  );
  useReportKeyboardFrame(otherProps.mode, width, height);
  const containerHeight = containerDimensions.height;
  const minPadding = 35;
  const ratio =
    Math.min(
      Math.min(
        1,
        containerDimensions &&
          containerDimensions.width /
            ((CSSVarObject.keyWidth + CSSVarObject.keyXSpacing) * width -
              CSSVarObject.keyXSpacing +
              minPadding * 2),
      ),
      containerHeight /
        ((CSSVarObject.keyHeight + CSSVarObject.keyYSpacing) * height -
          CSSVarObject.keyYSpacing +
          minPadding * 2),
    ) || 1;

  return (
    <div
      style={{
        transform: `scale(${ratio}, ${ratio})`,
        opacity: shouldHide ? 0 : 1,
        position: 'absolute',
        pointerEvents: shouldHide ? 'none' : 'all',
      }}
    >
      <KeyboardCanvasContent {...otherProps} width={width} height={height} />
      {cornerNote ? (
        // At its own size, however small the picture is drawn.
        <CornerNote style={{transform: `scale(${1 / ratio})`}}>
          {cornerNote}
        </CornerNote>
      ) : null}
    </div>
  );
};
const KeyboardGroup = styled.div`
  position: relative;
`;
const CornerNote = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  padding-top: 8px;
  transform-origin: top right;
`;

const KeyboardCanvasContent: React.FC<
  KeyboardCanvasContentProps<React.MouseEvent>
> = React.memo((props) => {
  const {
    matrixKeycodes,
    keys,
    definition,
    pressedKeys,
    mode,
    showMatrix,
    selectable,
    width,
    height,
  } = props;

  return (
    <KeyboardGroup>
      <Case width={width} height={height} />
      <KeyGroup
        {...props}
        keys={keys}
        mode={mode}
        matrixKeycodes={matrixKeycodes}
        selectable={selectable}
        definition={definition}
        pressedKeys={pressedKeys}
      />
      {showMatrix && (
        <MatrixLines
          keys={keys}
          rows={definition.matrix.rows}
          cols={definition.matrix.cols}
          width={width}
          height={height}
        />
      )}
    </KeyboardGroup>
  );
}, shallowEqual);
