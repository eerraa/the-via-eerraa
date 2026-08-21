import {useEffect, useRef} from 'react';
import {useLocation} from 'wouter';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getIsSelectedDeviceReady,
  getSelectedConnectedDevice,
} from 'src/store/devicesSlice';
import {
  setConfigureVisible,
  setDocumentHidden,
} from 'src/store/stateSyncSlice';
import {
  probeStateSyncForDevice,
  refreshAllDomains,
  syncPolling,
} from 'src/store/stateSyncThunks';
import {getSelectedStateSyncCapability} from 'src/store/stateSyncSlice';
import {loadEraAdvancedMetadata} from 'src/utils/era-advanced-metadata';

export const StateSyncRuntime = () => {
  const dispatch = useAppDispatch();
  const [location] = useLocation();
  const device = useAppSelector(getSelectedConnectedDevice);
  const ready = useAppSelector(getIsSelectedDeviceReady);
  const capability = useAppSelector(getSelectedStateSyncCapability);
  const hiddenRef = useRef(
    typeof document !== 'undefined' ? document.hidden : false,
  );

  useEffect(() => {
    void loadEraAdvancedMetadata();
  }, []);

  useEffect(() => {
    dispatch(setConfigureVisible(location === '/'));
    dispatch(syncPolling());
  }, [dispatch, location]);

  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.hidden;
      const wasHidden = hiddenRef.current;
      hiddenRef.current = hidden;
      dispatch(setDocumentHidden(hidden));
      if (wasHidden && !hidden && device && ready && capability === 'capable') {
        void dispatch(refreshAllDomains(device));
      }
      dispatch(syncPolling());
    };
    document.addEventListener('visibilitychange', onVisibility);
    dispatch(setDocumentHidden(document.hidden));
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [capability, device, dispatch, ready]);

  useEffect(() => {
    dispatch(syncPolling());
  }, [capability, device, dispatch, ready]);

  useEffect(() => {
    if (device && ready && capability === 'unknown') {
      void dispatch(probeStateSyncForDevice(device));
    }
  }, [capability, device, dispatch, ready]);

  return null;
};
