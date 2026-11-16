import {
  HEADERS,
  MAX_CELLS,
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  type Person,
  type SheetData,
} from './schema';
import { columnName } from './roster';

// Inspect central-directory size declarations before a ZIP library decompresses XLSX.
export function checkXlsxArchive(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('文件不是有效的 .xlsx 工作簿，或文件已损坏。');
  const entries = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (
    entries > 2000 ||
    entries === 65535 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    throw new Error('不支持过大、分卷或 ZIP64 工作簿。');
  let cursor = offset,
    total = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > buffer.byteLength || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('工作簿压缩目录不完整。');
    total += view.getUint32(cursor + 24, true);
    if (total > 64 * 1024 * 1024)
      throw new Error('工作簿解压后超过 64MB，请移除多余图片或工作表。');
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
}

function integerText(value: number, format: string | undefined): string {
  const text = String(value);
  if (!Number.isSafeInteger(value) || value < 0 || !format) return text;
  const sections = format.split(';');
  const section = (value === 0 && sections.length > 2 ? sections[2] : sections[0])
    .replace(/\[(?:Black|Blue|Cyan|Green|Magenta|Red|White|Yellow|Color\d+)\]/gi, '')
    .trim();
  // Apply only integer zero masks; date, decimal, percent and scientific formats stay unchanged.
  return /^#*0+$/.test(section) ? text.padStart(section.replace(/#/g, '').length, '0') : text;
}

export async function parseExcel(buffer: ArrayBuffer): Promise<SheetData[]> {
  checkXlsxArchive(buffer);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets: SheetData[] = [];
  for (const ws of workbook.worksheets) {
    const cells: SheetData['cells'] = [];
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const value = cell.value;
        if (value === null || value === undefined) return;
        if (
          typeof value === 'object' &&
          ('formula' in value || 'sharedFormula' in value) &&
          value.result === undefined
        )
          throw new Error(
            `${ws.name}!${cell.address} 的公式没有保存计算结果，请在 Excel 中重新保存后上传。`,
          );
        let text = cell.text.trim();
        if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value))
          text =
            typeof value.result === 'number'
              ? integerText(value.result, cell.numFmt)
              : String(value.result ?? '').trim();
        else if (typeof value === 'number') text = integerText(value, cell.numFmt);
        if (!text) return;
        const r = Number(cell.row),
          c = Number(cell.col);
        if (r > MAX_ROWS || c > MAX_COLUMNS || text.length > 512)
          throw new Error(`${ws.name}!${cell.address} 超出支持范围，请缩小表格。`);
        cells.push({ address: `${columnName(c)}${r}`, row: r, column: c, text });
        if (cells.length > MAX_CELLS)
          throw new Error(`工作表 ${ws.name} 超过 ${MAX_CELLS} 个非空单元格，请拆分文件。`);
      }),
    );
    if (cells.length) sheets.push({ name: ws.name, cells });
  }
  if (!sheets.length) throw new Error('工作簿没有可读取的内容。');
  if (sheets.length > 20) throw new Error('工作簿超过 20 张非空工作表，请先拆分。');
  return sheets;
}
export async function readExcelFile(file: File) {
  if (!/\.xlsx$/i.test(file.name))
    throw new Error('请上传 .xlsx 文件；旧版 .xls 请先另存为 .xlsx。');
  if (file.size > MAX_FILE_BYTES) throw new Error('Excel 文件请控制在 10MB 以内。');
  return parseExcel(await file.arrayBuffer());
}
export async function createRosterBuffer(people: Person[]) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('人员库-默认人员库模板');
  sheet.columns = HEADERS.map((header, i) => ({
    header,
    key: String(i),
    width: [30, 20, 36, 28, 18][i],
  }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { name: '微软雅黑', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245C46' } };
  sheet.getRow(1).height = 26;
  sheet.getRow(1).alignment = { vertical: 'middle' };
  for (const person of people) {
    // Strings remain literal strings (including leading =, +, -, @), never formulas.
    const row = sheet.addRow([
      person.name,
      person.phone,
      person.organization,
      person.title,
      person.zone,
    ]);
    row.font = { name: '微软雅黑', size: 11 };
    row.height = 22;
    row.alignment = { vertical: 'middle', wrapText: false };
    row.getCell(2).numFmt = '@';
  }
  sheet.autoFilter = { from: 'A1', to: `E${people.length + 1}` };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
export async function downloadRoster(people: Person[]) {
  const bytes = await createRosterBuffer(people);
  const url = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '人员库-默认人员库模板.xlsx';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
