import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {
  type FirmwareCatalog,
  type FirmwareData,
  type FirmwareManifest,
  validateFirmwareCatalog,
} from '../src/utils/era-firmware-catalog';

// Build-time check of `config/firmware-catalog.json` (ADR 0004 §5). The
// structural rules are shared with the app in `src/utils/era-firmware-catalog.ts`;
// this adds what needs the file system: every published file exists under
// `public/` with the recorded size and SHA-256. A board whose file is not
// published yet (`file: null`) has nothing to check here.

export const readFirmwareData = async (
  projectRoot: string,
): Promise<FirmwareData> => {
  const readJSON = async (relative: string) =>
    JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'));
  const [catalog, manifest] = await Promise.all([
    readJSON('config/firmware-catalog.json') as Promise<FirmwareCatalog>,
    readJSON('config/era-definitions.manifest.json') as Promise<FirmwareManifest>,
  ]);
  return {catalog, manifest};
};

export const validateFirmwareCatalogFiles = async (
  data: FirmwareData,
  publicRoot: string,
): Promise<string[]> => {
  const errors: string[] = [];
  for (const maker of data.catalog.makers) {
    for (const entry of maker.boards) {
      const file = entry.file;
      if (!file || typeof file.url !== 'string') {
        continue;
      }
      const label = `${maker.id}/${entry.board}`;
      const target = path.join(publicRoot, ...file.url.split('/').filter(Boolean));
      if (!path.resolve(target).startsWith(path.resolve(publicRoot) + path.sep)) {
        errors.push(`${label} url leaves public/`);
        continue;
      }
      let size: number;
      try {
        size = (await stat(target)).size;
      } catch {
        errors.push(`${label} file is missing: ${file.url}`);
        continue;
      }
      if (size !== file.size) {
        errors.push(`${label} size is ${size}, catalog records ${file.size}`);
      }
      const sha256 = createHash('sha256')
        .update(await readFile(target))
        .digest('hex');
      if (sha256 !== file.sha256) {
        errors.push(`${label} SHA-256 does not match the catalog`);
      }
    }
  }
  return errors;
};

export const validateFirmwareCatalogAt = async (projectRoot: string) => {
  const data = await readFirmwareData(projectRoot);
  return [
    ...validateFirmwareCatalog(data),
    ...(await validateFirmwareCatalogFiles(
      data,
      path.join(projectRoot, 'public'),
    )),
  ];
};
