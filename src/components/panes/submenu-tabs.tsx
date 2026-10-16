import type {ReactNode} from 'react';
import styled from 'styled-components';
import {Tab, TabRow, tabStyles} from '../inputs/keycode-palette/palette-parts';
import {SpanOverflowCell} from './grid';

// A pane's submenus as tabs across the top, the way KEYMAP shows its keycode
// categories, instead of VIA's list down the left. The tabs sit centred in the
// column the setting rows use, and stay put while the content scrolls.

export const TabbedCell = styled(SpanOverflowCell)`
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

export const TabbedBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
`;

const Bar = styled.div`
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 0 12px;
  border-bottom: 1px solid var(--border_color_cell);
`;

const Column = styled.div`
  width: 100%;
  max-width: 960px;

  > * {
    justify-content: center;
  }
`;

/** Button tabs are a group named by `label`; link tabs are navigation. */
export const SubmenuTabBar = ({
  children,
  label,
  links = false,
}: {
  children: ReactNode;
  label?: string;
  links?: boolean;
}) => (
  <Bar>
    <Column>
      <TabRow
        $height={56}
        as={links ? 'nav' : 'div'}
        role={links ? undefined : 'group'}
        aria-label={label}
      >
        {children}
      </TabRow>
    </Column>
  </Bar>
);

export {Tab as SubmenuTab};

/** A tab that is a place: a link, so it can open in a new tab or be shared. */
export const SubmenuTabLink = styled.a<{$selected: boolean}>`
  ${tabStyles}
  opacity: 1;
  text-decoration: none;

  &:hover {
    opacity: 1;
  }
`;
