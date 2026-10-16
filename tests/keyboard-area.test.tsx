import './setup';
import {expect, test} from 'bun:test';
import {act, create} from 'react-test-renderer';
import {DisplayMode} from '../src/types/keyboard-rendering';

await import('../src/utils/keyboard-api');
const {useKeyboardAreaHeight, useReportKeyboardFrame, KeyboardAreaContext} =
  await import('../src/utils/keyboard-area');

test('changing or removing a keyboard releases its old frame', () => {
  const Frame = ({height}: {height: number}) => {
    useReportKeyboardFrame(DisplayMode.Configure, 5, height);
    return null;
  };
  const Reader = () => <output>{useKeyboardAreaHeight(500)}</output>;
  const App = ({height = 10, shown = true}) => (
    <>
      <Reader />
      <KeyboardAreaContext.Provider value={true}>
        {shown && <Frame height={height} />}
      </KeyboardAreaContext.Provider>
    </>
  );
  let renderer!: ReturnType<typeof create>;
  const value = () => Number(renderer.root.findByType('output').children[0]);
  try {
    act(() => {
      renderer = create(<App />);
    });
    const tall = value();
    act(() => renderer.update(<App height={3} />));
    const compact = value();
    expect(compact).toBeLessThan(tall);
    act(() => renderer.update(<App shown={false} />));
    const empty = value();
    expect(empty).toBeLessThan(compact);
    for (const height of [NaN, Infinity, -Infinity, 0, -1]) {
      act(() => renderer.update(<App height={height} />));
      expect(value()).toBe(empty);
    }
    act(() => renderer.update(<App />));
    expect(value()).toBe(tall);
  } finally {
    act(() => renderer.unmount());
  }
});
