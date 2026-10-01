import {useSpring} from '@react-spring/three';
import {PerspectiveCamera, useProgress} from '@react-three/drei';
import {useFrame, useThree} from '@react-three/fiber';
import React from 'react';
import {KEYBOARD_AREA_MAX_HEIGHT} from 'src/utils/keyboard-area';

const DEBUG = false;
const ZOOM = DEBUG ? 1 : 5.5 * 0.8;

// The zoom that draws the scene at the scale of the classic area, whatever the
// canvas height, so a shorter keyboard area keeps the keys' size.
export const getCameraZoom = (canvasHeight: number) =>
  canvasHeight > 0
    ? (ZOOM * KEYBOARD_AREA_MAX_HEIGHT) / canvasHeight
    : ZOOM;

export const Camera = () => {
  const {progress} = useProgress();
  const camera = useThree((state) => state.camera);
  const zoom = getCameraZoom(useThree((state) => state.size.height));
  const [startX, endX] = [7, 7];
  const glow = useSpring({
    config: {duration: 800},
    from: {x: startX},
  });

  React.useEffect(() => {
    if (progress === 100) {
      console.debug('lets animate');
      glow.x.start(endX);
    }
  }, [progress]);

  React.useEffect(() => {
    console.debug('mounting');
    return () => {
      console.debug('unmounting');
    };
  }, []);
  useFrame(() => {
    if (glow.x.isAnimating) {
      camera.position.setZ(glow.x.get());
      camera.position.setY(0.4 * Math.pow(glow.x.get() - endX, 1));
      camera.updateProjectionMatrix();
    }
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
  });
  return <PerspectiveCamera position-z={startX} makeDefault fov={25} />;
};
