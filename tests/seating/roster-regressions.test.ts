import { describe, it, expect } from 'vitest';
import { buildRoster, reconcileRosterOptions } from '../../src/seating/lib/roster';
import type { Plan, SheetData, SourceRange, Zone } from '../../src/seating/lib/schema';

const source = (range: string, mode: 'grid' | 'table' = 'grid'): SourceRange => ({
  sheet: '名单', range, mode,
  nameColumn: mode === 'table' ? 'A' : null,
  phoneColumn: mode === 'table' ? 'B' : null,
  organizationColumn: mode === 'table' ? 'C' : null,
  titleColumn: mode === 'table' ? 'D' : null,
});
const zone = (id: string, sources: SourceRange[]): Zone => ({
  id, label: `${id}区`, position: '', rows: null, columns: null,
  direction: 'unknown', confidence: 'high', bbox: null, sources,
});
const plan = (zones: Zone[]): Plan => ({ summary: '', warnings: [], ignoredCells: [], zones });
const listSheets: SheetData[] = [{ name: '名单', cells: [
  { address: 'A2', row: 2, column: 1, text: '张三' },
  { address: 'B2', row: 2, column: 2, text: '00123456789' },
  { address: 'C2', row: 2, column: 3, text: '测试单位' },
  { address: 'D2', row: 2, column: 4, text: '测试职务' },
] }];
function editsFixture() {
  return {
    plan: plan([zone('A', [source('A2:A2')]), zone('B', [source('B2:B2')])]),
    sheets: [{ name: '名单', cells: [
      { address: 'A2', row: 2, column: 1, text: '张三' },
      { address: 'B2', row: 2, column: 2, text: '李四' },
      { address: 'C2', row: 2, column: 3, text: '王五' },
    ] }],
  };
}

describe('来源占用与名单字段', () => {
  it.each(['B2', 'C2', 'D2'])('拒绝名单字段 %s 被另一个网格来源重复使用，不受分区顺序影响', (address) => {
    const zones = [zone('A', [source('A2:D2', 'table')]), zone('B', [source(`${address}:${address}`)])];
    expect(() => buildRoster(plan(zones), listSheets)).toThrow('重叠');
    expect(() => buildRoster(plan([...zones].reverse()), listSheets)).toThrow('重叠');
  });
  it('同一区域内的重复来源也不能绕过占用检查', () => {
    expect(() => buildRoster(plan([zone('A', [source('A2:D2', 'table'), source('B2:B2')])]), listSheets))
      .toThrow('重复范围');
  });
  it('范围交叉处为空白时仍拒绝重叠，避免后续数据填入后被重复读取', () => {
    const sheets: SheetData[] = [{ name: '名单', cells: [
      { address: 'A2', row: 2, column: 1, text: '张三' },
      { address: 'C3', row: 3, column: 3, text: '李四' },
    ] }];
    expect(() => buildRoster(plan([
      zone('A', [source('A2:B2')]), zone('B', [source('B2:C3')]),
    ]), sheets)).toThrow('重叠');
  });
  it.each(['B2', 'C2', 'D2'])('修改为名单模式后，旧手动归档 %s 不再生成额外人员', (address) => {
    const nextPlan = plan([zone('A', [source('A2:D2', 'table')])]);
    const options = { manualAssignments: { [`名单!${address}`]: 'A' } };
    const result = buildRoster(nextPlan, listSheets, options);
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ name: '张三', phone: '00123456789', organization: '测试单位', title: '测试职务' });
    expect(result.unassigned).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(reconcileRosterOptions(nextPlan, listSheets, options).manualAssignments).toEqual({});
  });
  it('缺少姓名的名单行保留字段供核对，但不能手动把手机号当成人员', () => {
    const sheets: SheetData[] = [{ name: '名单', cells: [
      ...listSheets[0].cells, { address: 'B3', row: 3, column: 2, text: '13800138000' },
    ] }];
    const nextPlan = plan([zone('A', [source('A2:D3', 'table')])]);
    const options = { manualAssignments: { '名单!B3': 'A' } };
    const result = buildRoster(nextPlan, sheets, options);
    expect(result.people.map((person) => person.name)).toEqual(['张三']);
    expect(result.unassigned).toMatchObject([{ id: '名单!B3', text: '13800138000', assignable: false }]);
    expect(reconcileRosterOptions(nextPlan, sheets, options).manualAssignments).toEqual({});
    expect(buildRoster(nextPlan, sheets, { excluded: ['名单!B3'] }).unassigned).toEqual([]);
  });
  it('名单范围内未映射的非姓名列也保留核对，不能手动另生成一人', () => {
    const sheets: SheetData[] = [{ name: '名单', cells: [
      ...listSheets[0].cells, { address: 'E2', row: 2, column: 5, text: '签到备注' },
    ] }];
    const nextPlan = plan([zone('A', [source('A2:E2', 'table')])]);
    const options = { manualAssignments: { '名单!E2': 'A' } };
    const result = buildRoster(nextPlan, sheets, options);
    expect(result.people.map((person) => person.name)).toEqual(['张三']);
    expect(result.unassigned).toMatchObject([{ id: '名单!E2', text: '签到备注', assignable: false }]);
    expect(reconcileRosterOptions(nextPlan, sheets, options).manualAssignments).toEqual({});
  });
});

