import {type FC} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {ExplainRow, useExplainDisclosure} from '../../../inputs/explain';
import {findEraFeatureHelp, hasHelpBody} from 'src/utils/era-feature-help';
import {useIsEraDefinition} from 'src/utils/use-is-era-definition';
import {HelpBody, HelpContent} from './help-content';

// Sits above the controls it describes, aligned with the ControlRow column so the
// menu still reads as one column. One line is always visible; the rest is one click
// away, the same bargain the diagnostics block makes.
export const HelpRow = styled(ExplainRow)({
  width: '100%',
  maxWidth: 960,
  boxSizing: 'border-box',
  gap: 10,
  padding: '16px 5px',
  borderBottom: '1px solid var(--border_color_cell)',
});

// As wide as its sentence, so the ⓘ follows it the way a row's ⓘ follows its label.
export const HelpText = styled.span({
  flex: '0 1 auto',
  minWidth: 0,
  color: 'var(--color_label)',
  fontSize: 16,
  lineHeight: 1.5,
});

export const FeatureHelp: FC<{commandNames: readonly unknown[]}> = ({
  commandNames,
}) => {
  const {t} = useTranslation();
  const {toggle, bodyProps} = useExplainDisclosure();
  const eraDefinition = useIsEraDefinition();
  const help = eraDefinition ? findEraFeatureHelp(commandNames) : null;
  if (!help) {
    return null;
  }
  return (
    <HelpRow>
      <HelpText>{t(help.summary)}</HelpText>
      {hasHelpBody(help) ? (
        <>
          {toggle}
          <HelpBody {...bodyProps}>
            <HelpContent content={help} />
          </HelpBody>
        </>
      ) : null}
    </HelpRow>
  );
};
