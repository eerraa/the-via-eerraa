import {FC, useState} from 'react';
import styled from 'styled-components';
import stringify from 'json-stringify-pretty-compact';
import {ErrorMessage, SuccessMessage} from '../../styled';
import {AccentUploadButton} from '../../inputs/accent-upload-button';
import {AccentButton} from '../../inputs/accent-button';
import {getByteForCode, getCodeForByte} from '../../../utils/key';
import deprecatedKeycodes from '../../../utils/key-to-byte/deprecated-keycodes';
import {title, component} from '../../icons/save';
import {CenterPane} from '../pane';
import {Detail, Label, ControlRow, SpanOverflowCell} from '../grid';
import {
  getBasicKeyToByte,
  getSelectedDefinition,
} from 'src/store/definitionsSlice';
import {getSelectedRawLayers} from 'src/store/keymapSlice';
import {collectDefinitionKeys} from 'src/utils/via-definition-keys';
import {normalizeLayoutMacros} from 'src/utils/layout-macros';
import type {StateSyncEncoderMap} from 'src/store/stateSyncCandidateActions';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
} from 'src/store/devicesSlice';
import {getExpressions} from 'src/store/macrosSlice';
import {useTranslation} from 'react-i18next';
import {getSelectedDefinitionName} from 'src/store/definitionNameSlice';
import {importLayoutToDevice} from 'src/store/importLayoutThunks';

type ViaSaveFile = {
  name: string;
  vendorProductId: number;
  layers: string[][];
  macros?: string[];
  encoders?: [string, string][][];
};

const isViaSaveFile = (obj: any): obj is ViaSaveFile =>
  obj && obj.name && obj.layers && obj.vendorProductId;

const SaveLoadPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

export const Pane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDefinitionName = useAppSelector(getSelectedDefinitionName);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const rawLayers = useAppSelector(getSelectedRawLayers);
  const macros = useAppSelector((state) => state.macros);
  const expressions = useAppSelector(getExpressions);
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);

  // TODO: improve typing so we can remove this
  if (!selectedDefinition || !selectedDevice || !api) {
    return null;
  }

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const getEncoderValues = async () => {
    const {layouts} = selectedDefinition;
    const encoders = collectDefinitionKeys({layouts})
      .filter((a) => 'ei' in a)
      .map((a) => a.ei as number);
    if (encoders.length > 0) {
      const maxEncoder = Math.max(...encoders) + 1;
      const numberOfLayers = rawLayers.length;
      const encoderValues = await Promise.all(
        Array(maxEncoder)
          .fill(0)
          .map((_, i) =>
            Promise.all(
              Array(numberOfLayers)
                .fill(0)
                .map((_, j) =>
                  Promise.all([
                    api.getEncoderValue(j, i, false),
                    api.getEncoderValue(j, i, true),
                  ]).then(
                    (a) =>
                      a.map(
                        (keyByte) =>
                          getCodeForByte(keyByte, basicKeyToByte, byteToKey) ||
                          '',
                      ) as [string, string],
                  ),
                ),
            ),
          ),
      );
      return encoderValues;
    } else {
      return [];
    }
  };

  const saveLayout = async () => {
    const {vendorProductId} = selectedDefinition;
    const name = selectedDefinitionName;
    const suggestedName =
      name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + '.layout.json';
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
      });
      const encoderValues = await getEncoderValues();
      const saveFile: ViaSaveFile = {
        name,
        vendorProductId,
        macros: normalizeLayoutMacros(expressions, macros.macroCount),
        layers: rawLayers.map(
          (layer: {keymap: number[]}) =>
            layer.keymap.map(
              (keyByte: number) =>
                getCodeForByte(keyByte, basicKeyToByte, byteToKey) || '',
            ), // TODO: should empty string be empty keycode instead?
        ),
        encoders: encoderValues,
      };

      const content = stringify(saveFile);
      const blob = new Blob([content], {type: 'application/json'});
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      console.log('User cancelled save file request');
    }

    /*
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = defaultFilename;

    link.click();
    URL.revokeObjectURL(url);
*/
  };

  const loadLayout = ([file]: Blob[]) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const reader = new FileReader();

    reader.onabort = () => setErrorMessage(t('File reading was cancelled.'));
    reader.onerror = () => setErrorMessage(t('Failed to read file.'));

    reader.onload = async () => {
      const saveFile = JSON.parse((reader as any).result.toString());
      if (!isViaSaveFile(saveFile)) {
        setErrorMessage(t('Could not load file: invalid data.'));
        return;
      }

      if (saveFile.vendorProductId !== selectedDefinition.vendorProductId) {
        setErrorMessage(
          t(
            'Could not import layout. This file was created for a different keyboard: {{name}}',
            {name: saveFile.name},
          ),
        );
        return;
      }

      if (
        saveFile.layers.findIndex(
          (layer, idx) => layer.length !== rawLayers[idx].keymap.length,
        ) > -1
      ) {
        setErrorMessage(
          t(
            'Could not import layout: incorrect number of keys in one or more layers.',
          ),
        );
        return;
      }

      if (macros.isFeatureSupported && saveFile.macros) {
        if (saveFile.macros.length !== macros.macroCount) {
          setErrorMessage(
            t('Could not import layout: incorrect number of macros.'),
          );
          return;
        }
      }

      const keymap: number[][] = saveFile.layers.map((layer) =>
        layer.map((key) =>
          getByteForCode(`${deprecatedKeycodes[key] ?? key}`, basicKeyToByte),
        ),
      );

      let encoderMap: StateSyncEncoderMap | undefined;
      if (saveFile.encoders) {
        encoderMap = {};
        saveFile.encoders.forEach((encoder, id) => {
          (encoderMap as StateSyncEncoderMap)[id] = encoder.map((layer) => {
            const counterclockwise = getByteForCode(
              `${deprecatedKeycodes[layer[0]] ?? layer[0]}`,
              basicKeyToByte,
            );
            const clockwise = getByteForCode(
              `${deprecatedKeycodes[layer[1]] ?? layer[1]}`,
              basicKeyToByte,
            );
            return [counterclockwise, clockwise] as [number, number];
          });
        });
      }

      try {
        await dispatch(
          importLayoutToDevice(selectedDevice, {
            keymap,
            macros:
              macros.isFeatureSupported && saveFile.macros
                ? saveFile.macros
                : undefined,
            encoders: encoderMap,
          }),
        );
      } catch (error) {
        console.warn('Loading layout failed', error);
        setErrorMessage(t('Failed to write the layout to the keyboard.'));
        return;
      }

      setSuccessMessage(t('Successfully updated layout!'));
    };

    reader.readAsBinaryString(file);
  };

  return (
    <SpanOverflowCell>
      <SaveLoadPane>
        <Container>
          <ControlRow>
            <Label>{t('Save Current Layout')}</Label>
            <Detail>
              <AccentButton onClick={saveLayout}>{t('Save')}</AccentButton>
            </Detail>
          </ControlRow>
          <ControlRow>
            <Label>{t('Load Saved Layout')}</Label>
            <Detail>
              <AccentUploadButton onLoad={loadLayout}>
                {t('Load')}
              </AccentUploadButton>
            </Detail>
          </ControlRow>
          {errorMessage ? <ErrorMessage>{errorMessage}</ErrorMessage> : null}
          {successMessage ? (
            <SuccessMessage>{successMessage}</SuccessMessage>
          ) : null}
        </Container>
      </SaveLoadPane>
    </SpanOverflowCell>
  );
};

export const Icon = component;
export const Title = title;
