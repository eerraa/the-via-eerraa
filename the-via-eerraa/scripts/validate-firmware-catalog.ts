import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {auditFirmwarePackagesAt} from './audit-firmware-packages';
import {
  type FirmwareCatalogSource,
  type FirmwareData,
  type FirmwareManifest,
  resolveFirmwareCatalog,
  validateFirmwareCatalog,
} from '../src/utils/era-firmware-catalog';

// Build-time check of `config/firmware-catalog.json` (ADR 0004 §5). The
// structural rules are shared with the app in `src/utils/era-firmware-catalog.ts`;
// this adds what needs the file system: every published file exists under
// `public/` with the recorded size and SHA-256, including older releases.

export const readFirmwareData = async (
  projectRoot: string,
): Promise<FirmwareData> => {
  const readJSON = async (relative: string) =>
    JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'));
  const [catalog, manifest] = await Promise.all([
    readJSON('config/firmware-catalog.json') as Promise<FirmwareCatalogSource>,
    readJSON(
      'config/era-definitions.manifest.json',
    ) as Promise<FirmwareManifest>,
  ]);
  return {catalog: resolveFirmwareCatalog(catalog), manifest};
};

export const validateFirmwareCatalogFiles = async (
  data: FirmwareData,
  publicRoot: string,
): Promise<string[]> => {
  const errors: string[] = [];
  for (const release of data.catalog.versions ?? []) {
    for (const [makerId, files] of Object.entries(release.files)) {
      for (const [boardId, file] of Object.entries(files)) {
        const label = `${release.version}/${makerId}/${boardId}`;
        const target = path.join(
          publicRoot,
          ...file.url.split('/').filter(Boolean),
        );
        if (
          !path.resolve(target).startsWith(path.resolve(publicRoot) + path.sep)
        ) {
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
    ...(await auditFirmwarePackagesAt(
      path.join(projectRoot, 'public', 'firmware-files'),
    )),
  ];
};
