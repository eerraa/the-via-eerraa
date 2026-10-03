import styled from 'styled-components';

export const DIRTY_DOT_GAP = 8;

/** Marks a draft awaiting Apply or a successful save, including SAVE retries. */
export const DirtyDot = styled.span`
  display: inline-block;
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color_accent);
`;
