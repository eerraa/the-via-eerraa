import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import styled from 'styled-components';
import {createSelector} from '@reduxjs/toolkit';
import {MacroRecorder} from './macro-recorder';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faClapperboard, faCode} from '@fortawesome/free-solid-svg-icons';
import {ScriptExample, ScriptMode} from './script-mode';
import {ProgressBarTooltip} from 'src/components/inputs/tooltip';
import {getIsDelaySupported, getMacroBufferSize} from 'src/store/macrosSlice';
import {
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
  getSelectedConnectionGeneration,
} from 'src/store/devicesSlice';
import {
  discardDrafts,
  draftKey,
  getSelectedDeviceDrafts,
  setDraft,
  settleWrittenDraft,
} from 'src/store/draftsSlice';
import {
  checkMacroDraft,
  countMacroBytes,
  type IMacroAPI,
} from 'src/utils/macro-api/macro-api.common';
import {useTranslation} from 'react-i18next';
import {DeferredApplyButtons} from '../../custom/deferred-apply';
import {
  errorColor,
  MacroSaveMessage,
  type MacroDraftCheck,
  type MacroSaveStatus,
} from './save-message';

const ProgressBarContainer = styled.div`
  position: relative;
  margin-top: 10px;
  &:hover {
    & .tooltip {
      transform: scale(1) translateY(0px);
      opacity: 1;
    }
  }
  .tooltip {
    transform: translateY(5px) scale(0.6);
    opacity: 0;
  }
`;
const ProgressBar = styled.div<{$over: boolean}>`
  background: var(--bg_control);
  position: relative;
  padding: 5px;
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 10px;
  width: 250px;

  > span {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    background: ${(props) =>
      props.$over ? errorColor : 'var(--color_accent)'};
    height: 10px;
    width: 100%;
    transform: scaleX(0.1);
    transform-origin: left;
    transition: transform 0.4s ease-in-out;
  }
`;
const MacroTab = styled.button<{$selected: boolean}>`
  appearance: none;
  background: transparent;
  font: inherit;
  display: inline-flex;
  border: 1px solid;
  line-height: initial;
  padding: 8px;
  border-radius: 5px;
  min-width: 38px;
  justify-content: center;
  box-sizing: border-box;
  color: ${(props) =>
    props.$selected ? 'var(--color_accent)' : 'var(--bg_icon)'};
  cursor: pointer;
  &:hover {
    color: ${(props) =>
      props.$selected ? 'var(--color_accent)' : 'var(--bg_icon-highlighted)'};
  }
`;

const TabBar = styled.div`
  display: flex;
  column-gap: 10px;
`;

const TabContainer = styled.div`
  display: flex;
  margin-bottom: 10px;
  width: 100%;
  max-width: 960px;
`;
const CenterTabContainer = styled(TabContainer)`
  justify-content: center;
`;
const ApplyMessage = styled(MacroSaveMessage)`
  max-width: 320px;
  text-align: right;
`;

type Props = {
  macroExpressions: string[];
  selectedMacro: number;
  saveMacros: (macroIndex: number, macro: string) => Promise<void>;
  macroApi?: IMacroAPI;
};

const MACRO_DRAFT_PREFIX = draftKey('macro', '');
const macroDraftKey = (macroIndex: number) => draftKey('macro', macroIndex);

/** The selected keyboard's macro edits that are not written yet, by slot. */
export const getSelectedMacroDrafts = createSelector(
  getSelectedDeviceDrafts,
  (drafts) => {
    const macroDrafts: Record<number, string> = {};
    Object.entries(drafts).forEach(([key, value]) => {
      if (key.startsWith(MACRO_DRAFT_PREFIX) && typeof value === 'string') {
        macroDrafts[Number(key.slice(MACRO_DRAFT_PREFIX.length))] = value;
      }
    });
    return macroDrafts;
  },
);

/** Whether a slot's draft would change what the keyboard holds. */
export const isMacroDraftPending = (
  macroApi: IMacroAPI | undefined,
  draft: string | undefined,
  saved: string,
) =>
  draft !== undefined &&
  draft !== saved &&
  (macroApi ? checkMacroDraft(macroApi, draft).stored : draft) !== saved;

