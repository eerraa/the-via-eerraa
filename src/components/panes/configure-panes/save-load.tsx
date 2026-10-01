import {FC, useState} from 'react';
import styled from 'styled-components';
import stringify from 'json-stringify-pretty-compact';
import {ErrorMessage, Message, SuccessMessage} from '../../styled';
import {AccentUploadButton} from '../../inputs/accent-upload-button';
import {AccentButton} from '../../inputs/accent-button';
import {title, component} from '../../icons/save';
import {CenterPane} from '../pane';
import {Detail, Label, ControlRow} from '../grid';
import {
  SubmenuTab,
  SubmenuTabBar,
  TabbedBody,
  TabbedCell,
} from '../submenu-tabs';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {isViaSaveFile, layoutFileName} from 'src/utils/layout-import';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {useTranslation} from 'react-i18next';
import {getSelectedDefinitionName} from 'src/store/definitionNameSlice';
import {
  canExportLayoutFile,
  exportLayoutFile,
  importLayoutFile,
  type LayoutFileImportError,
} from 'src/store/layoutFileThunks';

const SaveLoadPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

// The file is the result of a save, so the pane only confirms it, quietly.
const SavedMessage = styled(Message)`
  color: var(--color_label);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

// Mounted before any result, so a screen reader hears each one; a new attempt
// gets a new line, so the same words again are heard again.
const LiveRegion = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

// What the keyboard needs for a file is gathered by the save and load operations
// themselves (src/store/layoutFileThunks.ts); this pane only picks the file.
export const Pane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDefinitionName = useAppSelector(getSelectedDefinitionName);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // TODO: improve typing so we can remove this
  if (!selectedDefinition || !selectedDevice) {
    return null;
  }

  const saveLayout = async () => {
    setAttempt((count) => count + 1);
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaved(false);
    const notReady = t(
      'Could not save layout: the keyboard has not finished loading.',
    );
    // The picker needs the click, which the reads below would outlast: only what
    // is known at once is checked before it.
    if (!dispatch(canExportLayoutFile(selectedDevice))) {
      setErrorMessage(notReady);
      return;
    }
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: layoutFileName(selectedDefinitionName, new Date()),
      });
    } catch (err) {
      console.log('User cancelled save file request');
      return;
    }
    setBusy(true);
    try {
      const result = await dispatch(exportLayoutFile(selectedDevice));
      if ('error' in result) {
        setErrorMessage(notReady);
        return;
      }
      const blob = new Blob([stringify(result.file)], {
        type: 'application/json',
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setSaved(true);
    } catch (err) {
      console.warn('Saving layout failed', err);
      setErrorMessage(t('Failed to save.'));
    } finally {
      setBusy(false);
    }
  };

  const loadLayout = ([file]: Blob[]) => {
    setAttempt((count) => count + 1);
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaved(false);
    const reader = new FileReader();

    reader.onabort = () => setErrorMessage(t('File reading was cancelled.'));
    reader.onerror = () => setErrorMessage(t('Failed to read file.'));

    reader.onload = async () => {
      let saveFile: unknown = null;
      try {
        saveFile = JSON.parse(String(reader.result));
      } catch {
        saveFile = null;
      }
      if (!isViaSaveFile(saveFile)) {
        setErrorMessage(t('Could not load file: invalid data.'));
        return;
      }

      setBusy(true);
      const result = await dispatch(
        importLayoutFile(selectedDevice, saveFile),
      ).finally(() => setBusy(false));
      if ('error' in result) {
        const messages: Record<LayoutFileImportError, string> = {
          'different-keyboard': t(
            'Could not import layout. This file was created for a different keyboard: {{name}}',
            {name: saveFile.name},
          ),
          'key-count': t(
            'Could not import layout: incorrect number of keys in one or more layers.',
          ),
          'macro-count': t(
            'Could not import layout: incorrect number of macros.',
          ),
          'extra-layers': t(
            'Could not import layout: this file has more layers than this keyboard.',
          ),
          'keyboard-not-ready': t(
            'Could not import layout: the keyboard has not finished loading.',
          ),
          'invalid-data': t('Could not load file: invalid data.'),
          'write-failed': t('Failed to write the layout to the keyboard.'),
        };
        setErrorMessage(messages[result.error]);
        return;
      }

      setSuccessMessage(t('Successfully updated layout!'));
    };

    reader.readAsBinaryString(file);
  };

  return (
    <TabbedCell>
      <SubmenuTabBar label={t(title)}>
        <SubmenuTab type="button" $selected={true} aria-pressed={true}>
          {t(title)}
        </SubmenuTab>
      </SubmenuTabBar>
      <TabbedBody>
      <SaveLoadPane>
        <Container>
          <ControlRow>
            <Label>{t('Save Current Layout')}</Label>
            <Detail>
              <AccentButton disabled={busy} onClick={saveLayout}>
                {t('Save')}
              </AccentButton>
            </Detail>
          </ControlRow>
          <ControlRow>
            <Label>{t('Load Saved Layout')}</Label>
            <Detail>
              <AccentUploadButton disabled={busy} onLoad={loadLayout}>
                {t('Load')}
              </AccentUploadButton>
            </Detail>
          </ControlRow>
          <LiveRegion role="alert">
            {errorMessage ? (
              <ErrorMessage key={attempt}>{errorMessage}</ErrorMessage>
            ) : null}
          </LiveRegion>
          <LiveRegion role="status">
            {successMessage ? (
              <SuccessMessage key={attempt}>{successMessage}</SuccessMessage>
            ) : null}
            {saved ? (
              <SavedMessage key={attempt}>{t('Saved')}</SavedMessage>
            ) : null}
          </LiveRegion>
        </Container>
      </SaveLoadPane>
    </TabbedBody>
    </TabbedCell>
  );
};

export const Icon = component;
export const Title = title;
