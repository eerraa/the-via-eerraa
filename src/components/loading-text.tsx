import styled from 'styled-components';
import {useTranslation} from 'react-i18next';

const LoadingText = styled.div`
  font-size: 30px;
  color: var(--color_label-highlighted);
`;

enum LoadingLabel {
  Searching = 'Searching for devices...',
  Loading = 'Loading...',
  Reconnect = 'Reconnect the keyboard',
}

type Props = {
  isSearching: boolean;
  needsReconnect?: boolean;
};

export default function (props: Props) {
  const {t} = useTranslation();
  const label = props.needsReconnect
    ? LoadingLabel.Reconnect
    : props.isSearching
      ? LoadingLabel.Searching
      : LoadingLabel.Loading;
  return <LoadingText data-tid="loading-message">{t(label)}</LoadingText>;
}