const printBytesUsed = (bytesUsed: number, bufferSize: number) => {
  const {t} = useTranslation();
  const units = ['Bytes', 'kB', 'MB', 'GB'];
  const scale = bufferSize > 0 ? Math.floor(Math.log10(bufferSize) / 3) : 0;
  const suffix = units[scale];
  const denominator = scale === 0 ? 1 : Math.pow(1000, scale);
  const convertedBytesUsed = bytesUsed / denominator;
  const convertedBufferSize = bufferSize / denominator;

  return `${convertedBytesUsed.toFixed(scale)} / ${convertedBufferSize.toFixed(
    scale,
  )} ${suffix} ${t('space used')}`;
};

const BufferSizeUsage: React.FC<{bytesUsed: number; capacity: number}> = ({
  bytesUsed,
  capacity,
}) => {
  const over = bytesUsed > capacity;
  const filled = capacity > 0 ? Math.min(1, bytesUsed / capacity) : +over;
  return (
    <ProgressBarContainer>
      <ProgressBar $over={over}>
        <span style={{transform: `scaleX(${filled})`}} />
      </ProgressBar>
      <ProgressBarTooltip>
        {printBytesUsed(bytesUsed, capacity)}
      </ProgressBarTooltip>
    </ProgressBarContainer>
  );
};

