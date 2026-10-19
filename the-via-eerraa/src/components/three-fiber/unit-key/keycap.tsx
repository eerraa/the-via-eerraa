import {animated, useSpring} from '@react-spring/three';
import {Html} from '@react-three/drei';
import {ThreeEvent} from '@react-three/fiber';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {shallowEqual} from 'react-redux';
import {
  DisplayMode,
  KeycapState,
  ThreeFiberKeycapProps,
} from 'src/types/keyboard-rendering';
import {TestKeyState} from 'src/types/types';
import {faceSize, LEGEND_FONT, legendBaseline} from 'src/utils/keycap-legend';
import type {KeyLabel} from 'src/utils/keyboard-rendering';
import * as THREE from 'three';
import {KeycapTooltip} from '../../inputs/tooltip';

const paintEncoder = (
  canvas: HTMLCanvasElement,
  [widthMultiplier, heightMultiplier]: [number, number],
  bgColor: string,
  fgColor: string,
) => {
  const dpi = 1;
  const canvasSize = 512 * dpi;
  const [canvasWidth, canvasHeight] = [
    canvasSize * widthMultiplier,
    canvasSize * heightMultiplier,
  ];
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  const workingAreaDivider = 2.6;
  if (context) {
    context.fillStyle = bgColor;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fill();

    context.fillStyle = fgColor;
    const rad = (0.4 * canvasWidth) / workingAreaDivider;
    context.ellipse(
      (0.5 * canvasWidth) / workingAreaDivider,
      (2.1 * canvasHeight) / workingAreaDivider,
      rad,
      rad,
      Math.PI / 4,
      0,
      2 * Math.PI,
    );
    context.fill();
  }
};

type Point = {
  x: number;
  y: number;
};

type Rect = {
  bl: Point;
  tr: Point;
};

const paintDebugLines = (
  canvas: HTMLCanvasElement,
  keycapRect: Rect,
  faceRect: Rect,
) => {
  const context = canvas.getContext('2d');
  if (context == null) {
    return;
  }
  context.strokeStyle = 'magenta';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(
    keycapRect.bl.x * canvas.width,
    (1 - keycapRect.bl.y) * canvas.height,
  );
  context.lineTo(
    keycapRect.bl.x * canvas.width,
    (1 - keycapRect.tr.y) * canvas.height,
  );
  context.lineTo(
    keycapRect.tr.x * canvas.width,
    (1 - keycapRect.tr.y) * canvas.height,
  );
  context.lineTo(
    keycapRect.tr.x * canvas.width,
    (1 - keycapRect.bl.y) * canvas.height,
  );
  context.lineTo(
    keycapRect.bl.x * canvas.width,
    (1 - keycapRect.bl.y) * canvas.height,
  );
  context.stroke();
  context.beginPath();
  context.moveTo(
    faceRect.bl.x * canvas.width,
    (1 - faceRect.bl.y) * canvas.height,
  );
  context.lineTo(
    faceRect.bl.x * canvas.width,
    (1 - faceRect.tr.y) * canvas.height,
  );
  context.lineTo(
    faceRect.tr.x * canvas.width,
    (1 - faceRect.tr.y) * canvas.height,
  );
  context.lineTo(
    faceRect.tr.x * canvas.width,
    (1 - faceRect.bl.y) * canvas.height,
  );
  context.lineTo(
    faceRect.bl.x * canvas.width,
    (1 - faceRect.bl.y) * canvas.height,
  );
  context.stroke();
};

const paintKeycapLabel = (
  canvas: HTMLCanvasElement,
  rect: Rect,
  legendColor: string,
  label: KeyLabel,
) => {
  const context = canvas.getContext('2d');
  if (context == null) {
    return;
  }

  // Define a clipping path for the top face, so text is not drawn on the side.
  context.beginPath();
  context.moveTo(rect.bl.x * canvas.width, (1 - rect.bl.y) * canvas.height);
  context.lineTo(rect.bl.x * canvas.width, (1 - rect.tr.y) * canvas.height);
  context.lineTo(rect.tr.x * canvas.width, (1 - rect.tr.y) * canvas.height);
  context.lineTo(rect.tr.x * canvas.width, (1 - rect.bl.y) * canvas.height);
  context.lineTo(rect.bl.x * canvas.width, (1 - rect.bl.y) * canvas.height);
  context.clip();

  context.fillStyle = legendColor;
  // The legend is laid out on the 2D keyboard's 1u face; it is drawn here at the
  // size this keyboard's 1u face has, so every key's legend has one scale.
  const left = rect.bl.x * canvas.width;
  const top = (1 - rect.tr.y) * canvas.height;
  // The face's height in the 2D keyboard's px, which lines are measured in.
  const height = ((rect.tr.y - rect.bl.y) * canvas.height) / LEGEND_SCALE;
  for (const line of label.lines) {
    context.font = `bold ${line.size * LEGEND_SCALE}px ${LEGEND_FONT}`;
    context.globalAlpha = line.opacity;
    context.fillText(
      line.text,
      left + line.x * LEGEND_SCALE,
      top + legendBaseline(line, height) * LEGEND_SCALE,
    );
  }
  context.globalAlpha = 1;
};