describe('分区调整后的人工编辑', () => {
  it('重命名分区保留已移动人员和手动归档人员，并使用最新名称统计', () => {
    const { plan, sheets } = editsFixture();
    const options = {
      overrides: { '名单!A2': { zoneId: 'B', name: '张三校正' } },
      manualAssignments: { '名单!C2': 'B' },
    };
    plan.zones[1].label = '贵宾区';
    const next = reconcileRosterOptions(plan, sheets, options);
    const result = buildRoster(plan, sheets, next);
    expect(result.errors).toEqual([]);
    expect(result.people.find((person) => person.id === '名单!A2')).toMatchObject({ name: '张三校正', zoneId: 'B', zone: '贵宾区' });
    expect(result.people.find((person) => person.id === '名单!C2')).toMatchObject({ zoneId: 'B', zone: '贵宾区' });
    expect(result.zones.map((zone) => zone.count)).toEqual([0, 3]);
  });
  it('删除分区清理失效归属，保留字段编辑与排除状态，未归档人员可重新分配', () => {
    const { plan, sheets } = editsFixture();
    const options = {
      overrides: {
        '名单!A2': { zoneId: 'B', name: '张三校正', phone: '00123456789' },
        '名单!C2': { zoneId: 'B', name: '王五校正' },
      },
      excluded: ['名单!B2'], manualAssignments: { '名单!C2': 'B' },
    };
    plan.zones = [plan.zones[0]];
    const next = reconcileRosterOptions(plan, sheets, options);
    expect(next.overrides).toEqual({
      '名单!A2': { name: '张三校正', phone: '00123456789' }, '名单!C2': { name: '王五校正' },
    });
    expect(next.excluded).toEqual(['名单!B2']);
    expect(next.manualAssignments).toEqual({});
    const result = buildRoster(plan, sheets, next);
    expect(result.people).toMatchObject([{ name: '张三校正', phone: '00123456789', zoneId: 'A' }]);
    expect(result.errors).toEqual([]);
    expect(result.unassigned.map((cell) => cell.id)).toEqual(['名单!C2']);
    const reassigned = buildRoster(plan, sheets, { ...next, manualAssignments: { '名单!C2': 'A' } });
    expect(reassigned.people.find((person) => person.id === '名单!C2')).toMatchObject({ name: '王五校正', zoneId: 'A' });
    expect(reassigned.unassigned).toEqual([]);
  });
  it('删除来源后清理旧人工移动，重新归档时采用新选择的区域', () => {
    const { plan, sheets } = editsFixture();
    const options = { overrides: { '名单!B2': { zoneId: 'A', name: '李四校正' } } };
    plan.zones[1].sources = [source('C2:C2')];
    const next = reconcileRosterOptions(plan, sheets, options);
    const result = buildRoster(plan, sheets, { ...next, manualAssignments: { '名单!B2': 'B' } });
    expect(result.people.find((person) => person.id === '名单!B2')).toMatchObject({ name: '李四校正', zoneId: 'B' });
    expect(result.unassigned).toEqual([]);
  });
  it('来源尚未覆盖的有效手动归档及其人工移动在应用分区后保留', () => {
    const { plan, sheets } = editsFixture();
    const options = { manualAssignments: { '名单!C2': 'A' }, overrides: { '名单!C2': { zoneId: 'B' } } };
    const result = buildRoster(plan, sheets, reconcileRosterOptions(plan, sheets, options));
    expect(result.people.find((person) => person.id === '名单!C2')).toMatchObject({ zoneId: 'B' });
    expect(result.unassigned).toEqual([]);
  });
  it('未同步的失效手动归档也会返回待归档状态，不阻塞其他记录', () => {
    const { plan, sheets } = editsFixture();
    const result = buildRoster(plan, sheets, { manualAssignments: { '名单!C2': 'deleted-zone' } });
    expect(result.errors).toEqual([]);
    expect(result.unassigned.map((cell) => cell.id)).toEqual(['名单!C2']);
  });
});
