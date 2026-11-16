import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { createRosterBuffer, parseExcel, checkXlsxArchive } from '../../src/seating/lib/excel';
import { buildRoster } from '../../src/seating/lib/roster';
import { forumFixture } from './fixtures';
import type { Plan } from '../../src/seating/lib/schema';

describe('XLSX 实际文件读写', () => {
  it('导出真实五字段工作簿，姓名文本不被当作公式', async () => {
    const { plan, sheets } = forumFixture();
    const people = buildRoster(plan, sheets).people;
    people[0].name = '=HYPERLINK("https://invalid.example")';
    people[0].phone = '00123456789';
    const buffer = await createRosterBuffer(people);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer.buffer as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.rowCount).toBe(243);
    expect(ws.columnCount).toBe(5);
    expect(ws.getRow(1).values).toEqual([undefined, '姓名', '手机号', '单位', '职务', '分座区域']);
    expect(ws.getCell('A2').value).toBe(people[0].name);
    expect(ws.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell('B2').value).toBe('00123456789');
    expect(ws.getCell('B2').numFmt).toBe('@');
  });
  it('读取富文本、合并单元格与缓存公式，不重复合并格', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('座次');
    ws.mergeCells('A1:B1');
    ws.getCell('A1').value = { richText: [{ text: '测试' }, { text: '姓名' }] };
    ws.getCell('A2').value = { formula: '1+1', result: 2 };
    const bytes = await wb.xlsx.writeBuffer();
    const sheets = await parseExcel(new Uint8Array(bytes).buffer);
    expect(sheets[0].cells.map((c) => c.text)).toEqual(['测试姓名', '2']);
  });
  it('未缓存公式给出错误，避免漏记', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('名单');
    ws.getCell('A1').value = { formula: '"测试"' };
    const bytes = await wb.xlsx.writeBuffer();
    await expect(parseExcel(new Uint8Array(bytes).buffer)).rejects.toThrow('没有保存计算结果');
  });
  it('整数补零格式与缓存公式导入后，五字段导出继续保留完整手机号', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('名单');
    const values = [123456789, { formula: '123456789', result: 123456789 }, 0, 13800138000];
    values.forEach((value, index) => {
      ws.getCell(`A${index + 2}`).value = `测试人员${index + 1}`;
      ws.getCell(`B${index + 2}`).value = value;
      ws.getCell(`B${index + 2}`).numFmt = index === 2 ? '00000000000;[Red]-00000000000;00000000000;@' : '00000000000';
    });
    const sheets = await parseExcel(new Uint8Array(await wb.xlsx.writeBuffer()).buffer);
    const plan: Plan = {
      summary: '', ignoredCells: [], warnings: [], zones: [{
        id: 'A', label: '贵宾区', position: '', rows: null, columns: null,
        direction: 'unknown', confidence: 'high', bbox: null, sources: [{
          sheet: '名单', range: 'A2:B5', mode: 'table', nameColumn: 'A', phoneColumn: 'B',
          organizationColumn: null, titleColumn: null,
        }],
      }],
    };
    const people = buildRoster(plan, sheets).people;
    expect(people.map((person) => person.phone)).toEqual(['00123456789', '00123456789', '00000000000', '13800138000']);
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load((await createRosterBuffer(people)).buffer as ArrayBuffer);
    const result = exported.worksheets[0];
    expect([2, 3, 4, 5].map((row) => result.getCell(`B${row}`).value)).toEqual(people.map((person) => person.phone));
    expect([2, 3, 4, 5].every((row) => result.getCell(`B${row}`).type === ExcelJS.ValueType.String && result.getCell(`B${row}`).numFmt === '@')).toBe(true);
    expect(result.getCell('E2').value).toBe('贵宾区');
  });
  it('补零不截断更长数字，也不改变文本、日期或金额格式', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('格式');
    const examples = [
      [123456, '0000', '123456'], [12, '[Blue]00000', '00012'],
      [12, '##0000', '0012'], ['000123', '00000000', '000123'],
      [12.5, '0.00', '12.5'], [123, '0.00E+00', '123'],
      [45200, 'yyyy-mm-dd', '45200'],
    ] as const;
    examples.forEach(([value, format], index) => {
      ws.getCell(`A${index + 1}`).value = value;
      ws.getCell(`A${index + 1}`).numFmt = format;
    });
    const sheets = await parseExcel(new Uint8Array(await wb.xlsx.writeBuffer()).buffer);
    // ExcelJS interprets a date-formatted number as a Date; it should not become a padded integer.
    expect(sheets[0].cells.slice(0, 6).map((cell) => cell.text)).toEqual(examples.slice(0, 6).map((example) => example[2]));
    expect(sheets[0].cells[6].text).not.toMatch(/^0*45200$/);
  });
  it('拒绝损坏文件和声明解压超过限制的压缩包', () => {
    expect(() => checkXlsxArchive(new Uint8Array(4).buffer)).toThrow('有效的');
    const bytes = new Uint8Array(68);
    const v = new DataView(bytes.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint32(24, 100 * 1024 * 1024, true);
    v.setUint32(46, 0x06054b50, true);
    v.setUint16(56, 1, true);
    v.setUint32(62, 0, true);
    expect(() => checkXlsxArchive(bytes.buffer)).toThrow('64MB');
  });
});
