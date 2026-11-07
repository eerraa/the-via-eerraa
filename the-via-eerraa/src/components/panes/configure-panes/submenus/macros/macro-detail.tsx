import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import styled from 'styled-components';
import {createSelector} from '@reduxjs/toolkit';
import {MacroRecorder} from './macro-recorder';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faClapperboard, faCode} from '@fortawesome/free-solid-svg-icons';
import {ScriptExample, ScriptMode} from './script-mode';
import {ProgressBarTooltip} from 'src/components/inputs/tooltip';
import {getExpressions, getIsDelaySupported, getMacroBufferSize, getIsMacroWriting} from 'src/store/macrosSlice';
import {macroOptionsDraftKey, type MacroOptionsControl} from '../../macro-options';
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
  type MacroDraft,
} from 'src/utils/macro-api/macro-api.common';
import {useTranslation} from 'react-i18next';
import {DeferredApplyButtons} from '../../custom/deferred-apply';
import {
  errorColor,
  MacroSaveMessage,
  type MacroDraftCheck,
  type MacroSaveStatus,
} from './save-message';
import {
  sameMacroEditSource,
  type MacroEditRequest,
  type MacroEditSource,
} from './macro-edit-model';

const ProgressBarContainer = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  margin: 0;
  &:hover {
    & .tooltip {
      transform: scale(1) translateY(0px);
      opacity: 1;
    }
  }
  .tooltip {
    top: calc(100% + 8px) !important;
    margin-top: 0 !important;
    transform: translateY(-5px) scale(0.6);
    opacity: 0;
  }
