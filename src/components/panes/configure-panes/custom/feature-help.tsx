import {type FC} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {Explain, ExplainRow} from '../../../inputs/explain';
import {findEraFeatureHelp} from 'src/utils/era-feature-help';

// Sits above the controls it describes, aligned with the ControlRow column so the
// menu still reads as one column. One line is always visible; the rest is one click
// away, the same bargain the diagnostics block makes.
const HelpRow = styled(ExplainRow)({
  width: '100%',
  maxWidth: 960,
  boxSizing: 'border-box',
  padding: '14px 5px',
  borderBottom: '1px solid var(--border_color_cell)',
});

const HelpText = styled.span({
  flex: '1 1 240px',
  minWidth: 0,
  color: 'var(--color_label)',
  fontSize: 14,
  lineHeight: 1.5,
  opacity: 0.9,
});

export const FeatureHelp: FC<{commandNames: readonly unknown[]}> = ({
  commandNames,
}) => {
  const {t} = useTranslation();
  const help = findEraFeatureHelp(commandNames);
  if (!help) {
    return null;
  }
  return (
    <HelpRow>
      <HelpText>{t(help.summary)}</HelpText>
      <Explain>{t(help.detail)}</Explain>
    </HelpRow>
  );
};
