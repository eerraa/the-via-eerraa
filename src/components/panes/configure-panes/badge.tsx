import React, {useMemo, useState} from 'react';
import styled from 'styled-components';
import {
  BadgeContainer as Container,
  BadgeTitle as KeyboardTitle,
  BadgeList,
  BadgeOption,
  BadgeClickCover as ClickCover,
} from '../../inputs/badge-dropdown';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faAngleDown, faPlus} from '@fortawesome/free-solid-svg-icons';
import {HID} from '../../../shims/node-hid';
import type {VIADefinitionV2, VIADefinitionV3} from '@the-via/reader';
import type {ConnectedDevice} from '../../../types/types';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getDefinitions,
  getSelectedDefinition,
} from 'src/store/definitionsSlice';
import {
  getConnectedDevices,
  getSelectedDevicePath,
} from 'src/store/devicesSlice';
import {selectConnectedDeviceByPath} from 'src/store/devicesThunks';
import {isElectron} from 'src/utils/running-context';
import {useTranslation} from 'react-i18next';
import {
  getConnectedDefinitionNames,
  getSelectedDefinitionName,
} from 'src/store/definitionNameSlice';

const KeyboardList = styled(BadgeList)`
  width: 160px;
  overflow: hidden;
`;

const KeyboardButton = styled(BadgeOption)`
  text-transform: uppercase;
`;

type ConnectedKeyboardDefinition = [
  string,
  VIADefinitionV2 | VIADefinitionV3,
  string,
];

const KeyboardSelectors: React.FC<{
  show: boolean;
  keyboards: ConnectedKeyboardDefinition[];
  selectedPath: string;
  onClickOut: () => void;
  selectKeyboard: (kb: string) => void;
}> = (props) => {
  const {t} = useTranslation();

  const requestAndChangeDevice = async () => {
    const device = await HID.requestDevice();

    if (device) {
      props.selectKeyboard((device as any).__path);
    }
  };

  return (
    <>
      {props.show && <ClickCover onClick={props.onClickOut} />}

      <KeyboardList $show={props.show}>
        {props.keyboards.map(([path, , name]) => {
          return (
            <KeyboardButton
              $selected={path === props.selectedPath}
              key={path}
              onClick={() => props.selectKeyboard(path as string)}
            >
              {name}
            </KeyboardButton>
          );
        })}

        {!isElectron && (
          <KeyboardButton onClick={requestAndChangeDevice}>
            {t('Authorize New')}
            <FontAwesomeIcon icon={faPlus} style={{marginLeft: '10px'}} />
          </KeyboardButton>
        )}
      </KeyboardList>
    </>
  );
};

export const Badge = () => {
  const dispatch = useAppDispatch();
  const definitions = useAppSelector(getDefinitions);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDefinitionName = useAppSelector(getSelectedDefinitionName);
  const getConnectedDefinitionName = useAppSelector(
    getConnectedDefinitionNames,
  );
  const connectedDevices = useAppSelector(getConnectedDevices);
  const selectedPath = useAppSelector(getSelectedDevicePath);
  const [showList, setShowList] = useState(false);

  const connectedKeyboardDefinitions: ConnectedKeyboardDefinition[] = useMemo(
    () =>
      Object.entries(connectedDevices)
        .map<ConnectedKeyboardDefinition>(([path, device]) => {
          const connectedDevice = device as ConnectedDevice;

          return [
            path,
            definitions[connectedDevice.vendorProductId] &&
              definitions[connectedDevice.vendorProductId][
                connectedDevice.requiredDefinitionVersion
              ],
            getConnectedDefinitionName(connectedDevice),
          ];
        })
        .filter((i) => i[1]),
    [connectedDevices, definitions, getConnectedDefinitionName],
  );

  if (!selectedDefinition || !selectedPath) {
    return null;
  }

  return (
    <Container>
      <KeyboardTitle onClick={() => setShowList(!showList)}>
        {selectedDefinitionName}

        <FontAwesomeIcon
          icon={faAngleDown}
          style={{
            transform: showList ? 'rotate(180deg)' : '',
            transition: 'transform 0.2s ease-out',
            marginLeft: '5px',
          }}
        />
      </KeyboardTitle>

      <KeyboardSelectors
        show={showList}
        selectedPath={selectedPath}
        keyboards={connectedKeyboardDefinitions}
        onClickOut={() => setShowList(false)}
        selectKeyboard={(path) => {
          dispatch(selectConnectedDeviceByPath(path));
          setShowList(false);
        }}
      />
    </Container>
  );
};