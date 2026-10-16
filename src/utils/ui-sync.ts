import {ERA_WIRE} from './era-wire.generated';

const UI_SYNC_REQUEST_COMMAND = ERA_WIRE.UI_SYNC.REQUEST;
const UI_SYNC_REQUEST_VERSION = ERA_WIRE.UI_SYNC_VERSION.ENVELOPE;
const VIA_PAYLOAD_LENGTH = ERA_WIRE.VIA_REPORT.SIZE;

export enum UISyncRequestType {
  CUSTOM_MENU_ALL = ERA_WIRE.UI_SYNC_TYPES.CUSTOM_MENU_ALL,
  CUSTOM_MENU_COMMANDS = ERA_WIRE.UI_SYNC_TYPES.CUSTOM_MENU_COMMANDS,
  CUSTOM_MENU_COMMAND_IDS = ERA_WIRE.UI_SYNC_TYPES.CUSTOM_MENU_COMMAND_IDS,
}

type UISyncCustomMenuCommandTarget = {
  channelId: number;
  commandId: number;
};

export type UISyncRequest =
  | {type: UISyncRequestType.CUSTOM_MENU_ALL}
  | {
      type: UISyncRequestType.CUSTOM_MENU_COMMANDS;
      targets: UISyncCustomMenuCommandTarget[];
    }
  | {
      type: UISyncRequestType.CUSTOM_MENU_COMMAND_IDS;
      commandIds: number[];
    };

export const parseUISyncRequest = (
  buffer: Uint8Array,
): UISyncRequest | undefined => {
  if (buffer.length !== VIA_PAYLOAD_LENGTH) {
    return undefined;
  }

  const [command, version, type, count] = buffer;
  if (
    command !== UI_SYNC_REQUEST_COMMAND ||
    version !== UI_SYNC_REQUEST_VERSION
  ) {
    return undefined;
  }

  if (type === UISyncRequestType.CUSTOM_MENU_ALL) {
    return count === 0 ? {type} : undefined;
  }

  if (type === UISyncRequestType.CUSTOM_MENU_COMMAND_IDS) {
    const payloadEnd = 4 + count;
    if (payloadEnd > buffer.length) {
      return undefined;
    }
    return {type, commandIds: Array.from(buffer.slice(4, payloadEnd))};
  }

  if (type === UISyncRequestType.CUSTOM_MENU_COMMANDS) {
    const payloadEnd = 4 + count * 2;
    if (payloadEnd > buffer.length) {
      return undefined;
    }
    const targets: UISyncCustomMenuCommandTarget[] = [];
    for (let offset = 4; offset < payloadEnd; offset += 2) {
      targets.push({
        channelId: buffer[offset],
        commandId: buffer[offset + 1],
      });
    }
    return {type, targets};
  }

  return undefined;
};

export const getUISyncCommandIds = (
  request: UISyncRequest,
  commands: Record<string, number[]>,
): string[] | undefined => {
  if (request.type === UISyncRequestType.CUSTOM_MENU_ALL) {
    return undefined;
  }
  if (request.type === UISyncRequestType.CUSTOM_MENU_COMMANDS) {
    return Object.entries(commands)
      .filter(([, command]) =>
        request.targets.some(
          (target) =>
            command[0] === target.channelId && command[1] === target.commandId,
        ),
      )
      .map(([id]) => id);
  }
  return Object.entries(commands)
    .filter(([, command]) => request.commandIds.includes(command[1]))
    .map(([id]) => id);
};
