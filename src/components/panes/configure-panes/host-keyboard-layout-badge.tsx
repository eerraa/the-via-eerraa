import {useState} from 'react';
import {faAngleDown} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import styled from 'styled-components';
import {
  BadgeContainer as Container,
  BadgeTitle as LayoutTitle,
  BadgeList,
  BadgeOption,
  BadgeClickCover as ClickCover,
} from '../../inputs/badge-dropdown';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getHostKeyboardLayout,
  updateHostKeyboardLayout,
} from 'src/store/settingsSlice';
import {keymapExtras} from 'src/utils/keymap-extras';

const LayoutList = styled(BadgeList)`
  width: 220px;
  overflow-y: auto;
  max-height: 400px;
`;

const LayoutButton = BadgeOption;

const layoutOptions = Object.entries(keymapExtras).map(([key, value]) => ({
  key,
  label: value.label,
}));

export const HostKeyboardLayoutBadge = () => {
  const dispatch = useAppDispatch();
  const hostKeyboardLayout = useAppSelector(getHostKeyboardLayout);
  const [showList, setShowList] = useState(false);

  const currentLabel =
    keymapExtras[hostKeyboardLayout]?.label ?? hostKeyboardLayout;

  return (
    <Container>
      <LayoutTitle onClick={() => setShowList(!showList)}>
        {currentLabel}

        <FontAwesomeIcon
          icon={faAngleDown}
          style={{
            transform: showList ? 'rotate(180deg)' : '',
            transition: 'transform 0.2s ease-out',
            marginLeft: '5px',
          }}
        />
      </LayoutTitle>

      {showList && <ClickCover onClick={() => setShowList(false)} />}

      <LayoutList $show={showList}>
        {layoutOptions.map(({key, label}) => (
          <LayoutButton
            key={key}
            $selected={key === hostKeyboardLayout}
            onClick={() => {
              dispatch(updateHostKeyboardLayout(key));
              setShowList(false);
            }}
          >
            {label}
          </LayoutButton>
        ))}
      </LayoutList>
    </Container>
  );
};