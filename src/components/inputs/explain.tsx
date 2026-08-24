import {useId, useState, type ReactNode} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';

// Caveat text is not content — it is an answer to a question the reader may not have
// asked yet. Rendering every caveat permanently is what pushed the diagnostics result
// past four screens while the actual measurements took up a fraction of that. The text
// is kept verbatim and moved one interaction away, next to the thing it explains.
//
// This is a plain in-flow disclosure rather than a floating popover: it cannot be
// clipped by a card's overflow, it works on touch, it is keyboard-operable for free,
// and the text stays selectable and findable with the browser's own find-in-page.
const Toggle = styled.button<{$open: boolean}>(({$open}) => ({
  appearance: 'none',
  flex: 'none',
  width: 20,
  height: 20,
  lineHeight: '18px',
  padding: 0,
  borderRadius: '50%',
  border: '1px solid var(--color_accent)',
  background: $open ? 'var(--color_accent)' : 'transparent',
  color: $open ? 'var(--color_inside-accent)' : 'var(--color_accent)',
  fontSize: 13,
  fontStyle: 'italic',
  fontFamily: 'Georgia, serif',
  cursor: 'pointer',
  ':hover': {filter: 'brightness(1.25)'},
}));

const Body = styled.p({
  flexBasis: '100%',
  '&[hidden]': {display: 'none'},
  color: 'var(--color_label)',
  opacity: 0.82,
  fontSize: 14,
  lineHeight: 1.55,
  margin: '8px 0 0',
});

// Place inside a `display: flex; flex-wrap: wrap` heading row: the button sits next to
// the title and the body wraps onto its own full-width line underneath.
export const Explain = ({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) => {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <Toggle
        $open={open}
        aria-controls={id}
        aria-expanded={open}
        aria-label={label ?? t('What this means')}
        onClick={() => setOpen((previous) => !previous)}
        type="button"
      >
        i
      </Toggle>
      {/* Kept in the DOM while collapsed: the text stays available to
          find-in-page and to anything reading the page, and only stops taking
          up the screen. */}
      <Body hidden={!open} id={id}>
        {children}
      </Body>
    </>
  );
};

export const ExplainRow = styled.div({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
});
