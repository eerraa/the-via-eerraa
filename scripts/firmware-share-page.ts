// The app shell served at /firmware and /firmware/* (docs/adr/0004-firmware-
// distribution.md §4). A chat preview (Discord and the like) reads only the HTML
// head and runs no script, so the firmware link carries its own title and
// description here. The document is otherwise the built index.html: the same
// hashed assets boot the same app, which then reads the URL as usual.

export const FIRMWARE_SHARE_PAGE = 'firmware-app.html';

// The root and short board links retain a generic preview. Canonical maker
// links carry the catalog's display name even when the crawler runs no script.
export const FIRMWARE_SHARE_TITLE = 'Firmware';
export const FIRMWARE_SHARE_DESCRIPTION = 'Firmware download';

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const getMakerSharePage = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`firmware share page: invalid maker id ${id}`);
  }
  return `firmware-app-${id}.html`;
};

// Generate the host rules from the same inventory as the HTML files, before
// the generic wildcard. Extensionless destinations preserve URLs on Pages.
export const toFirmwareShareRedirects = (
  redirects: string,
  makers: ReadonlyArray<{id: string}>,
) => {
  const fallback = /^\/firmware\/\*\s+\/firmware-app\s+200\s*$/m;
  if (!fallback.test(redirects)) {
    throw new Error('firmware share page: generic rewrite not found');
  }
  const rules = makers.flatMap(({id}) => {
    const destination = `/${getMakerSharePage(id).replace(/\.html$/, '')}`;
    return [`/firmware/${id} ${destination} 200`,
      `/firmware/${id}/* ${destination} 200`];
  }).join('\n');
  return redirects.replace(fallback, (line) => `${rules}\n${line}`);
};

// Every match is replaced; at least one must exist.
const replaceRequired = (
  html: string,
  pattern: RegExp,
  replacement: (match: string, ...groups: string[]) => string,
) => {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags}g`));
  if (!matches || matches.length === 0) {
    throw new Error(`firmware share page: ${pattern} not found in index.html`);
  }
  return html.replace(new RegExp(pattern.source, `${pattern.flags}g`), replacement);
};

/**
 * index.html with the firmware or maker title and description. The VIA logo preview image
 * is dropped rather than shown beside a firmware link. Fails when the head no longer
 * has the tags it rewrites, so a changed template cannot ship a wrong preview.
 */
export const toFirmwareSharePage = (indexHtml: string, makerName?: string) => {
  const title = escapeAttribute(makerName ? `${makerName} — Firmware` : FIRMWARE_SHARE_TITLE);
  const description = escapeAttribute(FIRMWARE_SHARE_DESCRIPTION);
  let html = replaceRequired(indexHtml, /<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  html = replaceRequired(
    html,
    /(<meta[^>]*property="og:title"[^>]*content=")[^"]*(")/,
    (_, before, after) => `${before}${title}${after}`,
  );
  html = replaceRequired(
    html,
    /(<meta[^>]*name="description"[^>]*content=")[^"]*(")/,
    (_, before, after) => `${before}${description}${after}`,
  );
  html = replaceRequired(
    html,
    /(<meta[^>]*property="og:description"[^>]*content=")[^"]*(")/,
    (_, before, after) => `${before}${description}${after}`,
  );
  html = replaceRequired(
    html,
    /[ \t]*<meta[^>]*property="(?:og|twitter):image"[^>]*>\r?\n?/,
    () => '',
  );
  return html;
};
