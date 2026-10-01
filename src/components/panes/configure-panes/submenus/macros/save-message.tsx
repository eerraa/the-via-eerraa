import React from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import type {
  MacroDraft,
  MacroExpressionProblem,
} from 'src/utils/macro-api/macro-api.common';

/** A draft measured against the whole macro buffer it is saved into. */
export type MacroDraftCheck = MacroDraft & {overCapacity: boolean};

/** What the last save left to say: why it was refused, or that it failed. */
export type MacroSaveStatus =
  {type: 'refused'; problem: MacroExpressionProblem} | {type: 'failed'};

export const errorColor = 'var(--color_error)';

const RefusedText = styled.span`
  font-size: 16px;
  line-height: 20px;
  color: ${errorColor};
`;

const QuietText = styled(RefusedText)`
  color: var(--color_label);
`;

/**
 * A few words beside a macro's save control: while the draft holds a character the
 * keyboard cannot type, why a save was refused, or that it failed.
 */
export const MacroSaveMessage: React.FC<{
  draft?: MacroDraftCheck;
  status?: MacroSaveStatus;
  className?: string;
}> = ({draft, status, className}) => {
  const {t} = useTranslation();
  const describe = (problem: MacroExpressionProblem) => {
    switch (problem.type) {
      case 'untypeable':
        return t('English keyboard characters only');
      case 'unclosed':
        return t('Missing }');
      case 'empty':
        return t('Empty {}');
      case 'unknown-keys':
        return t('Unknown key: {{keys}}', {keys: problem.keys.join(', ')});
    }
  };
  if (draft?.problem?.type === 'untypeable') {
    return (
      <QuietText role="status" className={className}>
        {describe(draft.problem)}
      </QuietText>
    );
  }
  if (status?.type === 'refused') {
    return (
      <RefusedText role="alert" className={className}>
        {describe(status.problem)}
      </RefusedText>
    );
  }
  if (status?.type === 'failed') {
    return (
      <QuietText role="status" className={className}>
        {t('Failed to save.')}
      </QuietText>
    );
  }
  return null;
};
