import type {FC, ReactNode} from 'react';
import styled, {css} from 'styled-components';
import {followFirmwareLink} from 'src/utils/firmware-route';
import {focusRing} from './inputs/accent-button';

// Navigation to the firmware page, and a file download, are links rather than
// actions: an `<a href>` can open in a new tab. They take the look of
// AccentButton / PrimaryAccentButton in `inputs/accent-button.tsx`; the
// styled-components version here cannot retarget those to `<a>` with typed
// props, so the few declarations are mirrored.
const accentLink = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  height: 40px;
  padding: 0 15px;
  min-width: 100px;
  border: 1px solid var(--color_accent);
  border-radius: 5px;
  font-size: 20px;
  line-height: 40px;
  white-space: nowrap;
  text-decoration: none;
  opacity: 1;
  cursor: pointer;

  &:hover {
    opacity: 1;
    filter: brightness(0.7);
  }
  ${focusRing}
`;

export const AccentLink = styled.a`
  ${accentLink}
  color: var(--color_accent-text);
  border-color: var(--color_accent-text);
  background-color: var(--bg_outside-accent);
`;

export const PrimaryAccentLink = styled.a`
  ${accentLink}
  color: var(--color_inside-accent);
  background-color: var(--color_accent);
`;

export const FirmwareLinkButton: FC<{
  to: string;
  primary?: boolean;
  children: ReactNode;
  onNavigate?: () => void;
}> = ({to, primary, children, onNavigate}) => {
  const Link = primary ? PrimaryAccentLink : AccentLink;
  return (
    <Link href={to} onClick={followFirmwareLink(to, {onNavigate})}>
      {children}
    </Link>
  );
};
