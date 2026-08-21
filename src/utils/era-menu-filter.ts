import {isExactTermCommand, isLegacyTermCommand} from './era-exact-ms';
import type {StateSyncCapability} from './era-state-sync';

export const shouldKeepMenuControl = (
  name: string | undefined,
  capability: StateSyncCapability | undefined,
) => {
  if (!name) {
    return true;
  }
  const exactCapable = capability === 'capable';
  if (isExactTermCommand(name)) {
    return exactCapable;
  }
  if (isLegacyTermCommand(name)) {
    return !exactCapable;
  }
  return true;
};

export const filterMenuTree = <T>(
  value: T,
  capability: StateSyncCapability | undefined,
): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => filterMenuTree(item, capability))
      .filter((item) => item !== undefined) as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string' && Array.isArray(record.content)) {
    const name = record.content[0];
    if (typeof name === 'string' && !shouldKeepMenuControl(name, capability)) {
      return undefined as T;
    }
  }
  if (Array.isArray(record.content)) {
    return {
      ...record,
      content: filterMenuTree(record.content, capability),
    } as T;
  }
  return value;
};
