const UI_SYNC_REQUEST_COMMAND = 0x16;
const UI_SYNC_REQUEST_VERSION = 0x01;
const VIA_PAYLOAD_LENGTH = 32;

export enum UISyncRequestType {
  CUSTOM_MENU_ALL = 0x00,
  CUSTOM_MENU_COMMANDS = 0x01,
  CUSTOM_MENU_COMMAND_IDS = 0x02,
}

export type UISyncCustomMenuCommandTarget = {
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
