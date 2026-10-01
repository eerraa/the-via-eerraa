// The app shell served at /firmware and /firmware/* (docs/adr/0004-firmware-
// distribution.md §4). A chat preview (Discord and the like) reads only the HTML
// head and runs no script, so the firmware link carries its own title and
// description here. The document is otherwise the built index.html: the same
// hashed assets boot the same app, which then reads the URL as usual.

export const FIRMWARE_SHARE_PAGE = 'firmware-app.html';

// Plain words only: the board and firmware supplier's name is kept out of what a
// shared link shows.
export const FIRMWARE_SHARE_TITLE = 'Firmware';
export const FIRMWARE_SHARE_DESCRIPTION = 'Firmware download';

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Every match is replaced; at least one must exist.
const replaceRequired = (
  html: string,
  pattern: RegExp,
  replacement: string,
) => {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags}g`));
  if (!matches || matches.length === 0) {
    throw new Error(`firmware share page: ${pattern} not found in index.html`);
  }
  return html.replace(new RegExp(pattern.source, `${pattern.flags}g`), replacement);
};

/**
 * index.html with the firmware title and description. The VIA logo preview image
 * is dropped rather than shown beside a firmware link. Fails when the head no longer
 * has the tags it rewrites, so a changed template cannot ship a wrong preview.
 */
export const toFirmwareSharePage = (indexHtml: string) => {
  const title = escapeAttribute(FIRMWARE_SHARE_TITLE);
  const description = escapeAttribute(FIRMWARE_SHARE_DESCRIPTION);
  let html = replaceRequired(indexHtml, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = replaceRequired(
    html,
    /(<meta[^>]*property="og:title"[^>]*content=")[^"]*(")/,
    `$1${title}$2`,
  );
  html = replaceRequired(
    html,
    /(<meta[^>]*name="description"[^>]*content=")[^"]*(")/,
    `$1${description}$2`,
  );
  html = replaceRequired(
    html,
    /(<meta[^>]*property="og:description"[^>]*content=")[^"]*(")/,
    `$1${description}$2`,
  );
  html = replaceRequired(
    html,
    /[ \t]*<meta[^>]*property="(?:og|twitter):image"[^>]*>\r?\n?/,
    '',
  );
  return html;
};
