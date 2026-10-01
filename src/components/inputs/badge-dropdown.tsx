import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {faAngleDown} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import styled, {css} from 'styled-components';
import {focusRing} from './accent-button';

// The Configure badges own this face. Their device/layout actions remain in
// their panes; Firmware reuses the same typography, animation and menu surface.
export const BadgeContainer = styled.div`
  position: relative;
  font-size: 18px;
  pointer-events: none;
  font-weight: 400;
  flex: 0 0 auto;
`;

const badgeTitleStyles = css`
  pointer-events: all;
  display: inline-block;
  background: var(--color_accent);
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  font-family: inherit;
  font-size: 18px;
  font-weight: inherit;
  line-height: normal;
  text-transform: uppercase;
  color: var(--color_inside-accent);
  padding: 1px 10px;
  border: solid 1px var(--bg_control);
  border-top: none;
  cursor: pointer;
  transition: all 0.1s ease-out;
  white-space: nowrap;

  &:hover {
    filter: brightness(0.7);
  }
`;

export const BadgeTitle = styled.label`
  ${badgeTitleStyles}
`;

export const BadgeList = styled.ul<{$show: boolean}>`
  font-family: inherit;
  font-size: 18px;
  font-weight: 400;
  line-height: normal;
  padding: 0;
  border: 1px solid var(--bg_control);
  border-radius: 6px;
  background-color: var(--bg_menu);
  margin: 0;
  margin-top: 5px;
  right: 0;
  position: absolute;
  pointer-events: ${(props) => (props.$show ? 'all' : 'none')};
  transition: all 0.2s ease-out;
  z-index: 11;
  opacity: ${(props) => (props.$show ? 1 : 0)};
  transform: ${(props) => (props.$show ? 'translateY(0)' : 'translateY(-5px)')};
`;

export const BadgeOption = styled.button<{$selected?: boolean}>`
  display: block;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 300;
  line-height: normal;
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
  padding: 5px 10px;

  &:hover {
    border: none;
    background: ${(props) =>
      props.$selected ? 'var(--bg_icon-highlighted)' : 'var(--bg_control)'};
    color: ${(props) =>
      props.$selected
        ? 'var(--color_control-highlighted)'
        : 'var(--color_label-highlighted)'};
  }
`;

export const BadgeClickCover = styled.div`
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

const DropdownContainer = styled(BadgeContainer)`
  flex: 0 1 auto;
  min-width: 0;
  max-width: min(320px, calc((100vw - 40px) / 2));
`;

const DropdownTitle = styled.button`
  ${badgeTitleStyles}
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  box-sizing: border-box;
  ${focusRing}

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  > svg {
    flex: none;
  }
`;

type PopupBounds = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/** Keep an anchored menu within the viewport, independently of pane clipping. */
export const badgePopupBounds = (
  anchor: {right: number; top: number; bottom: number},
  viewport: {width: number; height: number},
  menuWidth = 220,
  menuHeight = 400,
): PopupBounds => {
  const width = Math.max(0, Math.min(menuWidth, viewport.width - 16));
  const left = Math.max(
    8,
    Math.min(anchor.right - width, viewport.width - width - 8),
  );
  const below = Math.max(0, viewport.height - anchor.bottom - 5 - 8);
  const above = Math.max(0, anchor.top - 5 - 8);
  const openBelow = below >= Math.min(120, menuHeight) || below >= above;
  const maxHeight = Math.min(400, menuHeight, openBelow ? below : above);
  return {
    left,
    top: openBelow
      ? anchor.bottom + 5
      : Math.max(8, anchor.top - 5 - Math.min(menuHeight, maxHeight)),
    width,
    maxHeight,
  };
};

const DropdownList = styled(BadgeList)<{$bounds: PopupBounds}>`
  position: fixed;
  top: ${(props) => props.$bounds.top}px;
  left: ${(props) => props.$bounds.left}px;
  right: auto;
  width: ${(props) => props.$bounds.width}px;
  max-width: calc(100vw - 16px);
  max-height: ${(props) => props.$bounds.maxHeight}px;
  box-sizing: border-box;
  margin-top: 0;
  overflow: auto;
  font-family: inherit;

  > li {
    list-style: none;
  }
`;

const DropdownOption = styled(BadgeOption)<{$uppercase: boolean}>`
  text-transform: ${(props) => (props.$uppercase ? 'uppercase' : 'none')};
  white-space: normal;
  overflow-wrap: anywhere;
  ${focusRing}

  &:focus-visible {
    background: ${(props) =>
      props.$selected ? 'var(--bg_icon-highlighted)' : 'var(--bg_control)'};
  }
