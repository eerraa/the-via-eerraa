import React, {useMemo} from 'react';
import styled from 'styled-components';
import {Link, useLocation} from 'wouter';
import PANES from '../../utils/pane-config';
import {useAppSelector} from 'src/store/hooks';
import {getShowConsoleTab, getShowDesignTab} from 'src/store/settingsSlice';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {CategoryMenuTooltip} from '../inputs/tooltip';
import {CategoryIconContainer} from '../panes/grid';
import {ErrorLink, ErrorsPaneConfig} from '../panes/errors';
import {ExternalLinks} from './external-links';
import {useTranslation} from 'react-i18next';

const Container = styled.div`
  width: 100vw;
  height: 25px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border_color_cell);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const {DEBUG_PROD, MODE, DEV} = import.meta.env;
const showDebugPane = MODE === 'development' || DEBUG_PROD === 'true' || DEV;

const GlobalContainer = styled(Container)`
  flex: none;
  background: var(--bg_outside-accent);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: minmax(0, 1fr);
  column-gap: 20px;

  @media (max-width: 720px) {
    box-sizing: border-box;
    display: flex;
    flex-wrap: wrap;
    height: auto;
    gap: 8px 16px;
    padding: 8px;
  }
`;

// The two outer tracks balance when space permits. The right track's intrinsic
// width moves this group left on narrow windows, including its error warning.
const PaneIcons = styled.div`
  grid-column: 2;
  display: flex;
  align-items: center;
  column-gap: 20px;

  @media (max-width: 720px) {
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
`;

/**
 * Without WebHID there is nothing to configure, but firmware downloads still
 * work, so the header keeps only language selection and the firmware entry.
 */
export const DownloadOnlyGlobalMenu = () => (
  <GlobalContainer>
    <ExternalLinks />
  </GlobalContainer>
);

export const UnconnectedGlobalMenu = () => {
  const {t, i18n} = useTranslation();
  const showDesignTab = useAppSelector(getShowDesignTab);
  const showConsoleTab = useAppSelector(getShowConsoleTab);

  const [location] = useLocation();

  const Panes = useMemo(() => {
    return PANES.filter((pane) => pane.key !== ErrorsPaneConfig.key).map(
      (pane) => {
        if (pane.key === 'design' && !showDesignTab) return null;
        if (pane.key === 'console' && !showConsoleTab) return null;
        if (pane.key === 'debug' && !showDebugPane) return null;
        const selected = pane.path === location;
        return (
          <Link key={pane.key} to={pane.path}>
            <CategoryIconContainer
              as="a"
              $selected={selected}
              aria-label={t(pane.title)}
              aria-current={selected ? 'page' : undefined}
            >
              <FontAwesomeIcon size={'xl'} icon={pane.icon} />
              <CategoryMenuTooltip>{t(pane.title)}</CategoryMenuTooltip>
            </CategoryIconContainer>
          </Link>
        );
      },
    );
  }, [location, showConsoleTab, showDesignTab, t]);

  return (
    <React.Fragment>
      <GlobalContainer>
        <PaneIcons>
          <ErrorLink />
          {Panes}
        </PaneIcons>
        <ExternalLinks />
      </GlobalContainer>
    </React.Fragment>
  );
};
