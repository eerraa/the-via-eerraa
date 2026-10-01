import React, {Component, KeyboardEventHandler} from 'react';
import {createPortal} from 'react-dom';
import styled from 'styled-components';

import {
  toDegrees,
  calcRadialHue,
  calcRadialMagnitude,
  getHSV,
  getRGB,
  getHex,
} from '../../utils/color-math';

type Color = {
  hue: number;
  sat: number;
};

type Props = {
  isSelected?: boolean;
  /** The row's name, which the swatch reads out with the colour's code. */
  label?: string;
  color: Color;
  setColor: (hue: number, sat: number) => void;
  onOpen?: () => void;
  onMouseUp?: (hue: number, sat: number) => void;
  onClose?: (hue: number, sat: number) => void;
  onInteractionComplete?: () => void;
  onInteractionCancel?: () => void;
};

type Placement = {top: number; left: number; arrowTop: number};

type State = {
  lensTransform: string;
  showPicker: boolean;
  offset: [number, number];
  hexColorCode: string;
  placement: Placement | null;
};

const ColorPickerContainer = styled.div`
  display: flex;
  align-items: center;
`;

const ColorLens = styled.div`
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid black;
  opacity: 0.7;
  background: rgba(255, 255, 255, 0.2);
  pointer-events: none;
  box-sizing: border-box;
  transform: translate3d(195px, 195px, 0);
`;
const ColorInner = styled.div`
  width: 100%;
  height: 100%;
  background: linear-gradient(to top, white, rgba(0, 0, 0, 0));
`;

const ColorOuter = styled.div`
  width: 100%;
  height: 100%;
  touch-action: none;
  background: linear-gradient(
    to right,
    red,
    yellow,
    lime,
    aqua,
    blue,
    magenta,
    red
  );
`;

const ColorThumbnail = styled.button`
  display: inline-block;
  height: 25px;
  width: 25px;
  border-radius: 50%;
  border: 4px solid var(--border_color_cell);
  box-sizing: content-box;
  margin: 0;
  padding: 0;
  cursor: pointer;
  &:hover {
    opacity: 0.8;
  }
  &:focus-visible {
    outline: 2px solid var(--color_accent);
    outline-offset: 2px;
  }
`;

const Container = styled.div`
  border: 4px solid var(--border_color_cell);
  width: 180px;
  height: 180px;
  position: relative;
`;

// Drawn over the whole window, so the pane it opens from cannot cut it off.
const PickerContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  z-index: 4;
  box-shadow: rgba(0, 0, 0, 0.11) 0 1px 1px 1px;
  position: fixed;

  &::after {
    content: '';
    position: absolute;
    width: 0px;
    height: 0px;
    border: 11px solid var(--border_color_cell);
    border-top-color: transparent;
    border-bottom-color: transparent;
    border-right-color: transparent;
    right: -22px;
    top: var(--arrow-top, 66px);
  }
`;

const ColorPreview = styled.div`
  width: 180px;
  height: 24px;
  border: 4px solid var(--border_color_cell);
  border-bottom: none;
`;

const ColorHexContainer = styled.div`
  border: 4px solid var(--border_color_cell);
  border-bottom: none;
  width: 180px;
  height: 32px;
  line-height: 32px;
  text-align: center;
  background: var(--bg_menu);
`;

const ColorHexInput = styled.input`
  text-align: center;
  border: none;
  color: var(--color_accent);
  background: var(--bg_menu);
  font-size: 20px;
  font-weight: 300;
  padding: 0;
  width: 100%;
  &:focus {
    outline: none;
    color: var(--color_accent);
    border-color: var(--color_accent);
  }
