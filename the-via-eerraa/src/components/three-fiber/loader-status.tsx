import {faSpinner, faUnlock} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useTranslation} from 'react-i18next';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {getSelectedConnectionLocked} from 'src/store/devicesSlice';
import {reloadConnectedDevices} from 'src/store/devicesThunks';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {AccentButtonLarge} from '../inputs/accent-button';
import LoadingText from '../loading-text';

type LoaderStatusProps = {
  hasDefinition: boolean;
  locked: boolean;
  onAuthorize: () => void;
};

export const useLoaderStatus = (): LoaderStatusProps => {
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const connectionLocked = useAppSelector(getSelectedConnectionLocked);
  return {
    hasDefinition: !!selectedDefinition,
    locked: connectionLocked,
    onAuthorize: () => dispatch(reloadConnectedDevices({authorize: true})),
  };
};

// drei's Html renders this in a React root of its own, outside the Redux
// Provider, so the canvas reads the store with useLoaderStatus instead.
export const LoaderStatus = ({
  hasDefinition,
  locked,
  onAuthorize,
}: LoaderStatusProps) => {
  const {t} = useTranslation();
  // Authorizing the same keyboard again cannot unlock it; unplugging it can.
  if (locked) {
    return <LoadingText isSearching={!hasDefinition} needsReconnect />;
  }
  return !hasDefinition ? (
    <AccentButtonLarge onClick={onAuthorize} style={{width: 'max-content'}}>
      {t('Authorize device')}
      <FontAwesomeIcon style={{marginLeft: '10px'}} icon={faUnlock} />
    </AccentButtonLarge>
  ) : (
    <div
      style={{
        textAlign: 'center',
        color: 'var(--color_accent)',
        fontSize: 60,
      }}
    >
      <FontAwesomeIcon spinPulse icon={faSpinner} />
    </div>
  );
};
