import React from 'react';
import styled from 'styled-components';
import {title, component} from '../../icons/layouts';
import {ControlRow, Label, Detail} from '../grid';
import {
  SubmenuTab,
  SubmenuTabBar,
  TabbedBody,
  TabbedCell,
} from '../submenu-tabs';
import {AccentSlider} from '../../inputs/accent-slider';
import {AccentSelect} from '../../inputs/accent-select';
import {CenterPane} from '../pane';
import {ConfigureStatusMessage} from './status-message';
import {
  getSelectedDefinition,
  getSelectedLayoutOptions,
  getSelectedLayoutOptionsPending,
  updateLayoutOption,
} from 'src/store/definitionsSlice';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import type {LayoutLabel} from '@the-via/reader';
import type {FC, ReactNode} from 'react';
import {useTranslation} from 'react-i18next';

const LayoutControl: React.FC<{
  onChange: (val: any) => void;
  meta: {labels: LayoutLabel; selectedOption: number};
}> = (props) => {
  const {t} = useTranslation();
  const {onChange, meta} = props;
  const {labels, selectedOption} = meta;
  if (Array.isArray(labels)) {
    const [label, ...optionLabels] = labels;
    const options = optionLabels.map((label, idx) => ({
      label: t(label),
      value: `${idx}`,
    }));
    return (
      <ControlRow>
        <Label>{t(label)}</Label>
        <Detail>
          <AccentSelect
            /*width={150}*/
            value={options[selectedOption]}
            options={options}
            onChange={(option: any) => {
              if (option) {
                onChange(+option.value);
              }
            }}
          />
        </Detail>
      </ControlRow>
    );
  } else {
    return (
      <ControlRow>
        <Label>{t(labels)}</Label>
        <Detail>
          <AccentSlider
            isChecked={!!selectedOption}
            onChange={(val) => onChange(+val)}
          />
        </Detail>
      </ControlRow>
    );
  }
};

const ContainerPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

const LayoutsCell: FC<{children: ReactNode}> = ({children}) => {
  const {t} = useTranslation();
  return (
    <TabbedCell>
      <SubmenuTabBar label={t(title)}>
        <SubmenuTab type="button" $selected={true} aria-pressed={true}>
          {t(title)}
        </SubmenuTab>
      </SubmenuTabBar>
      <TabbedBody>
        <ContainerPane>
          <Container>{children}</Container>
        </ContainerPane>
      </TabbedBody>
    </TabbedCell>
  );
};

export const Pane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();

  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedLayoutOptions = useAppSelector(getSelectedLayoutOptions);
  const layoutOptionsPending = useAppSelector(getSelectedLayoutOptionsPending);

  if (!selectedDefinition || !selectedLayoutOptions) {
    return null;
  }

  if (layoutOptionsPending) {
    return (
      <LayoutsCell>
        <ConfigureStatusMessage role="status">
          {t('Loading...')}
        </ConfigureStatusMessage>
      </LayoutsCell>
    );
  }

  const {layouts} = selectedDefinition;

  const labels = layouts.labels || [];
  return (
    <LayoutsCell>
      {labels.map((label: LayoutLabel, idx: number) => (
        <LayoutControl
          key={idx}
          onChange={(val) => dispatch(updateLayoutOption(idx, val))}
          meta={{
            labels: label,
            selectedOption: selectedLayoutOptions[idx],
          }}
        />
      ))}
    </LayoutsCell>
  );
};
export const Title = title;
export const Icon = component;
