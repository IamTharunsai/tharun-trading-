export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let content = typeof value === 'number' ? Number.isFinite(value) ? String(value) : '' : typeof value === 'string' ? value : '';
  // Quotes alone do not neutralize spreadsheet formulas. Real numeric losses
  // stay numeric; externally supplied text never becomes a spreadsheet command.
  if (typeof value === 'string' && /^(?:\s*[=+\-@]|[\t\r\n])/.test(content)) content = "'" + content;
  return `"${content.replace(/"/g, '""')}"`;
}
export function csvRow(values: unknown[]): string { return values.map(csvCell).join(',') + '\r\n'; }
