import {FC, useId, useMemo, useRef, useState} from 'react';
import {faLanguage} from '@fortawesome/free-solid-svg-icons';
import {CategoryIconContainer} from '../panes/grid';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';

const Container = styled.div`
  position: relative;
  font-size: 18px;
`;

const LanguageList = styled.ul<{$show: boolean}>`
  padding: 0;
  border: 1px solid var(--bg_control);
  width: 160px;
  border-radius: 6px;
  background-color: var(--bg_menu);
  margin: 0;
  margin-top: 5px;
  top: 30px;
  right: 0px;
  @media (max-width: 720px) {
    left: 0;
    right: auto;
  }
  position: absolute;
  pointer-events: ${(props) => (props.$show ? 'all' : 'none')};
  transition: all 0.2s ease-out;
  z-index: 11;
  opacity: ${(props) => (props.$show ? 1 : 0)};
  /* Hidden once faded out, so a closed list's buttons leave the Tab order. */
  visibility: ${(props) => (props.$show ? 'visible' : 'hidden')};
  overflow: hidden;
  transform: ${(props) => (props.$show ? 0 : `translateY(-5px)`)};
`;

const LanugaeButton = styled.button<{$selected?: boolean}>`
  display: block;
  text-align: center;
  outline: none;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  border: none;
  background: ${(props) =>
    props.$selected ? 'var(--bg_icon-highlighted)' : 'transparent'};
  color: ${(props) =>
    props.$selected
      ? 'var(--color_icon_highlighted)'
      : 'var(--color_label-highlighted)'};
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  text-transform: uppercase;
  padding: 5px 10px;
  &:hover,
  &:focus-visible {
    border: none;
    background: ${(props) =>
      props.$selected ? 'var(--bg_icon-highlighted)' : 'var(--bg_control)'};
    color: ${(props) =>
      props.$selected
        ? 'var(--color_control-highlighted)'
        : 'var(--color_label-highlighted)'};
  }
`;

const ClickCover = styled.div`
  position: fixed;
  z-index: 10;
  pointer-events: all;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0.4;
  background: rgba(0, 0, 0, 0.75);
`;

const LanguageSelectors: React.FC<{
  id: string;
  show: boolean;
  onClickOut: () => void;
  onChosen: () => void;
}> = (props) => {
  const langs = [
    {code: 'en', lang: 'English'},
    {code: 'zh', lang: '中文'},
    {code: 'ko', lang: '한국어'},
    {code: 'ja', lang: '日本語'},
    {code: 'es', lang: 'Español'},
    {code: 'de', lang: 'Deutsch'},
  ];
  const {i18n} = useTranslation();
  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    props.onChosen();
  };

  const selectLang = useMemo(() => {
    return i18n.resolvedLanguage
      ? i18n.resolvedLanguage
      : i18n.languages[i18n.languages.length - 1];
  }, [i18n.resolvedLanguage, i18n.languages]);

  return (
    <>
      {props.show && <ClickCover onClick={props.onClickOut} />}
      <LanguageList id={props.id} $show={props.show}>
        {langs.map(({lang, code}) => {
          return (
            <LanugaeButton
              $selected={code === selectLang}
              key={code}
              onClick={() => changeLanguage(code)}
            >
              {lang}
            </LanugaeButton>
          );
        })}
      </LanguageList>
    </>
  );
};

export const LanguageSelect: FC = () => {
  const {t} = useTranslation();
  const [showList, setShowList] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  // Choosing or Escape closes the list and gives focus back to its button;
  // focus that moves on past the list closes it too.
  const closeToButton = () => {
    setShowList(false);
    buttonRef.current?.focus();
  };
  return (
    <Container
      onKeyDown={(event) => {
        if (event.key === 'Escape' && showList) {
          closeToButton();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setShowList(false);
        }
      }}
    >
      <CategoryIconContainer
        as="button"
        type="button"
        ref={buttonRef}
        aria-label={t('Language')}
        aria-expanded={showList}
        aria-controls={listId}
        onClick={() => setShowList((show) => !show)}
      >
        <FontAwesomeIcon size={'xl'} icon={faLanguage} />
      </CategoryIconContainer>
      <LanguageSelectors
        id={listId}
        show={showList}
        onClickOut={() => setShowList(false)}
        onChosen={closeToButton}
      />
    </Container>
  );
};