// coordinates of corners of keycap and top face in texture coordinates (UVs)
type TextureRects = {
  keycapRect: Rect;
  faceRect: Rect;
};

const calculateTextureRects = (
  widthMultiplier: number,
  heightMultiplier: number,
  textureWidth: number,
  textureHeight: number,
  textureOffsetX: number,
): TextureRects => {
  // Constants used in texture coordinate (UV) mapping
  // See update-uv-maps.ts
  const size1u = 1 / 2.6;
  const unitScale = 19.05;
  const offsetToCorner = 0.445;
  const gap = (offsetToCorner / unitScale) * size1u;

  // textureWidth,textureHeight is the size of the keycap in U
  // Clip this to 2.75U because the texture coordinates (UV)
  // only spans 2.6U, which is *just* enough to reach the right
  // edge of the top face of a 2.75U keycap.
  let keycapWidth = Math.min(2.75, textureWidth);
  let keycapHeight = Math.min(2.75, textureHeight);

  // If the model is a "stretched" 1U key,
  // pretend it's a 1U key, since the texture coordinates (UVs)
  // will be for a 1U key.
  if (widthMultiplier > 1 || heightMultiplier > 1) {
    keycapWidth = 1;
    keycapHeight = 1;
  }

  let keycapRect: Rect = {
    bl: {x: gap, y: gap},
    tr: {x: keycapWidth * size1u - gap, y: keycapHeight * size1u - gap},
  };

  let faceRect: Rect = {
    bl: {x: keycapRect.bl.x + 0.07, y: keycapRect.bl.y + 0.08},
    tr: {x: keycapRect.tr.x - 0.07, y: keycapRect.tr.y - 0.0146},
  };

  // textureOffsetX is the X offset in U from the left edge of the keycap shape
  // to the left edge of the narrower part of the keycap shape, when it's an ISO or BAE.
  // Multiplying by size1u converts it to an offset in TU
  // Add to the existing offset from keycap left edge to face left edge
  if (textureOffsetX > 0) {
    faceRect.bl.x += textureOffsetX * size1u;
    faceRect.tr.x += textureOffsetX * size1u;
    keycapRect.bl.x += textureOffsetX * size1u;
    keycapRect.tr.x += textureOffsetX * size1u;
  }

  return {keycapRect, faceRect};
};

// A 1u key's texture is this many px across.
const TEXTURE_SIZE = 512;
// The 3D face of a 1u key against the 2D one: the scale every legend is drawn at.
const LEGEND_SCALE = (() => {
  const {faceRect} = calculateTextureRects(1, 1, 1, 1, 0);
  return ((faceRect.tr.x - faceRect.bl.x) * TEXTURE_SIZE) / faceSize(1).width;
})();

const paintKeycap = (
  canvas: HTMLCanvasElement,
  [widthMultiplier, heightMultiplier]: [number, number],
  textureWidth: number,
  textureHeight: number,
  bgColor: string,
  legendColor: string,
  label: KeyLabel | undefined,
  textureOffsetX: number,
) => {
  const textureRects: TextureRects = calculateTextureRects(
    widthMultiplier,
    heightMultiplier,
    textureWidth,
    textureHeight,
    textureOffsetX,
  );

  canvas.width = TEXTURE_SIZE * widthMultiplier;
  canvas.height = TEXTURE_SIZE * heightMultiplier;

  const context = canvas.getContext('2d');
  if (context == null) {
    return;
  }

  // Fill the canvas with the keycap background color
  context.fillStyle = bgColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Leaving this here for future maintenance.
  // This draws lines around the keycap edge and the top face edge,
  // *or* a clipped area within it when keycaps are large, vertical or odd shapes.
  const debug = false;
  if (debug) {
    paintDebugLines(canvas, textureRects.keycapRect, textureRects.faceRect);
  }

  if (label) {
    paintKeycapLabel(canvas, textureRects.faceRect, legendColor, label);
  }
};

