// ---------------------------------------------------------------------
// Shared CSV export helpers — used by the admin Reports tab (Pick & Drop)
// and the Food settlement export. Pure browser-side: builds a text/csv Blob
// and triggers a download, no backend round-trip for the file itself.
// ---------------------------------------------------------------------

// Quote a value only when it contains a comma, quote, or newline (RFC 4180).
export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: array of objects. columns: array of { key, header }.
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvEscape(c.header)).join(',');
  const body = (rows || [])
    .map((r) => columns.map((c) => csvEscape(r[c.key])).join(','))
    .join('\n');
  return body ? `${head}\n${body}` : head;
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
