import React, {createRef, useEffect} from 'react';
import styled from 'styled-components';
import {getByteForCode} from '../utils/key';
import {isEraVIADefinitionV3} from '../utils/era-definition';
import {startMonitoring, usbDetect} from '../utils/usb-hid';
import {
  getLightingDefinition,
  isVIADefinitionV2,
  LightingValue,
} from '@the-via/reader';
import {
  dismissInvalidProtocolDevice,
  dismissUnresolvedDefinitionDevice,
  getConnectedDevices,
  getInvalidProtocolDeviceWarning,
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
  getUnresolvedDefinitionDeviceWarning,
  invalidateDeviceConnection,
} from 'src/store/devicesSlice';
import {
  loadSupportedIds,
  reloadConnectedDevices,
} from 'src/store/devicesThunks';
import {getDisableFastRemap, setShowDesignTab} from '../store/settingsSlice';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedKey,
  getSelectedLayerIndex,
  updateSelectedKey as updateSelectedKeyAction,
} from 'src/store/keymapSlice';
import {
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {
  APP_ERROR_TITLES,
  extractDeviceInfo,
  getMessageFromError,
  logAppError,
} from 'src/store/errorsSlice';
import {handleUISyncRequest} from 'src/store/stateSyncThunks';
import {OVERRIDE_HID_CHECK} from 'src/utils/override';
import {KeyboardAPI, KeyboardValue} from 'src/utils/keyboard-api';
import {Trans, useTranslation} from 'react-i18next';
import {focusRing} from './inputs/accent-button';
import {MessageDialog} from './inputs/message-dialog';
import {hideDesignWarningThisSession} from './panes/design';
import {formatNumberAsHex} from 'src/utils/format';
import {addHIDTransportGenerationListener} from 'src/shims/node-hid';
import {StateSyncRuntime} from './state-sync-runtime';
import {failContinuousHIDTransactionsForPath} from 'src/utils/continuous-hid-transaction';
import {useLocation} from 'wouter';

const ErrorHome = styled.div`
  background: var(--bg_gradient);
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  height: 100%;
  overflow: hidden;
  height: auto;
  left: 0;
  right: 0;
  bottom: 0;
  padding-top: 24px;
  position: absolute;
  border-top: 1px solid var(--border_color_cell);
`;

const UsbError = styled.div`
  align-items: center;
  display: flex;
  color: var(--color_label);
  flex-direction: column;
  height: 100%;
  justify-content: center;
  margin: 0 auto;
  max-width: 650px;
  text-align: center;
`;

const UsbErrorHeading = styled.h1`
  margin: 1rem 0 0;
`;

const UsbErrorWebHIDLink = styled.a`
  text-decoration: underline;
  color: var(--color_label-highlighted);
  ${focusRing}

  &:hover {
    color: var(--color_accent);
  }
`;

const timeoutRepeater =
  (fn: () => void, timeout: number, numToRepeat = 0) =>
  () =>
    setTimeout(() => {
      fn();
      if (numToRepeat > 0) {
        timeoutRepeater(fn, timeout, numToRepeat - 1)();
      }
    }, timeout);

type RouteErrorBoundaryProps = {
  location: string;
  onError: (error: unknown) => void;
  children?: React.ReactNode;
};

type RouteErrorBoundaryState = {failed: boolean; location: string};

// Without a boundary a render error unmounts the whole app, header, /errors and
// /firmware included. The failed route stays empty until the location changes;
// the logged error lights the header's warning link.
class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    failed: false,
    location: this.props.location,
  };

  static getDerivedStateFromError(): Partial<RouteErrorBoundaryState> {
    return {failed: true};
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    return props.location === state.location
      ? null
      : {failed: false, location: props.location};
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface HomeProps {
  children?: React.ReactNode;
  hasHIDSupport: boolean;
}

export const Home: React.FC<HomeProps> = (props) => {
  const {t} = useTranslation();
  const {hasHIDSupport} = props;

  const dispatch = useAppDispatch();
  const selectedKey = useAppSelector(getSelectedKey);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const connectedDevices = useAppSelector(getConnectedDevices);
  const invalidProtocolDevice = useAppSelector(getInvalidProtocolDeviceWarning);
  const unresolvedDefinitionDevice = useAppSelector(
    getUnresolvedDefinitionDeviceWarning,
  );
  const selectedLayerIndex = useAppSelector(getSelectedLayerIndex);
  const selectedKeyDefinitions = useAppSelector(getSelectedKeyDefinitions);
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const [location, setLocation] = useLocation();

  const logRouteError = (error: unknown) =>
    dispatch(
      logAppError({
        message:
          error instanceof Error ? getMessageFromError(error) : String(error),
        deviceInfo: selectedDevice
          ? extractDeviceInfo(selectedDevice)
          : {vendorId: 0, productId: 0, productName: ''},
        title: APP_ERROR_TITLES.screen,
      }),
    );

  const updateDevicesRepeat: () => void = timeoutRepeater(
    () => {
      dispatch(reloadConnectedDevices());
    },
    500,
    1,
  );

  const toggleLights = async () => {
    if (!api || !selectedDefinition) {
      return;
    }

    const delay = 200;

    if (
      isVIADefinitionV2(selectedDefinition) &&
      getLightingDefinition(
        selectedDefinition.lighting,
      ).supportedLightingValues.includes(LightingValue.BACKLIGHT_EFFECT)
    ) {
      const val = await api.getRGBMode();
      const newVal = val !== 0 ? 0 : 1;
      for (let i = 0; i < 3; i++) {
        api.timeout(i === 0 ? 0 : delay);
        api.setRGBMode(newVal);
        api.timeout(delay);
        await api.setRGBMode(val);
      }
    }

    if (isEraVIADefinitionV3(selectedDefinition)) {
      for (let i = 0; i < 6; i++) {
        api.timeout(i === 0 ? 0 : delay);
        await api.setKeyboardValue(KeyboardValue.DEVICE_INDICATION, i);
      }
    }
  };

  const homeElem = createRef<HTMLDivElement>();

  useEffect(() => {
    if (!hasHIDSupport) {
      return;
    }

    if (homeElem.current) {
      homeElem.current.focus();
    }

    startMonitoring();
    const removeGenerationListener = addHIDTransportGenerationListener(
      ({path, generation, poisoned}) => {
        failContinuousHIDTransactionsForPath(
          path,
          generation,
          'Connection generation changed during a continuous HID transaction',
        );
        dispatch(
          invalidateDeviceConnection({
            devicePath: path,
            connectionGeneration: generation,
            locked: poisoned,
          }),
        );
      },
    );
    usbDetect.on('change', updateDevicesRepeat);
    dispatch(loadSupportedIds());

    return () => {
      // Cleanup function equiv to componentWillUnmount
      usbDetect.off('change', updateDevicesRepeat);
      removeGenerationListener();
    };
  }, []); // Passing an empty array as the second arg makes the body of the function equiv to componentDidMount (not including the cleanup func)

  useEffect(() => {
    dispatch(updateSelectedKeyAction(null));

    // Only trigger flashing lights when multiple devices are connected
    // if (Object.values(connectedDevices).length > 1) {
    //   toggleLights();
    // }
  }, [api]);

  useEffect(() => {
    const removeHandlers = Object.keys(connectedDevices).map((devicePath) => {
      const deviceAPI = new KeyboardAPI(devicePath);
      const connectionGeneration = deviceAPI.getConnectionGeneration();
      return deviceAPI.addUISyncRequestHandler((request) => {
        dispatch(
          handleUISyncRequest({
            devicePath,
            connectionGeneration,
            request,
          }),
        );
      });
    });

    return () => removeHandlers.forEach((removeHandler) => removeHandler());
  }, [connectedDevices, dispatch]);

  return !hasHIDSupport && !OVERRIDE_HID_CHECK ? (
    <ErrorHome ref={homeElem} tabIndex={0}>
      <UsbError>
        <UsbErrorHeading>{t('USB Detection Error')}</UsbErrorHeading>
        <p>
          <Trans
            i18nKey="Keyboards can't be configured in <0>this browser</0>."
            components={[
              <UsbErrorWebHIDLink
                href="https://caniuse.com/?search=webhid"
                target="_blank"
                rel="noreferrer"
              />,
            ]}
          />
        </p>
      </UsbError>
    </ErrorHome>
  ) : (
    <>
      {invalidProtocolDevice && (
        <MessageDialog
          isOpen={true}
          confirmLabel="OK"
          onConfirm={() => {
            dispatch(dismissInvalidProtocolDevice(invalidProtocolDevice));
          }}
        >
          {t(
            "VIA can see {{deviceName}} through WebHID.\nVID: {{vid}} | PID: {{pid}}\n\n{{deviceName}} does not seem to respond like a VIA-enabled keyboard.\n\nIf {{deviceName}} should support VIA, make sure it is running VIA-compatible firmware.\nIf it is, authorization and/or initialization procedures may have failed—unplug the keyboard, reconnect it, and try again.\nIf the problem persists, please contact your keyboard's manufacturer or vendor for assistance.",
            {
              deviceName: invalidProtocolDevice.productName || t('this device'),
              vid: formatNumberAsHex(invalidProtocolDevice.vendorId, 4),
              pid: formatNumberAsHex(invalidProtocolDevice.productId, 4),
            },
          )}
        </MessageDialog>
      )}
      {!invalidProtocolDevice && unresolvedDefinitionDevice && (
        <MessageDialog
          isOpen={true}
          confirmLabel="OK"
          onConfirm={() => {
            dispatch(
              dismissUnresolvedDefinitionDevice(unresolvedDefinitionDevice),
            );
          }}
          secondaryLabel="Upload"
          onSecondary={() => {
            // The Design tab is hidden by default; its warning would only ask
            // again what this click already answered.
            dispatch(setShowDesignTab(true));
            dispatch(
              dismissUnresolvedDefinitionDevice(unresolvedDefinitionDevice),
            );
            hideDesignWarningThisSession();
            setLocation('/design');
          }}
        >
          {t(
            "VIA could not find a {{definitionVersion}} definition for {{deviceName}}.\nVID: {{vid}} | PID: {{pid}}\n\nThis means that:\n- this keyboard is not officially supported through the remote definition database\n- the definition file of the keyboard has not been sideloaded through the Design tab\n\nPlease contact your keyboard's manufacturer or vendor to add it to the database, or upload the JSON definition provided by your keyboard's manufacturer or vendor in the Design tab.",
            {
              definitionVersion:
                unresolvedDefinitionDevice.requiredDefinitionVersion.toUpperCase(),
              deviceName:
                unresolvedDefinitionDevice.productName || t('this keyboard'),
              vid: formatNumberAsHex(unresolvedDefinitionDevice.vendorId, 4),
              pid: formatNumberAsHex(unresolvedDefinitionDevice.productId, 4),
            },
          )}
        </MessageDialog>
      )}
      <StateSyncRuntime />
      <RouteErrorBoundary location={location} onError={logRouteError}>
        {props.children}
      </RouteErrorBoundary>
    </>
  );
};
