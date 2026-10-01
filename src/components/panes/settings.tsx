import {useId} from 'react';
import {Pane} from './pane';
import styled from 'styled-components';
import {
  ControlRow,
  Label,
  Detail,
  Grid,
  MenuCell,
  Row,
  IconContainer,
  SpanOverflowCell,
} from './grid';
import {AccentSlider} from '../inputs/accent-slider';
import {useDispatch} from 'react-redux';
import {useAppSelector} from 'src/store/hooks';
import {
  getShowDesignTab,
  getShowConsoleTab,
  getDisableFastRemap,
  getShowSliderValuesMode,
  toggleCreatorMode,
  toggleConsoleTab,
  toggleFastRemap,
  updateShowSliderValuesMode,
  getThemeMode,
  toggleThemeMode,
  getThemeName,
  updateThemeName,
  getRenderMode,
  updateRenderMode,
} from 'src/store/settingsSlice';
import {AccentSelect} from '../inputs/accent-select';
import {THEMES} from 'src/utils/themes';
import {MenuContainer} from './configure-panes/custom/menu-generator';
import {MenuTooltip} from '../inputs/tooltip';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faToolbox} from '@fortawesome/free-solid-svg-icons';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {webGLIsAvailable} from 'src/utils/test-webgl';
import {useTranslation} from 'react-i18next';

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

// A value to read, not a control: muted instead of the accent.
const ValueDetail = styled(Detail)`
  color: var(--color_label);
`;

export const Settings = () => {
  const {t} = useTranslation();
  const id = useId();
  const dispatch = useDispatch();
  const showDesignTab = useAppSelector(getShowDesignTab);
  const showConsoleTab = useAppSelector(getShowConsoleTab);
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const ShowSliderValuesMode = useAppSelector(getShowSliderValuesMode);
  const themeMode = useAppSelector(getThemeMode);
  const themeName = useAppSelector(getThemeName);
  const renderMode = useAppSelector(getRenderMode);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);

  const themeSelectOptions = Object.keys(THEMES).map((k) => ({
    label: t(k.replaceAll('_', ' ')),
    value: k,
  }));
  const themeDefaultValue = themeSelectOptions.find(
    (opt) => opt.value === themeName,
  );

  const ShowSliderModeOptions = [
    {
      label: t('Slider Only'),
      value: 'Slider Only',
    },
    {
      label: t('Slider & Show Value'),
      value: 'Slider & Show Value',
    },
    {
      label: t('Slider & Input Field'),
      value: 'Slider & Input Field',
    },
  ];
  const showSliderModeDefaultValue = ShowSliderModeOptions.find(
    (opt) => opt.value === ShowSliderValuesMode,
  );

  const renderModeOptions = [
    {
      label: t('2D'),
      value: '2D',
    },
    {
      label: t('3D'),
      value: '3D',
    },
  ];
  const renderModeDefaultValue = renderModeOptions.find(
    (opt) => opt.value === renderMode,
  );
  return (
    <Pane>
      <Grid style={{overflow: 'hidden'}}>
        <MenuCell style={{pointerEvents: 'all', borderTop: 'none'}}>
          <MenuContainer>
            <Row $selected={true} $static>
              <IconContainer>
                <FontAwesomeIcon icon={faToolbox} />
                <MenuTooltip>{t('General')}</MenuTooltip>
              </IconContainer>
            </Row>
          </MenuContainer>
        </MenuCell>
        <SpanOverflowCell style={{flex: 1, borderWidth: 0}}>
          <Container>
            <ControlRow>
              <Label id={`${id}-design`}>{t('Show Design tab')}</Label>
              <Detail>
                <AccentSlider
                  labelledBy={`${id}-design`}
                  onChange={() => dispatch(toggleCreatorMode())}
                  isChecked={showDesignTab}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label id={`${id}-console`}>{t('Show HID Console tab')}</Label>
              <Detail>
                <AccentSlider
                  labelledBy={`${id}-console`}
                  onChange={() => dispatch(toggleConsoleTab())}
                  isChecked={showConsoleTab}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label id={`${id}-fast`}>{t('Fast Key Mapping')}</Label>
              <Detail>
                <AccentSlider
                  labelledBy={`${id}-fast`}
                  onChange={() => dispatch(toggleFastRemap())}
                  isChecked={!disableFastRemap}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label id={`${id}-slider`}>{t('Slider Mode')}</Label>
              <Detail>
                <AccentSelect
                  aria-labelledby={`${id}-slider`}
                  defaultValue={showSliderModeDefaultValue}
                  options={ShowSliderModeOptions}
                  onChange={(option: any) => {
                    option && dispatch(updateShowSliderValuesMode(option.value));
                  }}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label id={`${id}-light`}>{t('Light Mode')}</Label>
              <Detail>
                <AccentSlider
                  labelledBy={`${id}-light`}
                  onChange={() => dispatch(toggleThemeMode())}
                  isChecked={themeMode === 'light'}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label id={`${id}-theme`}>{t('Keycap Theme')}</Label>
              <Detail>
                <AccentSelect
                  aria-labelledby={`${id}-theme`}
                  defaultValue={themeDefaultValue}
                  options={themeSelectOptions}
                  onChange={(option: any) => {
                    option && dispatch(updateThemeName(option.value));
                  }}
                />
              </Detail>
            </ControlRow>
            {/* Without WebGL only 2D draws, so the row would offer no choice. */}
            {webGLIsAvailable && (
              <ControlRow>
                <Label id={`${id}-render`}>{t('Render Mode')}</Label>
                <Detail>
                  <AccentSelect
                    aria-labelledby={`${id}-render`}
                    defaultValue={renderModeDefaultValue}
                    options={renderModeOptions}
                    onChange={(option: any) => {
                      option && dispatch(updateRenderMode(option.value));
                    }}
                  />
                </Detail>
              </ControlRow>
            )}
            <ControlRow>
              <Label>{t('VIA Protocol')}</Label>
              <ValueDetail>{selectedDevice?.protocol ?? '—'}</ValueDetail>
            </ControlRow>
          </Container>
        </SpanOverflowCell>
      </Grid>
    </Pane>
  );
};
