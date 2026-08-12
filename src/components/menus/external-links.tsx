import styled from 'styled-components';
import {LanguageSelect} from './language-select';

const ExternalLinkContainer = styled.span`
  position: absolute;
  right: 1em;
  display: flex;
  align-items: center;
  gap: 1em;
`;

const EraMark = styled.span`
  color: var(--color_inside-accent);
  display: inline-flex;
  align-items: center;
  height: 25px;
  opacity: 0.75;
  user-select: none;
  white-space: nowrap;
`;

const EraWordmark = styled.span`
  font-family: GothamRoundedBold, 'Fira Sans Condensed', sans-serif;
  font-size: 24px;
  font-weight: 500;
  letter-spacing: -0.08em;
  line-height: 1;
  transform: skewX(-8deg);
`;

export const ExternalLinks = () => (
  <ExternalLinkContainer>
    <LanguageSelect />
    <EraMark aria-label="ERA">
      <EraWordmark aria-hidden="true">ERA</EraWordmark>
    </EraMark>
  </ExternalLinkContainer>
);
