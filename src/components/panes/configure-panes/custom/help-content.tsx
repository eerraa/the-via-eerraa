import {Fragment, type FC} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import type {EraHelpContent} from 'src/utils/era-feature-help';

// What an ERA help disclosure shows when it opens, at the size of the text around it.
// Paragraphs, then the choices as a list of name and one sentence. The choice the
// control holds now reads brighter and the shipped one carries a mark, so the
// list answers "what am I on, and what else is there" without a sentence spelling it
// out. Nothing here adds a box or a heading: it stays quiet.

export const HelpBody = styled.div`
  flex-basis: 100%;
  max-width: 760px;
  box-sizing: border-box;
  margin: 2px 0 14px;
  color: var(--color_label);
  font-size: 16px;
  line-height: 1.65;

  &[hidden] {
    display: none;
  }
`;

// A span laid out as a block, so a folded body holds no nested div and reads as one
// element to anything that strips it.
const Paragraph = styled.span`
  display: block;
  margin: 0 0 8px;
  white-space: pre-line;

  &:last-child {
    margin-bottom: 0;
  }
`;

const Choices = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 20px;
  row-gap: 6px;
  margin: 0 0 8px;

  &:last-child {
    margin-bottom: 0;
  }

  dt {
    white-space: nowrap;
  }
  dt[data-current] {
    color: var(--color_label-highlighted);
  }
  dd {
    margin: 0;
  }
`;

// At the size of the name beside it, in the muted label colour, after a dot, as the
// palette pairs "Esc · Function". Beside the current choice's brighter name the colour
// parts the two, and beside a name as muted as the mark the dot does. An accent colour
// would not: some keycap themes make it the colour of the name.
const DefaultMark = styled.span`
  color: var(--color_label);

  &::before {
    content: ' · ';
  }
`;

export const HelpContent: FC<{
  content: EraHelpContent;
  /** The choice the control holds now, as its option label. */
  current?: string | null;
}> = ({content, current}) => {
  const {t} = useTranslation();
  return (
    <>
      {content.detail?.map((paragraph) => (
        <Paragraph key={paragraph}>{t(paragraph)}</Paragraph>
      ))}
      {content.choices?.length ? (
        <Choices>
          {content.choices.map((choice) => (
            <Fragment key={choice.name}>
              <dt data-current={choice.name === current ? '' : undefined}>
                {choice.name}
                {choice.name === content.defaultChoice ? (
                  <DefaultMark>{t('Default')}</DefaultMark>
                ) : null}
              </dt>
              <dd>{t(choice.text)}</dd>
            </Fragment>
          ))}
        </Choices>
      ) : null}
    </>
  );
};
