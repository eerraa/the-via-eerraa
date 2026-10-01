import {
  DownloadOnlyGlobalMenu,
  UnconnectedGlobalMenu,
} from './components/menus/global';
import {FirmwarePane} from './components/panes/firmware';
import {getPageTitle, isFirmwarePath} from './utils/firmware-route';
import {Redirect, Route} from 'wouter';
import PANES from './utils/pane-config';
import {Home} from './components/Home';
import {createGlobalStyle} from 'styled-components';
import {CanvasRouter as CanvasRouter3D} from './components/three-fiber/canvas-router';
import {CanvasRouter as CanvasRouter2D} from './components/two-string/canvas-router';
import {initialTestContext, TestContext} from './components/panes/test';
import {useEffect, useMemo, useState} from 'react';
import {OVERRIDE_HID_CHECK} from './utils/override';
import {useAppSelector} from './store/hooks';
import {getRenderMode, getShowConsoleTab} from './store/settingsSlice';
import {useLocation} from 'wouter';
import {HIDConsoleRoute} from './components/panes/hid-console';

const GlobalStyle = createGlobalStyle`
  *:focus {
    outline: none;
  }
`;

export default () => {
  const hasHIDSupport = 'hid' in navigator || OVERRIDE_HID_CHECK;

  const renderMode = useAppSelector(getRenderMode);
  const showConsoleTab = useAppSelector(getShowConsoleTab);
  const [location] = useLocation();
  useEffect(() => {
    document.title = getPageTitle(location);
  }, [location]);
  const RouteComponents = useMemo(
    () =>
      PANES.filter((pane) => pane.key !== 'console').map((pane) => {
        return (
          <Route component={pane.component} key={pane.key} path={pane.path} />
        );
      }),
    [],
  );

  const CanvasRouter = renderMode === '2D' ? CanvasRouter2D : CanvasRouter3D;
  const testContextState = useState(initialTestContext);
  const firmwareRoute = isFirmwarePath(location);
  // Firmware downloads are the one thing a browser without WebHID (a phone, a
  // download-only browser) can still use, so that route bypasses the HID gate.
  // With WebHID, Home stays mounted on every route: it owns device loading and
  // State Sync, which must not restart when the user opens the firmware page.
  const firmwareWithoutHID = !hasHIDSupport && firmwareRoute;
  return (
    <>
        <TestContext.Provider value={testContextState}>
          <GlobalStyle />
          {hasHIDSupport ? <UnconnectedGlobalMenu /> : <DownloadOnlyGlobalMenu />}
          {!firmwareWithoutHID && <CanvasRouter />}

          {firmwareWithoutHID ? (
            <FirmwarePane />
          ) : (
            <Home hasHIDSupport={hasHIDSupport}>
              {RouteComponents}
              {firmwareRoute && <FirmwarePane />}
              {/* USB Diagnostics moved into CONFIGURE > SYSTEM > USB POLLING, next to
                  the polling-mode controls it measures. An open tab or bookmark on the
                  removed page would otherwise render nothing at all. */}
              <Route path="/diagnostics">
                <Redirect to="/" />
              </Route>
              <HIDConsoleRoute shown={showConsoleTab} location={location} />
            </Home>
          )}
        </TestContext.Provider>
    </>
  );
};