export const MacroDetailPane: React.FC<Props> = (props) => {
  const {t} = useTranslation();
  const {macroApi, selectedMacro: macroIndex} = props;
  const dispatch = useAppDispatch();
  const devicePath = useAppSelector(getSelectedDevicePath);
  const keyboardApi = useAppSelector(getSelectedKeyboardAPI);
  const connectionGeneration = useAppSelector(getSelectedConnectionGeneration);
  const currentMacro = props.macroExpressions[macroIndex] || '';
  // Both modes show and edit the slot's draft. It lives in the store, so another
  // slot, the other mode or another pane leaves it as it was.
  const draft = useAppSelector(getSelectedMacroDrafts)[macroIndex];
  const macroText = draft ?? currentMacro;
  const [showAdvancedView, setShowAdvancedView] = React.useState(false);
  const [recording, setRecording] = useState(false);
  const ast = useAppSelector((state) => state.macros.ast);
  const isDelaySupported = useAppSelector(getIsDelaySupported);
  const bufferSize = useAppSelector(getMacroBufferSize);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<MacroSaveStatus>();
  const savingRef = useRef(false);
  const selectedMacroRef = useRef(macroIndex);
  selectedMacroRef.current = macroIndex;

  // The last byte of the buffer is the completion marker, not macro space.
  const capacity = bufferSize - 1;
  // A save rebuilds every macro from its expression, so the others are measured the
  // same way.
  const otherMacroBytes = useMemo(
    () =>
      macroApi
        ? props.macroExpressions.reduce(
            (total, expression, index) =>
              index === macroIndex
                ? total
                : total + countMacroBytes(macroApi, expression),
            0,
          )
        : 0,
    [macroApi, props.macroExpressions, macroIndex],
  );
  const checkDraft = useCallback(
    (expression: string): MacroDraftCheck => {
      const draft = macroApi
        ? checkMacroDraft(macroApi, expression)
        : {byteCount: 0, stored: expression};
      return {
        ...draft,
        overCapacity: otherMacroBytes + draft.byteCount > capacity,
      };
    },
    [macroApi, otherMacroBytes, capacity],
  );
  const macroCheck = useMemo(
    () => checkDraft(macroText),
    [checkDraft, macroText],
  );
  // Compared in the form the keyboard keeps, so a draft that only spells the macro
  // differently has nothing to write.
  const pending =
    draft !== undefined &&
    draft !== currentMacro &&
    macroCheck.stored !== currentMacro;

  useEffect(() => {
    setSaveStatus(undefined);
  }, [macroText, macroIndex, showAdvancedView]);

  const editMacro = useCallback(
    (expression: string, index: number) => {
      if (!devicePath) {
        return;
      }
      const key = macroDraftKey(index);
      dispatch((dispatch, getState) => {
        // An unmount can flush a paced recording after a device was removed.
        // Keep a connected device's draft, never resurrect a disconnected session.
        if (
          !getState().devices.connectedDevicePaths[devicePath] ||
          !keyboardApi ||
          keyboardApi.getConnectionGeneration() !== connectionGeneration
        ) return;
        dispatch(
          expression === (props.macroExpressions[index] || '')
            ? discardDrafts({devicePath, keys: [key]})
            : setDraft({devicePath, key, value: expression}),
        );
      });
    },
    [devicePath, dispatch, props.macroExpressions, keyboardApi, connectionGeneration],
  );

  const cancel = useCallback(() => {
    if (devicePath) {
      dispatch(discardDrafts({devicePath, keys: [macroDraftKey(macroIndex)]}));
    }
  }, [devicePath, dispatch, macroIndex]);

  const apply = useCallback(async () => {
    if (!macroApi || !devicePath || savingRef.current) {
      return;
    }
    const index = macroIndex;
    const expression = macroText;
    const check = checkDraft(expression);
    if (check.problem) {
      setSaveStatus({type: 'refused', problem: check.problem});
      return;
    }
    // Measured here, so a macro that does not fit is never sent at all.
    if (check.overCapacity) {
      return;
    }
    const settle = () =>
      dispatch(
        settleWrittenDraft({
          devicePath,
          key: macroDraftKey(index),
          value: expression,
        }),
      );
    if (check.stored === currentMacro) {
      settle();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveStatus(undefined);
    try {
      await props.saveMacros(index, expression);
      settle();
    } catch {
      if (selectedMacroRef.current === index) {
        setSaveStatus({type: 'failed'});
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    checkDraft,
    currentMacro,
    devicePath,
    dispatch,
    macroApi,
    macroIndex,
    macroText,
    props.saveMacros,
  ]);

  const idle = !recording && !saving;
  return (
    <>
      <CenterTabContainer>
        <TabBar>
          <MacroTab
            type="button"
            title={t('Record')}
            aria-label={t('Record')}
            aria-pressed={!showAdvancedView}
            $selected={!showAdvancedView}
            onClick={() => setShowAdvancedView(false)}
          >
            <FontAwesomeIcon icon={faClapperboard} />
          </MacroTab>
          <MacroTab
            type="button"
            title={t('Script')}
            aria-label={t('Script')}
            aria-pressed={showAdvancedView}
            $selected={showAdvancedView}
            onClick={() => setShowAdvancedView(true)}
          >
            <FontAwesomeIcon icon={faCode} />
          </MacroTab>
        </TabBar>
      </CenterTabContainer>
      <BufferSizeUsage
        bytesUsed={otherMacroBytes + macroCheck.byteCount}
        capacity={capacity}
      />
      {showAdvancedView ? (
        <ScriptMode
          value={macroText}
          onChange={(expression) => editMacro(expression, macroIndex)}
          isModified={pending}
          refused={saveStatus?.type === 'refused'}
          key={macroIndex}
        />
      ) : (
        <MacroRecorder
          macroIndex={macroIndex}
          selectedMacro={ast[macroIndex]}
          draft={draft}
          editMacro={editMacro}
          isModified={pending}
          canEditItems={!macroCheck.problem}
          onRecordingChange={setRecording}
          isDelaySupported={isDelaySupported}
        />
      )}
      <DeferredApplyButtons
        canCancel={pending && idle}
        canApply={
          pending &&
          idle &&
          !macroCheck.overCapacity &&
          macroCheck.problem?.type !== 'untypeable'
        }
        onCancel={cancel}
        onApply={apply}
      >
        {showAdvancedView ? (
          <ScriptExample isDelaySupported={isDelaySupported} />
        ) : null}
        <ApplyMessage draft={macroCheck} status={saveStatus} />
      </DeferredApplyButtons>
    </>
  );
};
