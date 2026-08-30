import React, {useState, useEffect, useRef} from 'react';
import styled from 'styled-components';
import {useAppSelector} from 'src/store/hooks';
import {getShowSliderValuesMode} from 'src/store/settingsSlice';
import {NumberInput} from 'src/components/panes/configure-panes/submenus/macros/keycode-sequence-components';

const Container = styled.span<{$mode?: number}>`
  display: inline-flex;
  align-items: center; /* Changed from space-between to center */
  line-height: initial;
  gap: ${(props) => (props.$mode === 1 ? '10px' : '8px')};
  width: ${(props) => {
    switch (props.$mode) {
      case 0:
        return '200px'; // Slider only
      case 1:
        return 'auto'; // Slider + value display
      case 2:
        return '280px'; // Slider + input field
      default:
        return '200px';
    }
  }};
`;

const SliderInput = styled.input.attrs({type: 'range'})<any>`
  accent-color: var(--color_accent);
  width: ${(props) => {
    switch (props.$mode) {
      case 0:
        return '100%'; // Full width when alone
      case 1:
        return '200px'; // Fixed width with value display
      case 2:
        return '180px'; // Smaller with input field
      default:
        return '100%';
    }
  }};
  flex: none;
`;

export const RangeValueDisplay = styled.span`
  text-align: right;
  font-size: 20px;
  color: var(--color_label_highlighted);
  white-space: nowrap;
  min-width: 40px;
`;

const StyledNumberInput = styled(NumberInput)`
  width: 80px;
  flex: none;
`;

export const AccentRange: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (x: number) => void;
    onInteractionComplete?: () => void;
    onInteractionCancel?: () => void;
  }
> = (props) => {
  const {
    onChange,
    onInteractionComplete,
    onInteractionCancel,
    ...inputProps
  } = props;
  // Get the display mode from Redux store (0, 1, or 2)
  const displayMode = useAppSelector(getShowSliderValuesMode);

  // Convert string mode to numeric mode
  const numericMode =
    displayMode === 'Slider Only'
      ? 0
      : displayMode === 'Slider & Show Value'
        ? 1
        : displayMode === 'Slider & Input Field'
          ? 2
          : 0;

  const currentValue = Number(
    inputProps.value ?? inputProps.defaultValue ?? inputProps.min ?? 0,
  );
  const [draftValue, setDraftValue] = useState(String(currentValue));
  const isEditing = useRef(false);
  const cancelDraft = useRef(false);
  const completionRef = useRef(onInteractionComplete);
  completionRef.current = onInteractionComplete;

  useEffect(
    () => () => {
      completionRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (!isEditing.current) {
      setDraftValue(String(currentValue));
    }
  }, [currentValue]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = +e.target.value;
    onChange(newValue);
  };

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftValue(e.target.value);
  };

  const handleNumberInputBlur = () => {
    isEditing.current = false;
    if (cancelDraft.current) {
      cancelDraft.current = false;
      setDraftValue(String(currentValue));
      (onInteractionCancel ?? onInteractionComplete)?.();
      return;
    }

    const parsedValue = Number(draftValue);
    if (
      draftValue.trim() === '' ||
      !Number.isFinite(parsedValue) ||
      !Number.isInteger(parsedValue)
    ) {
      setDraftValue(String(currentValue));
      onInteractionComplete?.();
      return;
    }
    if (parsedValue !== currentValue) {
      // Keep the controlled value authoritative. The parent may constrain the
      // requested value, including resolving it back to currentValue.
      setDraftValue(String(currentValue));
      onChange(parsedValue);
    } else {
      setDraftValue(String(currentValue));
    }
    onInteractionComplete?.();
  };

  const handleNumberInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      cancelDraft.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <Container $mode={numericMode}>
      {/* Mode 1: Show value display */}
      {numericMode === 1 && (
        <RangeValueDisplay>{currentValue}</RangeValueDisplay>
      )}

      {/* Always show slider */}
      <SliderInput
        {...inputProps}
        $mode={numericMode} /* Pass numeric mode here too */
        value={currentValue}
        onChange={handleSliderChange}
        onPointerUp={(event: React.PointerEvent<HTMLInputElement>) => {
          inputProps.onPointerUp?.(event);
          onInteractionComplete?.();
        }}
        onPointerCancel={(event: React.PointerEvent<HTMLInputElement>) => {
          inputProps.onPointerCancel?.(event);
          (onInteractionCancel ?? onInteractionComplete)?.();
        }}
        onTouchEnd={(event: React.TouchEvent<HTMLInputElement>) => {
          inputProps.onTouchEnd?.(event);
          onInteractionComplete?.();
        }}
        onTouchCancel={(event: React.TouchEvent<HTMLInputElement>) => {
          inputProps.onTouchCancel?.(event);
          (onInteractionCancel ?? onInteractionComplete)?.();
        }}
        onMouseUp={(event: React.MouseEvent<HTMLInputElement>) => {
          inputProps.onMouseUp?.(event);
          onInteractionComplete?.();
        }}
        onKeyUp={(event: React.KeyboardEvent<HTMLInputElement>) => {
          inputProps.onKeyUp?.(event);
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
              'Home',
              'End',
              'PageUp',
              'PageDown',
            ].includes(event.key)
          ) {
            onInteractionComplete?.();
          }
        }}
        onBlur={(event: React.FocusEvent<HTMLInputElement>) => {
          inputProps.onBlur?.(event);
          onInteractionComplete?.();
        }}
      />

      {/* Mode 2: Show input field */}
      {numericMode === 2 && (
        <StyledNumberInput
          {...inputProps}
          type="number"
          value={draftValue}
          onFocus={() => {
            isEditing.current = true;
          }}
          onChange={handleNumberInputChange}
          onBlur={handleNumberInputBlur}
          onKeyDown={handleNumberInputKeyDown}
        />
      )}
    </Container>
  );
};
