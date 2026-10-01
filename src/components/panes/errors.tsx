import {IconProp} from '@fortawesome/fontawesome-svg-core';
import {
  faCancel,
  faComputer,
  faDownload,
  faKeyboard,
  faWarning,
} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {PropsWithChildren, useState} from 'react';
import {useDispatch} from 'react-redux';
import {AppError, clearAppErrors, getAppErrors} from 'src/store/errorsSlice';
import {useAppSelector} from 'src/store/hooks';
import {DeviceInfo} from 'src/types/types';
import {formatNumberAsHex} from 'src/utils/format';
import styled from 'styled-components';
import {Link, useLocation} from 'wouter';
import {IconButtonContainer} from '../inputs/icon-button';
import {
  CategoryMenuTooltip,
  IconButtonTooltip,
  MenuTooltip,
} from '../inputs/tooltip';
import {MenuContainer} from './configure-panes/custom/menu-generator';
import {
  ControlRow,
  Grid,
  Label,
  MenuCell,
  Row,
  IconContainer,
  SpanOverflowCell,
  CategoryIconContainer,
} from './grid';
import {Pane} from './pane';
import { useTranslation } from 'react-i18next';

const ErrorList = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 12px;
  user-select: text;
`;

const ErrorRow = styled(ControlRow)`
  align-items: center;
  gap: 16px;
`;

const ErrorDetail = styled.span`
  display: flex;
  gap: 16px;
  color: var(--color_label);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

// The logged time carries milliseconds for the file; the screen needs seconds.
const toSeconds = (timestamp: string) => timestamp.replace(/\.\d+$/, '');

const printId = (id: number) => formatNumberAsHex(id, 4);

const ErrorListContainer: React.FC<
  PropsWithChildren<{
    clear: () => void;
    save: () => void;
    hasErrors: boolean;
  }>
> = (props) => {
  const {t} = useTranslation();
  const {clear, save, hasErrors} = props;
  return (
    <>
      <IconButtonGroupContainer style={{margin: '10px 15px'}}>
        <IconButtonContainer onClick={clear} disabled={!hasErrors}>
          <FontAwesomeIcon
            size={'sm'}
            color="var(--color_label)"
            icon={faCancel}
          />
          <IconButtonTooltip>{t('Clear')}</IconButtonTooltip>
        </IconButtonContainer>
        <IconButtonContainer onClick={save} disabled={!hasErrors}>
          <FontAwesomeIcon
            size={'sm'}
            color="var(--color_label)"
            icon={faDownload}
          />
          <IconButtonTooltip>{t('Download')}</IconButtonTooltip>
        </IconButtonContainer>
      </IconButtonGroupContainer>
      {props.children}
    </>
  );
};

const AppErrors: React.FC<{}> = ({}) => {
  const {t} = useTranslation();
  const errors = useAppSelector(getAppErrors);
  const dispatch = useDispatch();
  return (
    <ErrorListContainer
      clear={() => dispatch(clearAppErrors())}
      save={() => saveAppErrors(errors)}
      hasErrors={!!errors.length}
    >
      {/* A name in the user's words, the keyboard and the time. Everything
          else is for whoever reads the downloaded file. */}
      <ErrorList>
        {errors.map(({id, timestamp, deviceInfo: {productName}, title}) => (
          <ErrorRow key={id}>
            <Label>{t(title)}</Label>
            <ErrorDetail>
              {productName && <span>{productName}</span>}
              <span>{toSeconds(timestamp)}</span>
            </ErrorDetail>
          </ErrorRow>
        ))}
      </ErrorList>
    </ErrorListContainer>
  );
};

async function saveErrors<T>(
  errors: T[],
  headers: Array<keyof (T & DeviceInfo)>,
  fileName: string,
  printRow: (error: T) => string,
) {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `${fileName}.csv`,
    });
    const csvHeaders = [headers.join(', ')];
    const data = errors.map(printRow);
    const csv = csvHeaders.concat(...data).join('\n');
    const blob = new Blob([csv], {type: 'text/csv'});
    const writeable = await handle.createWritable();
    await writeable.write(blob);
    await writeable.close();
  } catch (err) {
    console.log('User cancelled save errors request');
  }
}

export const saveAppErrors = async (errors: AppError[]) =>
  saveErrors(
    errors,
    [
      'timestamp',
      'productName',
      'vendorId',
      'productId',
      'protocol',
      'message',
    ],
    'VIA-app-errors',
    ({
      timestamp,
      deviceInfo: {productName, vendorId, productId, protocol},
      message,
    }) =>
      `${timestamp}, ${productName}, ${printId(vendorId)}, ${printId(
        productId,
      )}, ${protocol ?? ''}, "${message}"`,
  );

const IconButtonGroupContainer = styled.div`
  border-radius: 2px;
  border: 1px solid var(--border_color_icon);
  display: inline-flex;
  > button:last-child {
    border: none;
  }
`;

enum ErrorPaneMenu {
  KeyboardAPI,
  App,
}

const ErrorPanes: [ErrorPaneMenu, React.FC, IconProp, string][] = [
  [ErrorPaneMenu.App, AppErrors, faComputer, 'App'],
];

export const Errors = () => {
  const {t} = useTranslation();
  const [selectedPane, setSelectedPane] = useState(ErrorPaneMenu.App);
  const PaneComponent = (ErrorPanes.find(([id]) => selectedPane === id) ||
    ErrorPanes[0])[1];
  return (
    <Pane>
      <Grid style={{overflow: 'hidden'}}>
        <MenuCell style={{pointerEvents: 'all', borderTop: 'none'}}>
          <MenuContainer>
            {ErrorPanes.map(([id, _, Icon, menuName]) => (
              <Row
                $selected={selectedPane === id}
                $static={ErrorPanes.length === 1}
                onClick={() => {
                  setSelectedPane(id);
                }}
                key={id}
              >
                <IconContainer>
                  <FontAwesomeIcon icon={Icon} />
                  <MenuTooltip>{t(menuName)}</MenuTooltip>
                </IconContainer>
              </Row>
            ))}
          </MenuContainer>
        </MenuCell>
        <SpanOverflowCell style={{flex: 1, borderWidth: 0}}>
          <PaneComponent />
        </SpanOverflowCell>
      </Grid>
    </Pane>
  );
};

export const ErrorLink = () => {
  const {t} = useTranslation();
  const appErrors = useAppSelector(getAppErrors);
  const [location] = useLocation();
  const isSelectedRoute = location === '/errors';
  if (appErrors.length) {
    const label = t('{{count}} errors', {count: appErrors.length});
    return (
      <Link to="/errors">
        <CategoryIconContainer
          as="a"
          $selected={isSelectedRoute}
          aria-label={label}
          aria-current={isSelectedRoute ? 'page' : undefined}
        >
          <FontAwesomeIcon
            size={'xl'}
            icon={ErrorsPaneConfig.icon}
            color={isSelectedRoute ? 'inherit' : 'gold'}
          />
          <CategoryMenuTooltip>{label}</CategoryMenuTooltip>
        </CategoryIconContainer>
      </Link>
    );
  }

  return null;
};

export const ErrorsPaneConfig = {
  component: Errors,
  path: '/errors',
  icon: faWarning,
  key: 'errors',
  title: 'Errors',
};
