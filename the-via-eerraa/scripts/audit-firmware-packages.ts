import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {strFromU8, unzipSync} from 'fflate';
import {validateV3Definition} from './validate-definition';

// Frozen byte identities of the 35 ZIPs already published when this guard was
// introduced. Never extend this set for new releases. Dates, filenames and the
// mutable catalog are NOT exemptions; even a repack of an old release is strict.
const previouslyPublished = new Set([
  '49ad12486e299b73a1a670f5fccd06df609685eb5d24408e7130e71ecb7e0f70',
  '220d5bfcfbb0e6e26fc5e3f9ebc486cf1e8a6a742e4531137a2a686a461a4320',
  '0b20548a460093d99a759ca1700c7cbee6274d57a15f0b54e0261fce548752bd',
  '252dd227cd90fea99b42e54a11ea7e19ba3bc8c222338a7c2d9270c20375c2bc',
  '1a4e1117d189887fe71a5976f081476a6dc1a8c1dacf5766f036fd056b139f7e',
  '619aa98bff71b5baea09390ee2d9531b83028fe0c08721bbd1ca84fda4c1e30d',
  '4fbb99b0d13224db7c1f7f7e5807295f3f828abf09659a23252b5b0ed84ba24b',
  '7b5a8bb31ed9e00414aa999e3a81de8fdaf1208f1ec36ea87f4637989df48751',
  '1a4ccd3e40e23f57be917a282aad0533937769665e9a718982dabc6bfa79cb82',
  'bb6cfa0dfc2293b0a1193fe34a267a71eef1bf29dcd82b6406b30dc56c35da49',
  '57d3228dbd38e624ec3ab4ea8f9a093474ab7fe1ae09582b6db7d48910d461cb',
  '5317fbff600a842b8baf10847f38297660a0dea4162c5ac4d45c21f4f090b8e1',
  '0dcd0443e2776a230c005439c1b4ff119e9894abb5fc012c79effd170edd2f3d',
  '14fcf02eb331873e9c7ff12f0f9c87905c44b065412ee78306a59a5c5351bff2',
  'af1c12f10aa8cc9cad9b1b5f583e25607b8dbef1a899fd7ee2f0e85c1d3f0295',
  '083513b8ab5c029a68385e2f5354b9d4921bcc51c0839452c583bcaceff6178d',
  '2e8b7ee793bbc551506557fcf29c89b33ac8d8eb21b1e78203d4c9b26f18a5a6',
  '9c0da06958cb43248183cd3506e4737e38aeb2996cfa9a8c09e44012d046c0e4',
  '8d3e64bf28035955f27727a3958b9f00a2b3c68d44a0d72e37370bc118c996fd',
  '3ef69e5be4a9fe72ae3508d0b625796dae639fd408a9ca79aa65fd75374a3c23',
  '23a7acae71d03c090eee5862f9a3fafb09631e6f1a9a3b78731e604c3d996eb3',
  '2eade2c1a0fbec34e4e9eb523ef484c7a2bbafb4005c5242bed716fef743e93c',
  'f8b57803fa5cb13ccdf1a6979b5b0df7c05f459ab61adae7d5da517d01fbf8cd',
  '421cf99c3344d40c41e11672e2ac11be39b31439f9c1ef282d5239bc5853b3fc',
  '2a14ba95cdb393f3be35f9e93fb4b6efb73db62fa435906f9975d9a9ff339938',
  '2329ecfe13a42cecee258b73d35afc6b53ec7167e33df7a322eb58d8d6aba353',
  '0e40ff21dc5485d1a040295687bb5cd9742fdd35ecca7a859051e830931d39d3',
  '2eff7a2891832443066d242c75cf6f52f67bdeb08133190d34d4a1935c4442a0',
  '4fe2cac1bcd4044c439becfa0e70c58a5a80fa4c618b733c1a70e6b9b5b2076f',
  'b2fd28dfc2688f1667a10275385543b22f4575dad36b396e7eacfd1cab13c08b',
  '118b7de14066caf3081dbd2bbeacc694a54e8bb519aa4964d087bd1d73004716',
  '71af58f8204fda7b4c52da515c01caa34122c4351940a241b54a03cf616f83ed',
  'a88fc4607de9430d5f6547cdf87096c81fe74d213c08c01fa6c748ad33b32203',
  'c08c8e0eebc2cb4947562bec0565c63dab1c997648ea1be0377ccc8e186e956d',
  '3cc09b5e90709a215dff51c63565ca74fd3606d3ad95becd981a1134443a449a',
]);

/** Strict prepublication check: no grandfathering for explicitly supplied ZIPs. */
export const validateFirmwarePackage = (bytes: Uint8Array): string[] => {
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(bytes, {
      filter: ({name}) => /(?:^|\/)usevia\.app\/.*\.json$/i.test(name),
    });
  } catch (error) {
    return [`Invalid firmware ZIP: ${String(error)}`];
  }
  if (!Object.keys(entries).length) {
    return ['Firmware ZIP has no STOCK usevia.app/*.json definitions'];
  }
  return Object.entries(entries).flatMap(([name, content]) => {
    let raw: unknown;
    try {
      raw = JSON.parse(strFromU8(content));
    } catch {
      return [`${name}: Invalid JSON`];
    }
    return validateV3Definition(raw).map((error) => `${name}: ${error}`);
  });
};

/** Audit all hosted ZIPs, including files not yet referenced by the catalog. */
export const auditFirmwarePackagesAt = async (
  packagesRoot: string,
): Promise<string[]> => {
  const errors: string[] = [];
  for (const entry of await readdir(packagesRoot, {withFileTypes: true})) {
    const target = path.join(packagesRoot, entry.name);
    if (entry.isDirectory()) {
      errors.push(...(await auditFirmwarePackagesAt(target)));
    } else if (entry.name.toLowerCase().endsWith('.zip')) {
      const bytes = await readFile(target);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!previouslyPublished.has(sha256)) {
        errors.push(
          ...validateFirmwarePackage(bytes).map((error) => `${target}: ${error}`),
        );
      }
    }
  }
  return errors;
};

const main = async () => {
  // With explicit paths, audit candidate packages strictly before publication.
  // With no paths, use the same frozen-byte exception as the normal app build.
  const candidates = process.argv.slice(2);
  const errors = candidates.length
    ? (
        await Promise.all(
          candidates.map(async (candidate) =>
            validateFirmwarePackage(await readFile(candidate)).map(
              (error) => `${candidate}: ${error}`,
            ),
          ),
        )
      ).flat()
    : await auditFirmwarePackagesAt(
        path.join(process.cwd(), 'public', 'firmware-files'),
      );
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Firmware STOCK definitions passed.');
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