`;

const POPUP_LEFT = 205;
const ARROW_TOP = 66;
const ARROW_SIZE = 22;
const WINDOW_MARGIN = 8;

/**
 * Where the popup goes in the window: 205px left of its swatch, with the arrow on the
 * swatch's middle. It opens downward when the window has room below the swatch and
 * upward when it has not, and stays inside the window either way.
 */
export const placeColorPopup = (
  swatch: {left: number; top: number; height: number},
  popup: {width: number; height: number},
  view: {width: number; height: number},
): Placement => {
  const middle = swatch.top + swatch.height / 2;
  const down = middle - ARROW_TOP - ARROW_SIZE / 2;
  const up = middle + ARROW_TOP + ARROW_SIZE / 2 - popup.height;
  const lowest = view.height - popup.height - WINDOW_MARGIN;
  const top = Math.max(
    WINDOW_MARGIN,
    Math.min(down <= lowest || up < WINDOW_MARGIN ? down : up, lowest),
  );
  const left = Math.max(
    WINDOW_MARGIN,
    Math.min(
      swatch.left - POPUP_LEFT,
      view.width - popup.width - WINDOW_MARGIN,
    ),
  );
  const arrowTop = Math.max(
    0,
    Math.min(middle - top - ARROW_SIZE / 2, popup.height - ARROW_SIZE),
  );
  return {top, left, arrowTop};
};

export class ColorPicker extends Component<Props, State> {
  ref: HTMLDivElement | null = null;
  refWidth: number = 0;
  refHeight: number = 0;
  mouseDown: boolean = false;
  // The hex field holds a code the user typed and has not applied yet.
  hexEdited: boolean = false;
  // The popup was closed from the keyboard, so focus goes back to the swatch.
  refocusSwatch: boolean = false;

  state = {
    lensTransform: '',
    showPicker: false,
    offset: [5, 5] as [number, number],
    hexColorCode: getHex(this.props.color),
    placement: null as Placement | null,
  };

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.onDocumentClick);
    document.removeEventListener('click', this.onDocumentClick);
    document.removeEventListener('keydown', this.onDocumentKeyDown);
    this.followSwatch(false);
    this.props.onInteractionComplete?.();
  }

  componentDidUpdate({color}: {color: Color}, state: State) {
    if (
      this.ref &&
      this.state.showPicker &&
      (!state.showPicker || color !== this.props.color)
    ) {
      const {width, height} = this.ref.getBoundingClientRect();
      this.refWidth = width;
      this.refHeight = height;
      const {hue, sat} = this.props.color;
      const offsetX = (width * hue) / 255;
      const offsetY = height * (1 - sat / 255);
      const lensTransform = `translate3d(${offsetX - 5}px, ${
        offsetY - 5
      }px, 0)`;
      this.setState({lensTransform, offset: [offsetX, offsetY]});
    }
    if (this.state.showPicker !== state.showPicker) {
      this.followSwatch(this.state.showPicker);
      if (this.state.showPicker) {
        this.placePicker();
        this.hexInput.current?.focus({preventScroll: true});
      } else if (this.refocusSwatch) {
        this.refocusSwatch = false;
        this.colorThumbnail.current?.focus();
      }
    }
    // A colour set anywhere else shows in the field, unless the user is typing there.
    if (
      !this.hexEdited &&
      (color.hue !== this.props.color.hue ||
        color.sat !== this.props.color.sat)
    ) {
      const hexColorCode = getHex(this.props.color);
      if (hexColorCode !== this.state.hexColorCode) {
        this.setState({hexColorCode});
      }
    }
  }
  componentDidMount() {
    document.addEventListener('click', this.onDocumentClick);
    document.addEventListener('mousedown', this.onDocumentClick);
    document.addEventListener('keydown', this.onDocumentKeyDown);
  }

  // For the color picker uses a conical gradient
  getRadialHueSat(evt: React.MouseEvent<Element>) {
    const {offsetX, offsetY} = evt.nativeEvent;
    const hue = toDegrees(calcRadialHue(offsetX, offsetY) ?? 0);
    const sat = Math.min(1, calcRadialMagnitude(offsetX, offsetY) ?? 0);
    return {hue, sat};
  }

  // For standard color picker uses a conical gradient
  getLinearHueSat([offsetX, offsetY]: [number, number]) {
    // calculate later
    const width = this.refWidth;
    const height = this.refHeight;
    const [x, y] = [Math.max(0, offsetX), Math.max(0, offsetY)];
    const hue = 360 * Math.min(1, x / width);
    const sat = 1 - Math.min(1, y / height);
    return {hue, sat};
  }

  onMouseUp = () => {
    this.mouseDown = false;
    if (this.ref) {
      this.ref.style.cursor = 'auto';
    }
    if (this.props.onMouseUp) {
      const {hue, sat} = this.getLinearHueSat(this.state.offset);
      this.props.onMouseUp(hue, sat);
    }
    this.props.onInteractionComplete?.();
  };

  updateFromClientPoint = (clientX: number, clientY: number) => {
    if (!this.ref) {
      return;
    }
    const rect = this.ref.getBoundingClientRect();
    this.refWidth = rect.width;
    this.refHeight = rect.height;
    const offsetX = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const offsetY = Math.min(rect.height, Math.max(0, clientY - rect.top));
    const lensTransform = `translate3d(${offsetX - 5}px, ${
      offsetY - 5
    }px, 0)`;
    const offset = [offsetX, offsetY] as [number, number];
    const {hue, sat} = this.getLinearHueSat(offset);
    const color = {
      hue: Math.round(255 * (hue / 360)),
      sat: Math.round(255 * sat),
    };
    this.props.setColor(color.hue, color.sat);
    // The colour just sent: this.props still holds the one before it.
    this.setState({
      lensTransform,
      offset,
      hexColorCode: getHex(color),
    });
  };

  onPointerDown: React.PointerEventHandler = (evt) => {
    // The press picks the colour, so a code half typed into the field is dropped.
    this.hexEdited = false;
    this.mouseDown = true;
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    this.updateFromClientPoint(evt.clientX, evt.clientY);
    if (this.ref) {
      this.ref.style.cursor = 'pointer';
    }
  };

  onPointerMove: React.PointerEventHandler = (evt) => {
    if (this.mouseDown) {
      this.updateFromClientPoint(evt.clientX, evt.clientY);
    }
  };

  onPointerUp: React.PointerEventHandler = (evt) => {
    if (evt.currentTarget.hasPointerCapture?.(evt.pointerId)) {
      evt.currentTarget.releasePointerCapture(evt.pointerId);
    }
    this.onMouseUp();
  };

  onPointerCancel: React.PointerEventHandler = (evt) => {
    if (evt.currentTarget.hasPointerCapture?.(evt.pointerId)) {
      evt.currentTarget.releasePointerCapture(evt.pointerId);
    }
    this.mouseDown = false;
    if (this.ref) {
      this.ref.style.cursor = 'auto';
    }
    (this.props.onInteractionCancel ?? this.props.onInteractionComplete)?.();
  };

  onThumbnailClick = () => {
    if (this.state.showPicker) {
      this.closePicker();
      return;
    }
    if (this.props.onOpen) {
      this.props.onOpen();
    }
    this.hexEdited = false;
    this.setState({
      showPicker: true,
      placement: null,
      hexColorCode: getHex(this.props.color),
    });
  };

  // However the popup closes, the colour stays, as it always has for a click outside.
  // A complete code typed into the field applies first, as leaving the field does.
  closePicker = (refocusSwatch = false) => {
    this.applyHexDraft();
    if (this.props.onClose) {
      const {hue, sat} = this.getLinearHueSat(this.state.offset);
      this.props.onClose(hue, sat);
    }
    this.props.onInteractionComplete?.();
    this.mouseDown = false;
    this.refocusSwatch = refocusSwatch;
    this.setState({showPicker: false});
  };

  pickerContainer = React.createRef<HTMLDivElement>();
  colorThumbnail = React.createRef<HTMLButtonElement>();
  hexInput = React.createRef<HTMLInputElement>();

  placePicker = () => {
    const swatch = this.colorThumbnail.current;
    const popup = this.pickerContainer.current;
    // A test renderer has no window to place it in.
    if (!swatch || !popup || !window.innerHeight) {
      return;
    }
    this.setState({
      placement: placeColorPopup(
        swatch.getBoundingClientRect(),
        popup.getBoundingClientRect(),
        {width: window.innerWidth, height: window.innerHeight},
      ),
    });
  };

  // The popup does not scroll with the pane, so it follows its swatch instead, and
  // closes once the swatch has scrolled out of sight.
  followSwatch = (follow: boolean) => {
    if (follow) {
      window.addEventListener('resize', this.placePicker);
      window.addEventListener('scroll', this.onScroll, true);
    } else {
      window.removeEventListener('resize', this.placePicker);
      window.removeEventListener('scroll', this.onScroll, true);
    }
  };

  onScroll = (evt: Event) => {
    const swatch = this.colorThumbnail.current;
    const pane = evt.target;
    if (!swatch || !(pane instanceof Element) || !pane.contains(swatch)) {
      return;
    }
    const view = pane.getBoundingClientRect();
    const {top, bottom} = swatch.getBoundingClientRect();
    const middle = (top + bottom) / 2;
    if (middle < view.top || middle > view.bottom) {
      this.closePicker();
    } else {
      this.placePicker();
    }
  };

  onDocumentClick = (evt: MouseEvent) => {
    if (
      this.state.showPicker &&
      this.pickerContainer.current &&
      !this.pickerContainer.current.contains(evt.target as HTMLDivElement) &&
      this.colorThumbnail.current &&
      !this.colorThumbnail.current.contains(evt.target as HTMLDivElement) &&
      !this.mouseDown
    ) {
      this.closePicker();
    } else if (
      this.mouseDown &&
      this.state.showPicker &&
      this.pickerContainer.current &&
      !this.pickerContainer.current.contains(evt.target as HTMLDivElement) &&
      this.colorThumbnail.current &&
      !this.colorThumbnail.current.contains(evt.target as HTMLDivElement)
    ) {
      this.onMouseUp();
    }
  };

  // Esc closes the popup wherever focus is, and drops a code typed but not applied.
  onDocumentKeyDown = (evt: KeyboardEvent) => {
    if (evt.key !== 'Escape' || !this.state.showPicker) {
      return;
    }
    this.hexEdited = false;
    (this.props.onInteractionCancel ?? this.props.onInteractionComplete)?.();
    this.closePicker(true);
  };

  // The popup is drawn at the end of the page, where Tab would leave the page, so Tab
  // goes back to the swatch instead, keeping a complete code as leaving the field does.
  onPickerKeyDown: React.KeyboardEventHandler = (evt) => {
    if (evt.key === 'Tab') {
      evt.preventDefault();
      this.closePicker(true);
    }
  };

  handleHexChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    let value = e.target.value;
    value = value.replace(/[^A-Fa-f0-9]/g, '');
    if (value.length > 0 && value[0] !== '#') {
      value = `#${value}`;
    }
    if (value.length > 7) {
      value = value.substring(0, 7);
    }
    this.hexEdited = true;
    this.setState({hexColorCode: value});
  };

  handleHexBlur = () => {
    this.applyHexDraft();
  };

  handleHexSubmit: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter') {
      this.applyHexDraft();
    }
  };

  // A typed code applies once it has 3 or 6 digits; anything else goes back to the
  // colour in use. Only hue and saturation are sent, as brightness has a control of its
  // own, so the field then shows the colour that was set: #404040 becomes #ffffff.
  applyHexDraft = () => {
    if (!this.hexEdited) {
      return;
    }
    this.hexEdited = false;
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (!hexColorRegex.test(this.state.hexColorCode)) {
      this.setState({hexColorCode: getHex(this.props.color)});
      return;
    }
    var hexString = this.state.hexColorCode.replace('#', '');
    if (hexString.length == 3) {
      hexString = `${hexString
        .split('')
        .map((char) => char + char)
        .join('')}`;
    }
    const [h, s] = getHSV(hexString);
    const color = {hue: Math.round(255 * (h / 360)), sat: Math.round(255 * s)};
    this.props.setColor(color.hue, color.sat);
    this.props.onInteractionComplete?.();
    this.setState({hexColorCode: getHex(color)});
  };

  render() {
    const color = getRGB(this.props.color);
    const {isSelected = false, label} = this.props;
    const {offset, placement} = this.state;
    const hex = getHex(this.props.color);

    const lensTransform = `translate3d(${offset[0] - 5}px, ${
      offset[1] - 5
    }px, 0)`;
    const picker = this.state.showPicker && (
      <PickerContainer
        ref={this.pickerContainer}
        onKeyDown={this.onPickerKeyDown}
        style={
          placement
            ? ({
                top: placement.top,
                left: placement.left,
                '--arrow-top': `${placement.arrowTop}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <ColorHexContainer>
          <ColorHexInput
            ref={this.hexInput}
            type="text"
            value={this.state.hexColorCode}
            onChange={this.handleHexChange}
            onBlur={this.handleHexBlur}
            onKeyDown={this.handleHexSubmit}
          />
        </ColorHexContainer>
        <ColorPreview style={{background: getRGB(this.props.color)}} />
        <Container>
          <ColorOuter
            onPointerDown={this.onPointerDown}
            onPointerMove={this.onPointerMove}
            onPointerUp={this.onPointerUp}
            onPointerCancel={this.onPointerCancel}
            ref={(ref) => (this.ref = ref)}
          >
            <ColorInner>
              <ColorLens style={{transform: lensTransform}} />
            </ColorInner>
          </ColorOuter>
        </Container>
      </PickerContainer>
    );
    return (
      <>
        <ColorPickerContainer>
          <ColorThumbnail
            type="button"
            ref={this.colorThumbnail}
            onClick={this.onThumbnailClick}
            aria-label={label ? `${label}, ${hex}` : hex}
            aria-expanded={this.state.showPicker}
            style={{
              background: color,
              borderColor: !isSelected
                ? 'var(--border_color_cell)'
                : 'var(--color_accent)',
            }}
          />
          {picker &&
            // A test renderer has no page to draw the popup over.
            (typeof document !== 'undefined' && document.body
              ? createPortal(picker, document.body)
              : picker)}
        </ColorPickerContainer>
      </>
    );
  }
}

export const ArrayColorPicker: React.FC<{
  color: [number, number];
  label?: string;
  setColor: Props['setColor'];
  onInteractionComplete?: Props['onInteractionComplete'];
  onInteractionCancel?: Props['onInteractionCancel'];
}> = (props) => {
  const {color, label, setColor, onInteractionComplete, onInteractionCancel} =
    props;
  return (
    <ColorPicker
      color={{hue: color[0], sat: color[1]}}
      label={label}
      setColor={setColor}
      onInteractionComplete={onInteractionComplete}
      onInteractionCancel={onInteractionCancel}
    />
  );
};
