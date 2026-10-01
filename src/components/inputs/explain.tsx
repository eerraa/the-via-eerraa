import {useId, useState, type ReactNode} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {focusRing} from './accent-button';

// Caveat text is not content — it is an answer to a question the reader may not have
// asked yet. Rendering every caveat permanently is what pushed the diagnostics result
// past four screens while the actual measurements took up a fraction of that. The text
// is kept verbatim and moved one interaction away, next to the thing it explains.
//
// This is a plain in-flow disclosure rather than a floating popover: it cannot be
// clipped by a card's overflow, it works on touch, it is keyboard-operable for free,
// and the text stays selectable and findable with the browser's own find-in-page.
// Quiet until it is wanted: the app's own face, the label colour, the accent only on
// hover and while open.
const Toggle = styled.button<{$open: boolean}>(({$open}) => ({
  appearance: 'none',
  flex: 'none',
  width: 20,
  height: 20,
  lineHeight: '18px',
  padding: 0,
  borderRadius: '50%',
  border: `1px solid ${$open ? 'var(--color_accent)' : 'var(--color_label)'}`,
  background: $open ? 'var(--color_accent)' : 'transparent',
  color: $open ? 'var(--color_inside-accent)' : 'var(--color_label)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  cursor: 'pointer',
  '&:hover': $open
    ? {filter: 'brightness(1.1)'}
    : {
        borderColor: 'var(--color_accent-text)',
        color: 'var(--color_accent-text)',
      },
  ...focusRing,
}));

// Exported so a caller that cannot keep the button and the body adjacent — a control
// row puts the button beside the label and the body on its own line under both
// columns — can still render the same body.
export const ExplainBody = styled.p({
  flexBasis: '100%',
  '&[hidden]': {display: 'none'},
  color: 'var(--color_label)',
  opacity: 0.82,
  fontSize: 13,
  lineHeight: 1.6,
  whiteSpace: 'pre-line',
  margin: '8px 0 0',
});

// The open state stays inside this hook and `hidden` is handed out already resolved,
// so no caller can turn the collapsed body into `{open && <Body/>}`. That is the
// contract: folded text stays in the DOM for find-in-page and for anything reading
// the page, and only stops taking up the screen.
export const useExplainDisclosure = (label?: string) => {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return {
    bodyProps: {hidden: !open, id},
    toggle: (
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
    ),
  };
};

// Place inside a `display: flex; flex-wrap: wrap` heading row: the button sits next to
// the title and the body wraps onto its own full-width line underneath.
export const Explain = ({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) => {
  const {toggle, bodyProps} = useExplainDisclosure(label);
  return (
    <>
      {toggle}
      <ExplainBody {...bodyProps}>{children}</ExplainBody>
    </>
  );
};

export const ExplainRow = styled.div({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
});
