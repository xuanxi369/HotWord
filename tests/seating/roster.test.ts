import { describe, it, expect } from 'vitest';
import { buildRoster, parseAddress, validateSheets } from '../../src/seating/lib/roster';
import { forumFixture } from './fixtures';

describe('原表驱动的人员库', () => {
  it('保留 242 条记录，提示图片 212 座的容量差异', () => {
    const { plan, sheets } = forumFixture();
    const result = buildRoster(plan, sheets);
    expect(result.people).toHaveLength(242);
    expect(result.zones.map((z) => z.count)).toEqual([22, 67, 90, 63]);
    expect(result.zones.map((z) => z.overflow)).toEqual([2, 7, 18, 3]);
    expect(result.unassigned).toHaveLength(0);
    expect(result.errors).toEqual([]);
    expect(result.people.every((p) => !p.phone && !p.organization && !p.title)).toBe(true);
  });
  it('保留重名和括号备注，不按姓名去重', () => {
    const { plan, sheets } = forumFixture();
    const result = buildRoster(plan, sheets);
    expect(result.duplicates.size).toBe(1);
    expect(result.annotated).toHaveLength(1);
    expect(new Set(result.people.map((p) => p.id)).size).toBe(242);
  });
  it('范围遗漏形成未归档数据，不能悄悄消失', () => {
    const { plan, sheets } = forumFixture();
    plan.zones[0].sources[0].range = 'Y6:AS6';
    const result = buildRoster(plan, sheets);
    expect(result.unassigned.map((c) => c.address)).toEqual(['X6']);
    const fixed = buildRoster(plan, sheets, { manualAssignments: { '测试座次表!X6': 'A' } });
    expect(fixed.people).toHaveLength(242);
    expect(fixed.unassigned).toHaveLength(0);
  });
  it('同一个来源单元格落入两个分区时报告错误', () => {
    const { plan, sheets } = forumFixture();
    plan.zones[1].sources.push({ ...plan.zones[0].sources[0] });
    expect(() => buildRoster(plan, sheets)).toThrow('多个分区');
  });
  it('拒绝不存在的工作表、坐标和字段列', () => {
    const { plan, sheets } = forumFixture();
    plan.zones[0].sources[0].sheet = '不存在';
    expect(() => buildRoster(plan, sheets)).toThrow('不存在的工作表');
    expect(() => parseAddress('XFD999999')).toThrow('超出支持范围');
    expect(() =>
      validateSheets([
        { name: '测试', cells: [{ address: 'A1', row: 2, column: 1, text: '测试' }] },
      ]),
    ).toThrow('坐标');
  });
  it('名单模式按列读取五字段，保留缺失值与前导零', () => {
    const { plan } = forumFixture();
    plan.zones = [
      {
        ...plan.zones[0],
        sources: [
          {
            sheet: '名单',
            range: 'A2:E3',
            mode: 'table',
            nameColumn: 'A',
            phoneColumn: 'B',
            organizationColumn: 'C',
            titleColumn: 'D',
          },
        ],
      },
    ];
    const sheets = [
      {
        name: '名单',
        cells: [
          { address: 'A2', row: 2, column: 1, text: '测试一' },
          { address: 'B2', row: 2, column: 2, text: '00123456789' },
          { address: 'C2', row: 2, column: 3, text: '测试单位' },
          { address: 'D2', row: 2, column: 4, text: '测试职务' },
          { address: 'A3', row: 3, column: 1, text: '测试二' },
        ],
      },
    ];
    const result = buildRoster(plan, sheets);
    expect(result.people[0]).toMatchObject({
      name: '测试一',
      phone: '00123456789',
      organization: '测试单位',
      title: '测试职务',
      zone: 'A区',
    });
    expect(result.people[1].phone).toBe('');
    expect(result.unassigned).toEqual([]);
    const excluded = buildRoster(plan, sheets, { excluded: ['名单!A2'] });
    expect(excluded.people.map((p) => p.name)).toEqual(['测试二']);
    expect(excluded.unassigned).toEqual([]);
    expect(buildRoster(plan, sheets).people).toEqual(result.people);
  });
  it('编辑、排除和分区调整通过来源 ID 关联', () => {
    const { plan, sheets } = forumFixture();
    const id = '测试座次表!X6';
    const changed = buildRoster(plan, sheets, {
      overrides: { [id]: { name: '人工校正', zoneId: 'B' } },
    });
    expect(changed.people.find((p) => p.id === id)).toMatchObject({
      name: '人工校正',
      zoneId: 'B',
    });
    expect(buildRoster(plan, sheets, { excluded: [id] }).people).toHaveLength(241);
  });
});
