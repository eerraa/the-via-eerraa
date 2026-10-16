import React, {FC, useContext, useId} from 'react';
import {Pane} from './pane';
import styled from 'styled-components';
import {
  ControlRow,
  Label,
  Detail,
  MenuCell,
  Row,
  IconContainer,
  Grid,
  SpanOverflowCell,
} from './grid';
import {AccentSlider} from '../inputs/accent-slider';
import {AccentButton} from '../inputs/accent-button';
import {useDispatch} from 'react-redux';
import {useAppSelector} from 'src/store/hooks';
import {
  getTestKeyboardSoundsSettings,
  setTestKeyboardSoundsSettings,
} from 'src/store/settingsSlice';
import {MenuContainer} from './configure-panes/custom/menu-generator';
import {HelpRow, HelpText} from './configure-panes/custom/feature-help';
import {MenuTooltip} from '../inputs/tooltip';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faCircleQuestion} from '@fortawesome/free-solid-svg-icons';
import {useProgress} from '@react-three/drei';
import {AccentSelect} from '../inputs/accent-select';
import {AccentRange} from '../inputs/accent-range';
import {TestKeyboardSoundsMode} from '../void/test-keyboard-sounds';
import {useTranslation} from 'react-i18next';

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

const TestPane = styled(Pane)`
  display: flex;
  height: 100%;
  max-width: 100vw;
  flex-direction: column;
`;

export const initialTestContext = {
  clearTestKeys: () => {},
  testMatrix: false,
  matrixAvailable: false,
  matrixReadFailed: false,
};

export const TestContext = React.createContext<
  readonly [
    typeof initialTestContext,
    React.Dispatch<React.SetStateAction<typeof initialTestContext>>,
  ]
>([initialTestContext, () => {}]);

export const Test: FC = () => {
  const {t} = useTranslation();
  const matrixLabelId = useId();
  const dispatch = useDispatch();
  const testKeyboardSoundsSettings = useAppSelector(
    getTestKeyboardSoundsSettings,
  );

  const [testContextObj, setTestContextObj] = useContext(TestContext);
  const {progress} = useProgress();

  const waveformOptions = [
    {
      label: t('Sine'),
      value: 'sine',
    },
    {
      label: t('Triangle'),
      value: 'triangle',
    },
    {
      label: t('Sawtooth'),
      value: 'sawtooth',
    },
    {
      label: t('Square'),
      value: 'square',
    },
  ];
  const waveformDefaultValue = waveformOptions.find(
    (opt) => opt.value === testKeyboardSoundsSettings.waveform,
  );

  const modeOptions = [
    {
      label: t('Wicki-Hayden'),
      value: TestKeyboardSoundsMode.WickiHayden,
    },
    {
      label: t('Chromatic'),
      value: TestKeyboardSoundsMode.Chromatic,
    },
    {
      label: t('Random'),
      value: TestKeyboardSoundsMode.Random,
    },
  ];
  const modeDefaultValue = modeOptions.find(
    (opt) => opt.value === testKeyboardSoundsSettings.mode,
  );

  return progress !== 100 ? null : (
    <TestPane>
      <Grid>
        <MenuCell style={{pointerEvents: 'all'}}>
          <MenuContainer>
            <Row $selected={true} $static>
              <IconContainer>
                <FontAwesomeIcon icon={faCircleQuestion} />
                <MenuTooltip>{t('Check Key')}</MenuTooltip>
              </IconContainer>
            </Row>
          </MenuContainer>
        </MenuCell>
        <SpanOverflowCell>
          {/* Keys typed into these controls reach them (use-global-keys.ts). */}
          <Container data-key-test-settings>
            <ControlRow>
              <Label id={matrixLabelId}>{t('Matrix test')}</Label>
              <Detail>
                <AccentSlider
                  labelledBy={matrixLabelId}
                  isChecked={testContextObj.testMatrix}
                  disabled={!testContextObj.matrixAvailable}
                  onChange={(testMatrix) => {
                    if (!testMatrix || testContextObj.matrixAvailable) {
                      setTestContextObj((prev) => ({
                        ...prev,
                        testMatrix,
                        matrixReadFailed: false,
                      }));
                    }
                  }}
                />
              </Detail>
            </ControlRow>
            {testContextObj.testMatrix && (
              <HelpRow>
                <HelpText>
                  {t(
                    'Matrix testing requires firmware permission. If keys do not respond, use General key test.',
                  )}
                </HelpText>
              </HelpRow>
            )}
            {testContextObj.matrixReadFailed && (
              <HelpRow role="status">
                <HelpText>
                  {t(
                    'The matrix could not be read. General key test is active.',
                  )}
                </HelpText>
              </HelpRow>
            )}
            <ControlRow>
              <Label>{t('Pressed keys')}</Label>
              <Detail>
                {/* A click leaves no focus here, so Space and Enter stay keys to test. */}
                <AccentButton
                  onMouseDown={(evt: React.MouseEvent) => evt.preventDefault()}
                  onClick={testContextObj.clearTestKeys}
                >
                  {t('Clear')}
                </AccentButton>
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Key Sounds')}</Label>
              <Detail>
                <AccentSlider
                  isChecked={testKeyboardSoundsSettings.isEnabled}
                  onChange={(val) => {
                    dispatch(
                      setTestKeyboardSoundsSettings({
                        isEnabled: val,
                      }),
                    );
                  }}
                />
              </Detail>
            </ControlRow>
            {testKeyboardSoundsSettings.isEnabled ? (
              <>
                <ControlRow>
                  <Label>{t('Volume')}</Label>
                  <Detail>
                    <AccentRange
                      max={100}
                      min={0}
                      value={testKeyboardSoundsSettings.volume}
                      onChange={(value: number) => {
                        dispatch(
                          setTestKeyboardSoundsSettings({
                            volume: value,
                          }),
                        );
                      }}
                    />
                  </Detail>
                </ControlRow>
                <ControlRow>
                  <Label>{t('Transpose')}</Label>
                  <Detail>
                    <AccentRange
                      max={24}
                      min={-24}
                      value={testKeyboardSoundsSettings.transpose}
                      onChange={(value: number) => {
                        dispatch(
                          setTestKeyboardSoundsSettings({
                            transpose: value,
                          }),
                        );
                      }}
                    />
                  </Detail>
                </ControlRow>
                <ControlRow>
                  <Label>{t('Waveform')}</Label>
                  <Detail>
                    <AccentSelect
                      isSearchable={false}
                      value={waveformDefaultValue}
                      options={waveformOptions}
                      onChange={(option: any) => {
                        option &&
                          dispatch(
                            setTestKeyboardSoundsSettings({
                              waveform: option.value,
                            }),
                          );
                      }}
                    />
                  </Detail>
                </ControlRow>
                <ControlRow>
                  <Label>{t('Note layout')}</Label>
                  <Detail>
                    <AccentSelect
                      isSearchable={false}
                      defaultValue={modeDefaultValue}
                      options={modeOptions}
                      onChange={(option: any) => {
                        option &&
                          dispatch(
                            setTestKeyboardSoundsSettings({
                              mode: option.value,
                            }),
                          );
                      }}
                    />
                  </Detail>
                </ControlRow>
              </>
            ) : null}
          </Container>
        </SpanOverflowCell>
      </Grid>
    </TestPane>
  );
};
