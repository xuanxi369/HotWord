import { describe, expect, it, vi } from 'vitest';
import {
  browserDraftStore,
  createDraft,
  createDraftQueue,
  parseDraft,
  type Draft,
  type DraftStore,
} from '../../src/seating/lib/drafts';
import { emptyWorkspace, type Workspace } from '../../src/seating/lib/workspace';
import { buildRoster } from '../../src/seating/lib/roster';
import { demoData } from '../../src/seating/lib/demo';

function fixture(): Workspace {
  const { sheets, plan } = demoData();
  sheets[0].cells.push({
    address: 'A9',
    row: 9,
    column: 1,
    text: '额外测试人员',
  });
  return {
    ...emptyWorkspace(),
    sheets,
    plan,
    selectedSheets: [sheets[0].name],
    excelName: '测试.xlsx',
    image: '/seating-demo-venue.svg',
    imageName: '测试图片',
    resultModel: '手动整理',
    notes: '待核对',
    demo: true,
    overrides: {
      '示例座次表!E2': { name: '人工校正', phone: '00123456789', zoneId: 'B' },
    },
    excluded: ['示例座次表!F2'],
    manualAssignments: { '示例座次表!A9': 'C' },
  };
}
describe('本机草稿', () => {
  it('往返保存图片、原表、分区与人工修改，恢复后的完整名单相同', () => {
    const workspace = fixture();
    const restored = parseDraft(JSON.parse(JSON.stringify(createDraft(workspace)))).workspace;
    expect(restored).toEqual(workspace);
    expect(buildRoster(restored.plan!, restored.sheets, restored)).toEqual(
      buildRoster(workspace.plan!, workspace.sheets, workspace),
    );
  });
  it('存储白名单排除访问口令、密钥、导出确认与连接状态', () => {
    const draft = createDraft({
      ...fixture(),
      token: 'private-access-token',
      apiKey: 'private-api-key',
      acknowledged: true,
      exported: true,
    } as Workspace);
    const content = JSON.stringify(draft);
    expect(content).not.toContain('private-access-token');
    expect(content).not.toContain('private-api-key');
    expect(content).not.toContain('acknowledged');
    expect(content).not.toContain('exported');
  });
  it.each(['version', 'coordinates', 'selection', 'references', 'unknown-key'])(
    '拒绝损坏草稿：%s',
    (kind) => {
      const draft = createDraft(fixture()) as any;
      if (kind === 'version') draft.version = 99;
      if (kind === 'coordinates') draft.workspace.sheets[0].cells[0].row = 900;
      if (kind === 'selection') draft.workspace.selectedSheets = ['不存在'];
      if (kind === 'references') draft.workspace.plan.zones[0].sources[0].sheet = '不存在';
      if (kind === 'unknown-key') draft.workspace.token = 'unsafe';
      expect(() => parseDraft(draft)).toThrow('草稿格式无效');
    },
  );
  it('保留尚未修完的空姓名，恢复后继续阻止导出', () => {
    const workspace = fixture();
    workspace.overrides['示例座次表!E2'].name = '';
    const restored = parseDraft(createDraft(workspace)).workspace;
    expect(buildRoster(restored.plan!, restored.sheets, restored).errors[0]).toContain('姓名为空');
  });
  it('慢写入与后续清除严格串行，旧写入不会复活草稿', async () => {
    let release!: () => void,
      saved: Draft | null = null;
    const store: DraftStore = {
      read: async () => saved,
      write: vi.fn(async (draft) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        saved = draft;
      }),
      remove: vi.fn(async () => {
        saved = null;
      }),
    };
    const queue = createDraftQueue(store);
    const write = queue.write(createDraft(fixture()));
    const remove = queue.remove();
    await Promise.resolve();
    expect(store.remove).not.toHaveBeenCalled();
    release();
    await write;
    await remove;
    expect(saved).toBeNull();
  });
  it('存储失败会报告错误，后续重试仍能成功', async () => {
    const store: DraftStore = {
      read: async () => undefined,
      remove: async () => {},
      write: vi.fn().mockRejectedValueOnce(new Error('Quota')).mockResolvedValueOnce(undefined),
    };
    const queue = createDraftQueue(store);
    await expect(queue.write(createDraft(fixture()))).rejects.toThrow('Quota');
    await expect(queue.write(createDraft(fixture()))).resolves.toBeUndefined();
  });
  it('不支持 IndexedDB 时明确失败，不假报已保存', async () => {
    await expect(browserDraftStore.read()).rejects.toThrow('无法保存本机草稿');
  });
});
