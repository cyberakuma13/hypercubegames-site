// CSV parsing/serialization (RFC 4180-ish) and Google Sheets URL handling.

// Parse CSV text into an array of row arrays. Handles quoted fields,
// embedded commas/newlines, escaped quotes, and CRLF.
export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop fully-empty trailing rows
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

// Guess the delimiter from the header line (comma, tab, or semicolon).
export function sniffDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'));
  const counts = [[',', 0], ['\t', 0], [';', 0]].map(([d]) => [d, (firstLine.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g')) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n');
}

// Convert any pasted Google Sheets URL into a CORS-friendly CSV export URL.
// Works for sheets shared as "anyone with the link" (gviz endpoint) and for
// published-to-web sheets. Returns null if the URL isn't a Google Sheets link.
export function sheetsCsvUrl(url) {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.includes('docs.google.com')) return null;
    // Published-to-web links (/d/e/2PACX-...): use the pub?output=csv form.
    const pubMatch = u.pathname.match(/\/spreadsheets\/d\/e\/([^/]+)/);
    if (pubMatch) {
      const gid = u.searchParams.get('gid');
      return `https://docs.google.com/spreadsheets/d/e/${pubMatch[1]}/pub?output=csv${gid ? `&gid=${gid}&single=true` : ''}`;
    }
    const idMatch = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    // gid can be in the query or the #fragment (e.g. #gid=123)
    let gid = u.searchParams.get('gid');
    if (!gid && u.hash) {
      const m = u.hash.match(/gid=(\d+)/);
      if (m) gid = m[1];
    }
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;
  } catch {
    return null;
  }
}