`;

type DataAttributes = Record<`data-${string}`, string>;
export type BadgeDropdownOption = {
  value: string;
  label: string;
  attributes?: DataAttributes;
};

export const BadgeDropdown = ({
  label,
  title,
  value,
  options,
  onChange,
  triggerAttributes,
  uppercaseOptions = false,
}: {
  label: string;
  title: string;
  value: string;
  options: BadgeDropdownOption[];
  onChange: (value: string) => void;
  triggerAttributes?: DataAttributes;
  uppercaseOptions?: boolean;
}) => {
  const [show, setShow] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(value);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [bounds, setBounds] = useState<PopupBounds>({
    left: 8,
    top: 8,
    width: 220,
    maxHeight: 400,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusOnOpen = useRef<'first' | 'last' | 'selected' | null>(null);
  const listId = useId();
  const close = () => {
    focusOnOpen.current = null;
    setShow(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (typeof document !== 'undefined' && document.body?.nodeType === 1) {
      setPortalHost(document.body);
    }
  }, []);

  useLayoutEffect(() => {
    if (
      !show ||
      !trigger.current ||
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function'
    ) {
      return;
    }
    const fit = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) {
        return;
      }
      setBounds(
        badgePopupBounds(
          anchor,
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          220,
          list.current
            ? list.current.scrollHeight +
                list.current.offsetHeight -
                list.current.clientHeight
            : 400,
        ),
      );
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [show, options]);

  useEffect(() => {
    if (!show || !focusOnOpen.current) {
      return;
    }
    const chosen =
      focusOnOpen.current === 'selected'
        ? (options.find((option) => option.value === value) ?? options[0])
        : focusOnOpen.current === 'last'
          ? options.at(-1)
          : options[0];
    focusOnOpen.current = null;
    if (chosen) {
      setActiveValue(chosen.value);
      optionRefs.current.get(chosen.value)?.focus();
    }
  }, [show, options, value]);

  const popup = (
    <>
      {show && (
        <BadgeClickCover data-badge-dropdown-overlay={label} onClick={close} />
      )}
      <DropdownList
        ref={list}
        id={listId}
        role="menu"
        aria-label={label}
        aria-hidden={!show}
        data-badge-dropdown-list={label}
        $show={show}
        $bounds={bounds}
      >
        {options.map((option) => (
          <li key={option.value}>
            <DropdownOption
              ref={(node) => {
                if (node) {
                  optionRefs.current.set(option.value, node);
                } else {
                  optionRefs.current.delete(option.value);
                }
              }}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={show && option.value === activeValue ? 0 : -1}
              onFocus={() => setActiveValue(option.value)}
              $selected={option.value === value}
              $uppercase={uppercaseOptions}
              {...option.attributes}
              onClick={() => {
                close();
                onChange(option.value);
              }}
            >
              {option.label}
            </DropdownOption>
          </li>
        ))}
      </DropdownList>
    </>
  );

  return (
    <DropdownContainer
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !list.current?.contains(event.relatedTarget)
        ) {
          setShow(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && show) {
          event.preventDefault();
          close();
        } else if (event.key === 'Tab' && show) {
          close();
        } else if (
          options.length > 0 &&
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
        ) {
          event.preventDefault();
          if (!show) {
            focusOnOpen.current =
              event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first';
            setShow(true);
          } else {
            const current =
              typeof document === 'undefined'
                ? -1
                : options.findIndex(
                    (option) =>
                      optionRefs.current.get(option.value) ===
                      document.activeElement,
                  );
            const index =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : event.key === 'ArrowDown'
                    ? current < 0
                      ? 0
                      : (current + 1) % options.length
                    : current < 0
                      ? options.length - 1
                      : (current + options.length - 1) % options.length;
            const chosen = options[index];
            if (chosen) {
              setActiveValue(chosen.value);
              optionRefs.current.get(chosen.value)?.focus();
            }
          }
        }
      }}
    >
      <DropdownTitle
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={show}
        aria-controls={listId}
        title={title}
        {...triggerAttributes}
        onClick={(event) => {
          if (!show) {
            setActiveValue(
              options.find((option) => option.value === value)?.value ??
                options[0]?.value ??
                null,
            );
            focusOnOpen.current = event?.detail === 0 ? 'selected' : null;
          }
          setShow((current) => !current);
        }}
      >
        <span>{title}</span>
        <FontAwesomeIcon
          icon={faAngleDown}
          style={{
            transform: show ? 'rotate(180deg)' : '',
            transition: 'transform 0.2s ease-out',
            marginLeft: '5px',
          }}
        />
      </DropdownTitle>
      {portalHost ? createPortal(popup, portalHost) : popup}
    </DropdownContainer>
  );
};
