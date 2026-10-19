import {useLayoutEffect, useRef} from 'react';

export const globalMenuHeight = 'var(--global-menu-height, 50px)';

/** Absolute keyboard controls share the header's actual border-box height. */
export const useGlobalMenuHeight = () => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const style = document.documentElement.style;
    const measure = () => {
      style.setProperty(
        '--global-menu-height',
        `${element.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      style.removeProperty('--global-menu-height');
    };
  }, []);
  return ref;
};