`;
const ProgressBar = styled.div<{$over: boolean; $recording: boolean}>`
  background: var(--bg_control);
  position: relative;
  padding: 4px;
  border-radius: 4px;
  overflow: hidden;
  margin: 0;
  width: clamp(75px, 10vw, 120px);

  > span {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    background: ${(props) =>
      props.$over ? errorColor : 'var(--color_accent)'};
    height: 8px;
    width: 100%;
    transform: scaleX(0.1);
    transform-origin: left;
    transition: ${(props) => props.$recording ? 'none' : 'transform 0.4s ease-in-out'};
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
  margin: 0;
  width: 100%;
  max-width: 960px;
`;
const CenterTabContainer = styled(TabContainer)`
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px 12px;
`;
const LeadCell = styled.div`
  justify-self: start;
  min-width: 0;
`;
const TrailCell = styled.div`
  justify-self: end;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
`;
const FooterContainer = styled.div`
  width: 100%;
  max-width: 960px;
  > div {
    padding: 0;
  }
`;

const RecorderFooter = styled(FooterContainer)`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px 12px;

  > :first-child {
    grid-column: 2;
  }
  > ${FooterContainer} {
    grid-column: 3;
    min-width: 0;
  }

  @media (max-width: 640px) {
    grid-template-columns: minmax(0, 1fr);
    > :first-child {
      grid-column: 1;
      justify-self: center;
    }
    > ${FooterContainer} {
      grid-column: 1;
    }
  }
`;

/**
 * The mode row: the two modes in the middle, at its start the links that leave
 * the menu, so they take no row of their own, and at its end the macro's
 * Playback button. While the macros load it holds the links alone, in the same
 * place.
 */
export const MacroModeRow: React.FC<{
  lead?: React.ReactNode;
  trail?: React.ReactNode;
  children?: React.ReactNode;
}> = ({lead, trail, children}) => (
  <CenterTabContainer>
    <LeadCell>{lead}</LeadCell>
    {children}
    {trail ? <TrailCell>{trail}</TrailCell> : null}
  </CenterTabContainer>
);
const ApplyMessage = styled(MacroSaveMessage)`
  max-width: 320px;
  text-align: right;
`;

type Props = {
  macroExpressions: string[];
  selectedMacro: number;
  saveMacros: (macroIndex: number, macro: string) => Promise<void>;
  macroApi?: IMacroAPI;
  draft?: string;
  draftCheck: MacroDraft;
  /** Told when recording starts and stops, for the links that leave the menu. */
  onRecordingChange?: (recording: boolean) => void;
  /** At the start of the mode row: the links that leave the menu. */
  lead?: React.ReactNode;
  /**
   * The macro's Playback button, where the firmware reports macro-option
   * support. One Apply writes the macro's content, then its options.
   */
  options?: MacroOptionsControl;
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
  checkedDraft?: MacroDraft,
) =>
  draft !== undefined &&
  draft !== saved &&
  (checkedDraft?.stored ?? (macroApi ? checkMacroDraft(macroApi, draft).stored : draft)) !== saved;

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

const BufferSizeUsage: React.FC<{bytesUsed: number; capacity: number; recording: boolean}> = ({
  bytesUsed,
  capacity,
  recording,
}) => {
  const over = bytesUsed > capacity;
  const filled = capacity > 0 ? Math.min(1, bytesUsed / capacity) : +over;
  return (
    <ProgressBarContainer>
      <ProgressBar $over={over} $recording={recording}>
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
  const {macroApi, selectedMacro: macroIndex, draft, draftCheck} = props;
  const dispatch = useAppDispatch();
  const devicePath = useAppSelector(getSelectedDevicePath);
  const keyboardApi = useAppSelector(getSelectedKeyboardAPI);
  const connectionGeneration = useAppSelector(getSelectedConnectionGeneration);
  const currentMacro = props.macroExpressions[macroIndex] || '';
  // Both modes show and edit the slot's draft. It lives in the store, so another
  // slot, the other mode or another pane leaves it as it was.
  const macroText = draft ?? currentMacro;
  const [showAdvancedView, setShowAdvancedView] = React.useState(false);
  const [recording, setRecording] = useState(false);
  const {onRecordingChange} = props;
  useEffect(() => {
    onRecordingChange?.(recording);
  }, [onRecordingChange, recording]);
  const [recordingBytes, setRecordingBytes] = useState(1);
  const ast = useAppSelector((state) => state.macros.ast);
  const isDelaySupported = useAppSelector(getIsDelaySupported);
  const bufferSize = useAppSelector(getMacroBufferSize);
  const [saving, setSaving] = useState(false);
  const writing = useAppSelector(getIsMacroWriting);
  const [saveStatus, setSaveStatus] = useState<MacroSaveStatus>();
  const savingRef = useRef(false);
  const selectedMacroRef = useRef(macroIndex);
  selectedMacroRef.current = macroIndex;
  const editContext = useRef({
    devicePath,
    connectionGeneration,
    macroIndex,
    showAdvancedView,
    epoch: 0,
  });
  const previousContext = editContext.current;
  if (
    previousContext.devicePath !== devicePath ||
    previousContext.connectionGeneration !== connectionGeneration ||
    previousContext.macroIndex !== macroIndex ||
    previousContext.showAdvancedView !== showAdvancedView
  ) {
    editContext.current = {
      devicePath,
      connectionGeneration,
      macroIndex,
      showAdvancedView,
      epoch: previousContext.epoch + 1,
    };
  }
  const editSource: MacroEditSource = {
    devicePath: devicePath ?? null,
    connectionGeneration: connectionGeneration ?? null,
    macroIndex,
    epoch: editContext.current.epoch,
    macroApi,
    draft,
    savedExpression: currentMacro,
    savedSequence: ast[macroIndex],
  };
  const editSourceRef = useRef(editSource);
  editSourceRef.current = editSource;

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
    () => ({
      ...draftCheck,
      overCapacity: otherMacroBytes + draftCheck.byteCount > capacity,
    }),
    [draftCheck, otherMacroBytes, capacity],
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
    (expression: string, index: number, request?: MacroEditRequest): boolean => {
      if (!devicePath) {
        return false;
      }
      const key = macroDraftKey(index);
      return dispatch((dispatch, getState) => {
        const state = getState();
        // An unmount can flush a paced recording after a device was removed.
        // Keep a connected device's draft, never resurrect a disconnected session.
        if (
          !state.devices.connectedDevicePaths[devicePath] ||
          !keyboardApi ||
          keyboardApi.getConnectionGeneration() !== connectionGeneration
        ) return false;
        if (request) {
          const source = editSourceRef.current;
          if (
            index !== source.macroIndex ||
            !sameMacroEditSource(request.source, source) ||
            getSelectedDevicePath(state) !== devicePath ||
            getSelectedConnectionGeneration(state) !== connectionGeneration ||
            getSelectedMacroDrafts(state)[index] !== source.draft ||
            state.macros.ast[index] !== source.savedSequence ||
            (getExpressions(state)[index] || '') !== source.savedExpression
          ) return false;
          if (!request.prepare({
            ...source,
            draft: expression === source.savedExpression ? undefined : expression,
          })) return false;
        }
        dispatch(
          expression === (props.macroExpressions[index] || '')
            ? discardDrafts({devicePath, keys: [key]})
            : setDraft({devicePath, key, value: expression}),
        );
        return true;
      });
    },
    [devicePath, dispatch, props.macroExpressions, keyboardApi, connectionGeneration],
  );

  const {options} = props;
  const optionsPending = options?.pending ?? false;
  const cancel = useCallback(() => {
    if (devicePath) {
      dispatch(
        discardDrafts({
          devicePath,
          keys: [macroDraftKey(macroIndex), macroOptionsDraftKey(macroIndex)],
        }),
      );
    }
  }, [devicePath, dispatch, macroIndex]);

  const apply = useCallback(async () => {
    if (!macroApi || !devicePath || savingRef.current || writing) {
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
    const contentPending = check.stored !== currentMacro;
    if (!contentPending) {
      settle();
      if (!optionsPending) return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveStatus(undefined);
    let contentSaved = false;
    try {
      if (contentPending) {
        await props.saveMacros(index, expression);
        settle();
        contentSaved = true;
      }
      // After the content, so content the keyboard refused leaves the options a
      // draft too.
      if (optionsPending && options && !(await options.save(index))) {
        throw new Error('Macro options were not saved');
      }
    } catch {
      if (selectedMacroRef.current === index) {
        // The content is on the keyboard already; only its options are not.
        setSaveStatus({type: contentSaved ? 'options-failed' : 'failed'});
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
    writing,
    options,
    optionsPending,
  ]);

  const idle = !recording && !saving && !writing;
  const renderFooter = (lead?: React.ReactNode) => (
    <FooterContainer>
      <DeferredApplyButtons
        canCancel={(pending || optionsPending) && idle}
        canApply={
          (pending || optionsPending) &&
          (!optionsPending || options?.valid !== false) &&
          idle &&
          !macroCheck.overCapacity &&
          macroCheck.problem?.type !== 'untypeable'
        }
        onCancel={cancel}
        onApply={apply}
      >
        {lead}
        <ApplyMessage draft={macroCheck} status={saveStatus} />
      </DeferredApplyButtons>
    </FooterContainer>
  );
  return (
    <>
      <MacroModeRow
        lead={props.lead}
        trail={
          <>
            <BufferSizeUsage
              bytesUsed={
                otherMacroBytes +
                (recording ? recordingBytes : macroCheck.byteCount)
              }
              capacity={capacity}
              recording={recording}
            />
            {options?.control}
          </>
        }
      >
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
      </MacroModeRow>
      {showAdvancedView ? (
        <>
          <ScriptMode
            value={macroText}
            onChange={(expression) => editMacro(expression, macroIndex)}
            isModified={pending}
            refused={saveStatus?.type === 'refused'}
            key={macroIndex}
          />
          {renderFooter(<ScriptExample isDelaySupported={isDelaySupported} />)}
        </>
      ) : (
        <MacroRecorder
          macroIndex={macroIndex}
          editSource={editSource}
          editMacro={editMacro}
          isModified={pending}
          canEditItems={!macroCheck.problem}
          onRecordingChange={setRecording}
          onRecordingPreview={setRecordingBytes}
          isDelaySupported={isDelaySupported}
          renderFooter={(controls) => (
            <RecorderFooter>
              {controls}
              {renderFooter()}
            </RecorderFooter>
          )}
        />
      )}
    </>
  );
};
