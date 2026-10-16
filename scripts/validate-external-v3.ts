import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

type ReaderModule = typeof import('@the-via/reader');

type SchemaError = {
  instancePath: string;
  keyword: string;
  message: string;
  params: unknown;
  schemaPath: string;
};

type ValidationSuccess = {
  firmwareVersion: number;
  name: unknown;
  ok: true;
  path: string;
  vendorProductId: number;
};

type ValidationFailure = {
  code?: string;
  errors?: SchemaError[];
  message: string;
  ok: false;
  path: string;
  stage: 'read' | 'parse' | 'schema' | 'transform';
};

export type ExternalV3ValidationResult = ValidationSuccess | ValidationFailure;

const USAGE =
  'Usage: bun scripts/validate-external-v3.ts --format json -- <one-or-more JSON paths>';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
};

const canonicalJSON = (value: unknown) => JSON.stringify(canonicalize(value));

let readerPromise: Promise<ReaderModule> | undefined;

const loadReader = () => {
  if (!readerPromise) {
    readerPromise = (async () => {
      // @the-via/reader's generated AJV modules warn while their schemas compile.
      // Keep the machine-readable validator stream limited to this script's JSON.
      const originalWarn = console.warn;
      console.warn = () => undefined;
      try {
        return await import('@the-via/reader');
      } finally {
        console.warn = originalWarn;
      }
    })();
  }
  return readerPromise;
};

const schemaErrors = (
  errors: ReaderModule['isKeyboardDefinitionV3']['errors'],
): SchemaError[] =>
  (errors ?? [])
    .filter(({keyword}) => keyword !== 'if')
    .map(({instancePath, keyword, message, params, schemaPath}) => ({
      instancePath,
      keyword,
      message: message ?? '',
      params,
      schemaPath,
    }))
    .sort((left, right) => {
      const leftJSON = canonicalJSON(left);
      const rightJSON = canonicalJSON(right);
      return leftJSON < rightJSON ? -1 : leftJSON > rightJSON ? 1 : 0;
    });

const errorCode = (error: unknown) => {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'READ_ERROR';
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const validateExternalV3Path = async (
  inputPath: string,
): Promise<ExternalV3ValidationResult> => {
  let source: string;
  try {
    source = await readFile(inputPath, 'utf8');
  } catch (error) {
    return {
      code: errorCode(error),
      message: 'Unable to read JSON file.',
      ok: false,
      path: inputPath,
      stage: 'read',
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return {
      message: 'Invalid JSON.',
      ok: false,
      path: inputPath,
      stage: 'parse',
    };
  }

  const reader = await loadReader();
  if (!reader.isKeyboardDefinitionV3(raw)) {
    return {
      errors: schemaErrors(reader.isKeyboardDefinitionV3.errors),
      message: 'Invalid VIA V3 keyboard definition.',
      ok: false,
      path: inputPath,
      stage: 'schema',
    };
  }

  try {
    const transformed = reader.keyboardDefinitionV3ToVIADefinitionV3(raw);
    return {
      firmwareVersion: transformed.firmwareVersion,
      name: transformed.name,
      ok: true,
      path: inputPath,
      vendorProductId: transformed.vendorProductId,
    };
  } catch (error) {
    return {
      message: errorMessage(error),
      ok: false,
      path: inputPath,
      stage: 'transform',
    };
  }
};

export const validateExternalV3Paths = async (
  inputPaths: readonly string[],
) => {
  const results: ExternalV3ValidationResult[] = [];
  for (const inputPath of inputPaths) {
    results.push(await validateExternalV3Path(inputPath));
  }
  return results;
};

const parsePaths = (args: readonly string[]) => {
  if (
    args.length < 4 ||
    args[0] !== '--format' ||
    args[1] !== 'json' ||
    args[2] !== '--' ||
    args.slice(3).some((inputPath) => inputPath.length === 0)
  ) {
    throw new Error(USAGE);
  }
  return args.slice(3);
};

export const runExternalV3Validator = async (args: readonly string[]) => {
  let inputPaths: string[];
  try {
    inputPaths = parsePaths(args);
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const results = await validateExternalV3Paths(inputPaths);
  process.stdout.write(`${canonicalJSON(results)}\n`);
  return results.every(({ok}) => ok) ? 0 : 1;
};

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (invokedPath === import.meta.url) {
  runExternalV3Validator(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `External V3 validator failed: ${errorMessage(error)}\n`,
      );
      process.exitCode = 1;
    });
}
