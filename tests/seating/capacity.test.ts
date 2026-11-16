import { describe, expect, it } from 'vitest';
import { buildRoster } from '../../src/seating/lib/roster';
import { demoData } from '../../src/seating/lib/demo';

describe('容量差异核对', () => {
  it('排除一人后显示少员；恢复后容量重新匹配', () => {
    const { plan, sheets } = demoData();
    const reduced = buildRoster(plan, sheets, { excluded: ['示例座次表!E2'] });
    expect(reduced.zones[0]).toMatchObject({
      count: 3,
      capacity: 4,
      shortfall: 1,
      overflow: 0,
      capacityStatus: 'shortfall',
    });
    expect(buildRoster(plan, sheets).zones[0]).toMatchObject({
      count: 4,
      shortfall: 0,
      capacityStatus: 'matched',
    });
  });
  it('人工移动同时更新两个区域的少员与超员状态，人数不丢失', () => {
    const { plan, sheets } = demoData();
    const moved = buildRoster(plan, sheets, {
      overrides: { '示例座次表!E2': { zoneId: 'B' } },
    });
    expect(moved.people).toHaveLength(25);
    expect(moved.zones[0]).toMatchObject({
      shortfall: 1,
      capacityStatus: 'shortfall',
    });
    expect(moved.zones[1]).toMatchObject({
      overflow: 1,
      capacityStatus: 'overflow',
    });
  });
  it('空分区仍提示少员；容量未知时不推断匹配', () => {
    const { plan, sheets } = demoData();
    const empty = buildRoster(plan, sheets, {
      excluded: ['E2', 'F2', 'G2', 'H2'].map((address) => '示例座次表!' + address),
    });
    expect(empty.zones[0]).toMatchObject({
      count: 0,
      shortfall: 4,
      capacityStatus: 'shortfall',
    });
    plan.zones[0].rows = null;
    plan.zones[0].columns = null;
    expect(buildRoster(plan, sheets).zones[0]).toMatchObject({
      capacity: null,
      shortfall: 0,
      overflow: 0,
      capacityStatus: 'unknown',
    });
  });
});
