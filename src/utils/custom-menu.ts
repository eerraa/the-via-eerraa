export const isCustomMenuCommandContent = (
  content: unknown,
): content is [string, number, number, ...number[]] =>
  Array.isArray(content) &&
  content.length >= 3 &&
  typeof content[0] === 'string' &&
  content.slice(1).every((value) => typeof value === 'number');

// The H7S USB delivery diagnostics block is rendered by the submenu that owns the
// boot polling-mode control, so it sits with the setting it explains instead of in a
// separate top-level page. Keying off the command keeps the definition JSON — and
// therefore the official VIA path — unchanged.
export const USB_POLLING_MODE_COMMAND = 'id_qmk_usb_bootmode';

export const isUsbPollingModeCommand = (name: unknown) =>
  name === USB_POLLING_MODE_COMMAND;
