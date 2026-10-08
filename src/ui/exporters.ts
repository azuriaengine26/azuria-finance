import type { Report, Cell } from '../core/reports';
import { formatMoney, toDecimalString } from '../core/money';
import { toCSV } from '../core/backup';
import { download } from './components';

const text = (c: Cell): string => {
  if (c == null) return '';
  if (typeof c === 'object' && 'm' in c) return formatMoney(c.m, c.c);
  if (typeof c === 'object' && 'p' in c) return c.p == null ? '—' : `${c.p}%`;
  return String(c);
};
const slug = (r: Report) => r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function reportCSV(r: Report) {
  const rows: (string | number)[][] = [[r.title], [r.subtitle], []];
  for (const s of r.sections) {
    if (s.title) rows.push([s.title]);
    rows.push(s.columns);
    for (const row of s.rows) rows.push(row.map((c) => (c && typeof c === 'object' && 'm' in c ? toDecimalString(c.m) : c && typeof c === 'object' && 'p' in c ? (c.p ?? '') : (c ?? ''))) as any);
    if (s.totals) rows.push(s.totals.map((c) => (c && typeof c === 'object' && 'm' in c ? toDecimalString(c.m) : text(c))) as any);
    rows.push([]);
  }
  for (const n of r.notes) rows.push([n]);
  download(`${slug(r)}.csv`, toCSV(rows), 'text/csv');
}

export async function reportXLSX(r: Report) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Azuria Finance';
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { color: { argb: 'FF6B7889' } };
  ws.addRow([]);
  let maxCols = 1;
  for (const s of r.sections) {
    if (s.title) ws.addRow([s.title]).font = { bold: true, size: 12 };
    const head = ws.addRow(s.columns);
    head.font = { bold: true };
    head.eachCell((c) => { c.border = { bottom: { style: 'thin' } }; });
    maxCols = Math.max(maxCols, s.columns.length);
    const add = (cells: Cell[], bold = false) => {
      const row = ws.addRow(cells.map((c) => (c && typeof c === 'object' && 'm' in c ? Number(toDecimalString(c.m)) : c && typeof c === 'object' && 'p' in c ? (c.p == null ? null : c.p / 100) : c)));
      cells.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c && typeof c === 'object' && 'm' in c) cell.numFmt = `#,##0.00 "${c.c}";-#,##0.00 "${c.c}"`;
        if (c && typeof c === 'object' && 'p' in c) cell.numFmt = '0.0%';
      });
      if (bold) { row.font = { bold: true }; row.eachCell((c) => { c.border = { top: { style: 'thin' } }; }); }
    };
    s.rows.forEach((row) => add(row));
    if (s.totals) add(s.totals, true);
    ws.addRow([]);
  }
  for (const n of r.notes) ws.addRow([n]).font = { italic: true, color: { argb: 'FF6B7889' } };
  for (let i = 1; i <= maxCols; i++) ws.getColumn(i).width = i === 1 ? 34 : 16;
  const buf = await wb.xlsx.writeBuffer();
  download(`${slug(r)}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export async function reportPDF(r: Report) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const wide = r.sections.some((s) => s.columns.length > 6);
  const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 35, 58);
  doc.text(r.title, 40, 48);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(107, 120, 137);
  doc.text(r.subtitle, 40, 64);
  let y = 84;
  // PDF core fonts can't draw "−" or "≈"; use ASCII equivalents.
  const ascii = (s: string) => s.replace(/−/g, '-').replace(/≈/g, '~').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/–/g, '-');
  for (const s of r.sections) {
    if (s.title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 35, 58); doc.text(ascii(s.title), 40, y); y += 8; }
    const numeric = s.columns.map((_, i) => s.rows.some((row) => row[i] && typeof row[i] === 'object'));
    autoTable(doc, {
      startY: y, head: [s.columns.map(ascii)], body: s.rows.map((row) => row.map((c) => ascii(text(c)))), foot: s.totals ? [s.totals.map((c) => ascii(text(c)))] : undefined,
      margin: { left: 40, right: 40 }, styles: { fontSize: 8.5, cellPadding: 4, textColor: [20, 35, 58] },
      headStyles: { fillColor: [20, 35, 58], textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: [238, 241, 236], textColor: [20, 35, 58], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 246] },
      columnStyles: Object.fromEntries(numeric.map((n, i) => [i, n ? { halign: 'right' } : {}])),
    });
    y = (doc as any).lastAutoTable.finalY + 22;
    if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 48; }
  }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(107, 120, 137);
  for (const n of r.notes) {
    const lines = doc.splitTextToSize(ascii(n), W - 80);
    if (y + lines.length * 11 > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 48; }
    doc.text(lines, 40, y); y += lines.length * 11 + 6;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.text(`Azuria Finance · generated ${new Date().toLocaleDateString()} · page ${i} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 20); }
  download(`${slug(r)}.pdf`, doc.output('arraybuffer'), 'application/pdf');
}
