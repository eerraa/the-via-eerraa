import styled from 'styled-components';

/** Marks what holds a change that is not written to the keyboard yet. */
export const DirtyDot = styled.span`
  display: inline-block;
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color_accent);
`;
