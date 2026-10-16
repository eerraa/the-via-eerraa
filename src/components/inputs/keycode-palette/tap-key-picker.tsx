import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {createPortal} from 'react-dom';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import type {IKeycode, IKeycodeMenu} from 'src/utils/key';
import type {KeycodeLUT} from 'src/utils/keymap-extras';
import {
  buildCategorySections,
  searchPalette,
  type PaletteItem,
} from 'src/utils/keycode-palette';
import {
  CloseAction,
  Hint,
  SearchField,
  Section,
  SectionLabel,
  Tab,
  TabRow,
  hairline,
  muted,
  strong,
} from './palette-parts';

// The key of a Tap Dance action, or of a keycode setting, is chosen in a window
// over the whole app, so what it is chosen for stays as it is. The window offers
// the keys `isAllowed` lets through in the palette's own categories
// and layout, and leaves out a category left without one: for a tap key, only the
// keys a tap can send. A pick takes the key and closes the window; Esc, Close or a
// click beside it close it with nothing changed.

const LTMT_TAB = 'ltmt';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(0 0 0 / 58%);
`;

const Window = styled.div<{$wide: boolean}>`
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 1001;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  width: ${(props) => (props.$wide ? 'min(1160px, 94vw)' : 'min(1040px, 92vw)')};
  height: 88vh;
  box-sizing: border-box;
  border: 1px solid ${hairline};
  border-radius: 12px;
  background: var(--bg_menu);
  box-shadow: 0 18px 48px rgb(0 0 0 / 45%);
  color: ${strong};
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 22px 0;

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 400;
    color: ${strong};
  }
  p {
    margin: 0;
    font-size: 15px;
    color: ${muted};
  }
`;

// What the keys are picked for, between the title and the tabs: the Tap Dance
// editor.
const HeadBody = styled.div`
  flex-shrink: 0;
  padding: 10px 22px 4px;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  border-bottom: 1px solid ${hairline};
`;

const Body = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 18px 22px;
`;

export const TapKeyPicker = ({
  menus,
  layout,
  title,
  subtitle,
  searchLabel,
  isAllowed,
  renderRow,
  returnFocus,
  onClose,
  head,
  ltmt,
  wide = false,
}: {
  /** The palette's categories, every one of them. */
  menus: IKeycodeMenu[];
  layout?: KeycodeLUT;
  /** What is chosen: "Choose a tap key". */
  title: string;
  /** What it is chosen for, where the title does not say. */
  subtitle?: string;
  /** The search box's name for a screen reader: what it searches. */
  searchLabel: string;
  /** Whether the window offers the key. */
  isAllowed: (keycode: IKeycode) => boolean;
  /** A row of keys as the palette draws it, where a pick sets the key. */
  renderRow: (row: PaletteItem[], rowIndex: number) => ReactNode;
  /** The place it was opened from, which focus goes back to. */
  returnFocus: RefObject<HTMLElement>;
  onClose: () => void;
  /** Over the tabs, what the keys are picked for; it takes focus as it opens. */
  head?: ReactNode;
  /** The hold tab: its name, its choices, and the category it goes before (last without it). */
  ltmt?: {label: string; content: ReactNode; before: string};
  /** Room for the Tap Dance editor on one line. */
  wide?: boolean;
}) => {
  const {t} = useTranslation();
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const shownTab = useRef<HTMLButtonElement>(null);
  const categories = menus.filter((menu) => menu.keycodes.some(isAllowed));
  // The hold tab goes where KEYMAP has LT·MT: before Tap Dance. A Tap Dance
  // action's window names it Modifiers, the only choices it offers there.
  const tabs = categories.map((menu) => ({id: menu.id, label: t(menu.label)}));
  if (ltmt) {
    const at = tabs.findIndex((tab) => tab.id === ltmt.before);
    tabs.splice(at < 0 ? tabs.length : at, 0, {
      id: LTMT_TAB,
      label: ltmt.label,
    });
  }
  // A window with no keys to offer opens on the hold tab, so a tab still takes focus.
  const [category, setCategory] = useState(tabs[0]?.id);
  const [query, setQuery] = useState('');
  const trimmed = query.trim();

  // While it is open the rest of the page is inert, a keycode dock it was opened
  // from too. Focus starts on the category shown and goes back to the place it was
  // opened from once the page is live again.
  useEffect(() => {
    const others = Array.from(document.body.children).filter(
      (element) =>
        element !== layerRef.current && !element.hasAttribute('inert'),
    );
    others.forEach((element) => element.setAttribute('inert', ''));
    if (!head) {
      shownTab.current?.focus();
    }
    return () => {
      others.forEach((element) => element.removeAttribute('inert'));
      returnFocus.current?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // A keycode dock behind it closes on Escape as well; this closes only the window.
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      const stops = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input',
        ),
      );
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    }
  };

  let body: ReactNode;
  if (trimmed) {
    const hits = searchPalette(categories, trimmed, layout)
      .map(({menu, keys}) => ({
        menu,
        keys: keys.filter((key) => isAllowed(key.keycode)),
      }))
      .filter(({keys}) => keys.length > 0);
    body =
      hits.length === 0 ? (
        <Hint style={{padding: '24px 0'}}>{t('No matches')}</Hint>
      ) : (
        hits.map(({menu, keys}) => (
          <Section key={menu.id}>
            <SectionLabel>
              {t(menu.label).toUpperCase()} · {keys.length}
            </SectionLabel>
            {renderRow(keys, 0)}
          </Section>
        ))
      );
  } else if (ltmt && category === LTMT_TAB) {
    body = ltmt.content;
  } else {
    const menu = categories.find((item) => item.id === category);
    body = menu
      ? buildCategorySections(menu, layout).flatMap((section) => {
          const rows = section.rows
            .map((row) =>
              row.filter(
                (item) => item.kind === 'gap' || isAllowed(item.keycode),
              ),
            )
            .filter((row) => row.some((item) => item.kind === 'key'));
          return rows.length === 0
            ? []
            : [
                <Section key={section.id}>
                  {section.label ? (
                    <SectionLabel>{t(section.label)}</SectionLabel>
                  ) : null}
                  {rows.map((row, rowIndex) => renderRow(row, rowIndex))}
                </Section>,
              ];
        })
      : null;
  }

  return createPortal(
    <div ref={layerRef}>
      <Backdrop onClick={onClose} />
      <Window
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        $wide={wide}
        onKeyDown={onKeyDown}
      >
        <Head>
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <CloseAction
            type="button"
            $tone="plain"
            style={{marginLeft: 'auto'}}
            onClick={onClose}
          >
            {t('Close')}
          </CloseAction>
        </Head>
        {head ? <HeadBody>{head}</HeadBody> : null}
        <Bar>
          <TabRow
            $height={52}
            role="group"
            aria-label={t('Keycode categories')}
          >
            {tabs.map((tab) => {
              const selected = tab.id === category && !trimmed;
              return (
                <Tab
                  key={tab.id}
                  ref={tab.id === category ? shownTab : undefined}
                  type="button"
                  $selected={selected}
                  aria-pressed={selected}
                  onClick={() => {
                    setCategory(tab.id);
                    setQuery('');
                  }}
                >
                  {tab.label}
                </Tab>
              );
            })}
          </TabRow>
          <SearchField
            aria-label={searchLabel}
            placeholder={t('Search keycodes')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Bar>
        <Body>{body}</Body>
      </Window>
    </div>,
    document.body,
  );
};
