import {
  faCircle,
  faCompress,
  faExpand,
  faMagicWandSparkles,
  faSquare,
  faStopwatch,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {
  IconButtonContainer,
  IconToggleContainer,
} from 'src/components/inputs/icon-button';
import {IconButtonTooltip} from 'src/components/inputs/tooltip';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';

const MacroEditControlsContainer = styled.div`
  background: var(--bg_menu);
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
`;
const MacroControlGroupContainer = styled.div`
  border-radius: 2px;
  border: 1px solid var(--border_color_icon);
  display: inline-flex;
  > button:last-child {
    border: none;
  }
`;
const MacroControlGroupDivider = styled.div`
  background: var(--border_color_icon);
  width: 1px;
  height: 80%;
  margin: 0 10px;
`;

export const MacroEditControls: React.FC<{
  isFullscreen: boolean;
  isRecording: boolean;
  optimizeRecording: boolean;
  recordDelays: boolean;
  clearMacro(): void;
  toggleOptimizeRecording(): void;
  toggleRecordDelays(): void;
  toggleFullscreen(): void;
  isEmpty?: boolean;
  recordingToggleChange: (a: boolean) => void;
  addText: () => void;
  isDelaySupported: boolean;
}> = ({
  isFullscreen,
  isRecording,
  recordingToggleChange,
  recordDelays,
  toggleRecordDelays,
  optimizeRecording,
  toggleOptimizeRecording,
  isEmpty,
  clearMacro,
  toggleFullscreen,
  isDelaySupported,
}) => {
  const {t} = useTranslation();
  const recordComponent = (
    <IconButtonContainer
      onClick={() => {
        recordingToggleChange(!isRecording);
      }}
    >
      <FontAwesomeIcon
        size={'sm'}
        color={'var(--color_label)'}
        icon={isRecording ? faSquare : faCircle}
      />
      <IconButtonTooltip>
        {isRecording ? t('Stop Recording') : t('Record Keystrokes')}
      </IconButtonTooltip>
    </IconButtonContainer>
  );
  return (
    <MacroEditControlsContainer>
      {!isEmpty ? (
        <>
          <MacroControlGroupContainer>
            <IconButtonContainer disabled={isRecording} onClick={clearMacro}>
              <FontAwesomeIcon
                size={'sm'}
                color="var(--color_label)"
                icon={faTrash}
              />
              <IconButtonTooltip>
                {t('Clear', {context: 'key'})}
              </IconButtonTooltip>
            </IconButtonContainer>
          </MacroControlGroupContainer>
          <MacroControlGroupDivider />
        </>
      ) : (
        <></>
      )}
      <MacroControlGroupContainer>
        {recordComponent}
        {
          <IconButtonContainer onClick={toggleFullscreen}>
            <FontAwesomeIcon
              size={'sm'}
              color="var(--color_label)"
              icon={isFullscreen ? faCompress : faExpand}
            />
            <IconButtonTooltip>
              {isFullscreen ? t('Exit Fullscreen') : t('Fullscreen')}
            </IconButtonTooltip>
          </IconButtonContainer>
        }
      </MacroControlGroupContainer>
      {!isRecording ? (
        <>
          <MacroControlGroupDivider />
          <MacroControlGroupContainer>
            <IconToggleContainer
              $selected={optimizeRecording}
              onClick={toggleOptimizeRecording}
            >
              <FontAwesomeIcon size={'sm'} icon={faMagicWandSparkles} />
              <IconButtonTooltip>
                {!optimizeRecording
                  ? t('Use Smart Optimization')
                  : t('Skip Smart Optimization')}
              </IconButtonTooltip>
            </IconToggleContainer>
            <IconToggleContainer
              disabled={!isDelaySupported}
              $selected={recordDelays}
              onClick={toggleRecordDelays}
            >
              <FontAwesomeIcon
                size={'sm'}
                icon={faStopwatch}
                className={'fa-stack-1x'}
              />
              <IconButtonTooltip>
                {!isDelaySupported
                  ? t('Upgrade firmware to use delays')
                  : !recordDelays
                  ? t('Record Delays')
                  : t('Skip Recording Delays')}
              </IconButtonTooltip>
            </IconToggleContainer>
          </MacroControlGroupContainer>
        </>
      ) : null}
    </MacroEditControlsContainer>
  );
};
