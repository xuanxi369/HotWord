import {
  MAX_CELLS,
  MAX_COLUMNS,
  MAX_ROWS,
  type Person,
  type PersonOverride,
  type Plan,
  type RosterFields,
  type SheetData,
  type SourceCell,
} from './schema';

export function columnName(index: number): string {
  let value = index,
    result = '';
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
export function columnNumber(name: string): number {
  return [...name].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
}
export function parseAddress(address: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(address);
  if (!match) throw new Error(`无效单元格地址：${address}`);
  const column = columnNumber(match[1]),
    row = Number(match[2]);
  if (column > MAX_COLUMNS || row > MAX_ROWS)
    throw new Error(`单元格 ${address} 超出支持范围（${MAX_ROWS} 行、${MAX_COLUMNS} 列）。`);
  return { column, row };
}
export function parseRange(range: string) {
  const parts = range.split(':');
  if (parts.length !== 2) throw new Error(`范围请填写为 A1:D20：${range}`);
  const start = parseAddress(parts[0]),
    end = parseAddress(parts[1]);
  if (start.row > end.row || start.column > end.column)
    throw new Error(`范围起点应位于终点左上方：${range}`);
  return { start, end };
}
export const sourceId = (sheet: string, address: string) => `${sheet}!${address}`;

export function validateSheets(sheets: SheetData[]) {
  const names = new Set<string>();
  let count = 0,
    chars = 0;
  for (const sheet of sheets) {
    if (names.has(sheet.name)) throw new Error('工作表名称重复。');
    names.add(sheet.name);
    const addresses = new Set<string>();
    for (const cell of sheet.cells) {
      const pos = parseAddress(cell.address);
      if (pos.row !== cell.row || pos.column !== cell.column || addresses.has(cell.address))
        throw new Error('表格单元格坐标不一致或重复。');
      addresses.add(cell.address);
      count++;
      chars += cell.text.length;
    }
  }
  if (!count) throw new Error('选中的工作表没有可用数据。');
  if (count > MAX_CELLS || chars > 500_000)
    throw new Error('表格内容超过单次分析上限，请缩小所选工作表。');
}

export function validatePlan(plan: Plan, sheets: SheetData[]) {
  const ids = new Set<string>(),
    labels = new Set<string>();
  const data = new Map(sheets.map((s) => [s.name, s]));
  const ranges: Array<
    ReturnType<typeof parseRange> & {
      sheet: string;
      range: string;
      label: string;
    }
  > = [];
  for (const zone of plan.zones) {
    if (ids.has(zone.id) || labels.has(zone.label))
      throw new Error('分区名称或 ID 重复，请合并同一区域。');
    ids.add(zone.id);
    labels.add(zone.label);
    if ((zone.rows === null) !== (zone.columns === null))
      throw new Error(`${zone.label} 的排数与列数需要同时填写或同时留空。`);
    if (
      zone.bbox &&
      (zone.bbox.x + zone.bbox.width > 1.001 || zone.bbox.y + zone.bbox.height > 1.001)
    )
      throw new Error(`${zone.label} 的图片位置超出画面。`);
    for (const source of zone.sources) {
      const sheet = data.get(source.sheet);
      if (!sheet) throw new Error(`${zone.label} 引用了不存在的工作表：${source.sheet}`);
      const { start, end } = parseRange(source.range);
      const overlap = ranges.find(
        (previous) =>
          previous.sheet === source.sheet &&
          start.row <= previous.end.row &&
          end.row >= previous.start.row &&
          start.column <= previous.end.column &&
          end.column >= previous.start.column,
      );
      if (overlap)
        throw new Error(
          `${source.sheet}!${source.range} 与 ${overlap.label} 的范围 ${overlap.range} 重叠，不能同时用于多个分区或重复范围。`,
        );
      ranges.push({
        start,
        end,
        sheet: source.sheet,
        range: source.range,
        label: zone.label,
      });
      if (
        !sheet.cells.some(
          (c) =>
            c.row >= start.row &&
            c.row <= end.row &&
            c.column >= start.column &&
            c.column <= end.column,
        )
      )
        throw new Error(`${zone.label} 的范围 ${source.range} 没有数据。`);
      if (source.mode === 'table') {
        if (!source.nameColumn) throw new Error(`${zone.label} 的名单模式需要指定姓名列。`);
        const cols = [
          source.nameColumn,
          source.phoneColumn,
          source.organizationColumn,
          source.titleColumn,
        ].filter((c): c is string => !!c);
        if (new Set(cols).size !== cols.length)
          throw new Error(`${zone.label} 的名单字段不能指向同一列。`);
        for (const col of cols)
          if (columnNumber(col) < start.column || columnNumber(col) > end.column)
            throw new Error(`${zone.label} 的字段列 ${col} 不在范围内。`);
      }
    }
  }
  const excluded = new Set<string>();
  for (const ignored of plan.ignoredCells) {
    const id = sourceId(ignored.sheet, ignored.address);
    if (excluded.has(id)) throw new Error('忽略单元格重复。');
    excluded.add(id);
    if (!data.get(ignored.sheet)?.cells.some((c) => c.address === ignored.address))
      throw new Error('忽略列表引用了不存在的单元格。');
  }
}

export interface RosterOptions {
  overrides?: Record<string, PersonOverride>;
  excluded?: string[];
  manualAssignments?: Record<string, string>;
}
export function buildRoster(plan: Plan, sheets: SheetData[], options: RosterOptions = {}) {
  validateSheets(sheets);
  validatePlan(plan, sheets);
  const consumed = new Set<string>();
  const fieldCells = new Set<string>();
  const excluded = new Set([
    ...plan.ignoredCells.map((c) => sourceId(c.sheet, c.address)),
    ...(options.excluded || []),
  ]);
  const records = new Map<string, Person>();
  const errors: string[] = [];
  const getSheet = (name: string) => sheets.find((s) => s.name === name)!;
  const makePerson = (
    sheet: string,
    cell: SourceCell,
    zoneId: string,
    zone: string,
    extra: Partial<RosterFields> = {},
  ) => {
    const id = sourceId(sheet, cell.address);
    if (records.has(id)) {
      errors.push(`${id} 同时落入多个分区或重复范围。`);
      return;
    }
    if (!excluded.has(id))
      records.set(id, {
        id,
        name: cell.text.trim(),
        phone: '',
        organization: '',
        title: '',
        zone,
        zoneId,
        sourceSheet: sheet,
        sourceAddress: cell.address,
        ...extra,
      });
  };
  for (const zone of plan.zones)
    for (const range of zone.sources) {
      const sheet = getSheet(range.sheet),
        bounds = parseRange(range.range);
      const cells = sheet.cells.filter(
        (c) =>
          c.row >= bounds.start.row &&
          c.row <= bounds.end.row &&
          c.column >= bounds.start.column &&
          c.column <= bounds.end.column,
      );
      if (range.mode === 'grid') {
        for (const cell of cells.sort((a, b) => a.row - b.row || a.column - b.column)) {
          const id = sourceId(sheet.name, cell.address);
          consumed.add(id);
          makePerson(sheet.name, cell, zone.id, zone.label);
        }
      } else {
        // A table has one person per row; only its name column can create a person.
        const nameColumn = columnNumber(range.nameColumn!);
        for (const cell of cells)
          if (cell.column !== nameColumn) fieldCells.add(sourceId(sheet.name, cell.address));
        const lookup = new Map(sheet.cells.map((c) => [c.address, c]));
        for (let row = bounds.start.row; row <= bounds.end.row; row++) {
          const cell = lookup.get(`${range.nameColumn}${row}`);
          if (!cell) continue;
          // Excluding a person also accounts for the mapped fields in that row.
          const fields: Partial<RosterFields> = {};
          for (const [field, col] of [
            ['phone', range.phoneColumn],
            ['organization', range.organizationColumn],
            ['title', range.titleColumn],
          ] as const) {
            const value = col ? lookup.get(`${col}${row}`) : undefined;
            if (value) {
              fields[field] = value.text;
              consumed.add(sourceId(sheet.name, value.address));
            }
          }
          consumed.add(sourceId(sheet.name, cell.address));
          makePerson(sheet.name, cell, zone.id, zone.label, fields);
        }
      }
    }
  for (const [id, zoneId] of Object.entries(options.manualAssignments || {})) {
    if (consumed.has(id) || fieldCells.has(id) || excluded.has(id)) continue;
    const zone = plan.zones.find((z) => z.id === zoneId);
    if (!zone) continue;
    for (const sheet of sheets) {
      const cell = sheet.cells.find((c) => sourceId(sheet.name, c.address) === id);
      if (cell) {
        makePerson(sheet.name, cell, zone.id, zone.label);
        consumed.add(id);
        break;
      }
    }
  }
  const people = [...records.values()].map((person) => {
    const edited = { ...person, ...options.overrides?.[person.id] };
    const zone =
      plan.zones.find((z) => z.id === edited.zoneId) ||
      plan.zones.find((z) => z.id === person.zoneId)!;
    if (!edited.name.trim()) errors.push(`${person.id} 的姓名为空。`);
    return { ...edited, zoneId: zone.id, zone: zone.label };
  });
  const unassigned = sheets.flatMap((s) =>
    s.cells
      .filter(
        (c) =>
          !consumed.has(sourceId(s.name, c.address)) && !excluded.has(sourceId(s.name, c.address)),
      )
      .map((c) => ({
        ...c,
        sheet: s.name,
        id: sourceId(s.name, c.address),
        assignable: !fieldCells.has(sourceId(s.name, c.address)),
      })),
  );
  const duplicates = new Set<string>();
  const names = new Map<string, number>();
  for (const p of people) names.set(p.name, (names.get(p.name) || 0) + 1);
  for (const [name, count] of names) if (count > 1) duplicates.add(name);
  const annotated = people.filter((p) => /[（(]|待定|未知/.test(p.name));
  const zones = plan.zones.map((zone) => {
    const count = people.filter((p) => p.zoneId === zone.id).length;
    const capacity = zone.rows && zone.columns ? zone.rows * zone.columns : null;
    return {
      ...zone,
      count,
      capacity,
      overflow: capacity !== null && count > capacity ? count - capacity : 0,
      shortfall: capacity !== null && count < capacity ? capacity - count : 0,
      capacityStatus:
        capacity === null
          ? 'unknown'
          : count === capacity
            ? 'matched'
            : count > capacity
              ? 'overflow'
              : 'shortfall',
    };
  });
  return {
    people,
    unassigned,
    duplicates,
    annotated,
    zones,
    errors: [...new Set(errors)],
  };
}

export type RosterReview = ReturnType<typeof buildRoster>;

export function reconcileRosterOptions(
  plan: Plan,
  sheets: SheetData[],
  options: RosterOptions,
): RosterOptions {
  const zoneIds = new Set(plan.zones.map((zone) => zone.id));
  const cellIds = new Set(
    sheets.flatMap((sheet) => sheet.cells.map((cell) => sourceId(sheet.name, cell.address))),
  );
  const current = buildRoster(plan, sheets);
  const available = new Set(
    current.unassigned.filter((cell) => cell.assignable).map((cell) => cell.id),
  );
  const excluded = [...new Set(options.excluded || [])].filter((id) => cellIds.has(id));
  const manualAssignments = Object.fromEntries(
    Object.entries(options.manualAssignments || {}).filter(
      ([id, zoneId]) => available.has(id) && zoneIds.has(zoneId) && !excluded.includes(id),
    ),
  );
  const personIds = new Set([
    ...current.people.map((person) => person.id),
    ...Object.keys(manualAssignments),
  ]);
  const overrides: Record<string, PersonOverride> = {};
  for (const [id, override] of Object.entries(options.overrides || {})) {
    if (!cellIds.has(id)) continue;
    const { zoneId, ...fields } = override;
    const next =
      zoneId && zoneIds.has(zoneId) && personIds.has(id) ? { ...fields, zoneId } : fields;
    if (Object.keys(next).length) overrides[id] = next;
  }
  return { overrides, excluded, manualAssignments };
}