export const Keycap: React.FC<ThreeFiberKeycapProps> = React.memo((props) => {
  const {
    label,
    scale,
    color,
    onClick,
    selected,
    disabled,
    mode,
    rotation,
    keyState,
    shouldRotate,
    keycapGeometry,
    textureOffsetX,
    textureWidth,
    textureHeight,
    onPointerOver,
    onPointerDown,
    idx,
  } = props;
  const ref = useRef<any>();
  // Hold state for hovered and clicked events
  const [hovered, hover] = useState(false);
  // KEYMAP's corner describes the key under the pointer, as it does a key in the
  // keycode list.
  const {onHover} = props;
  useEffect(() => {
    if (!hovered || mode !== DisplayMode.Configure || !onHover) {
      return;
    }
    onHover(idx, true);
    return () => onHover(idx, false);
  }, [hovered, mode, idx, onHover]);
  const textureRef = useRef<THREE.CanvasTexture>();
  const canvasRef = useRef(document.createElement('canvas'));
  const redraw = React.useCallback(() => {
    if (canvasRef.current && color) {
      if (shouldRotate) {
        paintEncoder(canvasRef.current, [scale[0], scale[1]], color.c, color.t);
      } else {
        paintKeycap(
          canvasRef.current,
          [scale[0], scale[1]],
          textureWidth,
          textureHeight,
          color.c,
          color.t,
          label,
          textureOffsetX,
        );
      }
      textureRef.current!.needsUpdate = true;
    }
  }, [
    canvasRef.current,
    textureWidth,
    label && label.key,
    scale[0],
    scale[1],
    color && color.t,
    color && color.c,
    shouldRotate,
  ]);
  useEffect(redraw, [label && label.key, color && color.c, color && color.t]);

  const glow = useSpring({
    config: {duration: 800},
    from: {x: 0, y: '#f4a0a0'},
    loop: selected ? {reverse: true} : false,
    to: {x: 100, y: '#b49999'},
  });
  // Set Z to half the total height so that keycaps are at the same level since the center
  // is in the middle and each row has a different height
  let maxZ = keycapGeometry.boundingBox!.max.z;
  const [zDown, zUp] = [maxZ, maxZ + 8];
  const pressedState =
    DisplayMode.Test === mode
      ? TestKeyState.KeyDown === keyState
        ? KeycapState.Pressed
        : KeycapState.Unpressed
      : hovered || selected
      ? KeycapState.Unpressed
      : KeycapState.Pressed;
  const [keycapZ, rotationZ] =
    pressedState === KeycapState.Pressed
      ? [zDown, rotation[2]]
      : [zUp, rotation[2] + Math.PI * Number(shouldRotate)];
  const keyboardHover = mode === DisplayMode.Configure && hovered && !selected;
  const hoverGlow = useSpring({
    config: {duration: 500},
    from: {brightness: keyboardHover ? 0.75 : 1},
    to: {brightness: keyboardHover ? 1.25 : 1},
    reset: keyboardHover,
    immediate: !keyboardHover,
  });
  const hoverColor = hoverGlow.brightness.to((brightness) =>
    new THREE.Color('lightgrey').multiplyScalar(brightness).getStyle(),
  );
  const wasPressed = keyState === TestKeyState.KeyUp;
  const keycapColor =
    DisplayMode.Test === mode
      ? pressedState === KeycapState.Unpressed
        ? wasPressed
          ? 'palevioletred'
          : 'lightgrey'
        : 'pink'
      : pressedState === KeycapState.Unpressed
      ? 'lightgrey'
      : 'lightgrey';

  const {z, b, rotateZ, tooltipScale} = useSpring({
    config: {duration: mode === DisplayMode.Configure ? 200 : 100},
    z: keyboardHover ? zDown - 8 : keycapZ,
    b: keycapColor,
    rotateZ: rotationZ,
    tooltipScale: !hovered ? 0 : 1,
  });

  const [meshOnClick, meshOnPointerOver, meshOnPointerOut, meshOnPointerDown] =
    useMemo(() => {
      const noop = () => {};
      return disabled
        ? [noop, noop, noop, noop]
        : props.mode === DisplayMode.ConfigureColors
        ? [
            noop,
            (evt: ThreeEvent<MouseEvent>) => {
              if (onPointerOver) {
                onPointerOver(evt, idx);
              }
            },
            noop,
            (evt: ThreeEvent<MouseEvent>) => {
              if (onPointerDown) {
                onPointerDown(evt, idx);
              }
            },
          ]
        : [
            (evt: ThreeEvent<MouseEvent>) => onClick(evt, idx),
            (evt: ThreeEvent<MouseEvent>) => {
              if (onPointerOver) {
                onPointerOver(evt, idx);
              }
              hover(true);
            },
            () => hover(false),
            (evt: ThreeEvent<MouseEvent>) => {
              if (onPointerDown) {
                onPointerDown(evt, idx);
              }
            },
          ];
    }, [disabled, onClick, onPointerDown, onPointerOver, hover, idx, mode]);

  const AniMeshMaterial = animated.meshPhongMaterial as any;

  return (
    <>
      <animated.mesh
        {...props}
        ref={ref}
        position-z={z}
        rotation-z={rotateZ}
        onClick={meshOnClick}
        onPointerDown={meshOnPointerDown}
        onPointerOver={meshOnPointerOver}
        onPointerOut={meshOnPointerOut}
        geometry={keycapGeometry}
      >
        <AniMeshMaterial
          attach="material"
          color={selected ? glow.y : mode === DisplayMode.Configure ? hoverColor : b}
        >
          <canvasTexture
            ref={textureRef as any}
            attach="map"
            image={canvasRef.current}
          />
        </AniMeshMaterial>
      </animated.mesh>
      {/* Only a macro key has a tooltip, its macro, and only while it is under
          the pointer: one per key would be redrawn every frame. */}
      {hovered && label?.macro && (
        <React.Suspense fallback={null}>
          <animated.group
            position={props.position}
            position-z={20}
            scale={tooltipScale}
          >
            <Html
              transform
              style={{
                pointerEvents: 'none',
              }}
            >
              <KeycapTooltip>{label.macro}</KeycapTooltip>
            </Html>
          </animated.group>
        </React.Suspense>
      )}
    </>
  );
}, shallowEqual);
