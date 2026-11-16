import type { ModelSelection } from '../../../shared/models';
import { api } from '../../api';
import { useCallback, useMemo, useRef, useState } from 'react';
import { buildRoster, reconcileRosterOptions, sourceId, validateSheets } from '../lib/roster';
import {
  planSchema,
  type AnalysisResult,
  type Person,
  type PersonOverride,
  type Plan,
} from '../lib/schema';
import { createManualPlan, emptyWorkspace, type Workspace } from '../lib/workspace';
import { demoData } from '../lib/demo';
import { downloadRoster, readExcelFile } from '../lib/excel';
import { prepareImage } from '../lib/image';

const clearedEdits = { overrides: {}, excluded: [], manualAssignments: {} };
export function useRosterWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [view, setView] = useState<'upload' | 'review'>('upload');
  const [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [acknowledged, setAcknowledged] = useState(false),
    [exported, setExported] = useState(false);
  const revision = useRef(0);
  const locked = useRef(false);

  const update = useCallback(
    (change: Partial<Workspace> | ((previous: Workspace) => Workspace)) => {
      ++revision.current;
      setWorkspace((previous) =>
        typeof change === 'function' ? change(previous) : { ...previous, ...change },
      );
      setAcknowledged(false);
      setExported(false);
      setNotice('');
    },
    [],
  );
  const restoreWorkspace = useCallback(
    (saved: Workspace) => {
      update(saved);
      setView(saved.plan ? 'review' : 'upload');
      setError('');
    },
    [update],
  );
  const reset = useCallback(() => {
    update(emptyWorkspace());
    setView('upload');
    setError('');
  }, [update]);
  const activeSheets = useMemo(
    () => workspace.sheets.filter((sheet) => workspace.selectedSheets.includes(sheet.name)),
    [workspace.sheets, workspace.selectedSheets],
  );
  const calculated = useMemo(() => {
    if (!workspace.plan) return { data: null, error: '' };
    try {
      return {
        data: buildRoster(workspace.plan, activeSheets, workspace),
        error: '',
      };
    } catch (failure) {
      return {
        data: null,
        error: failure instanceof Error ? failure.message : '请检查分区。',
      };
    }
  }, [
    workspace.plan,
    activeSheets,
    workspace.overrides,
    workspace.excluded,
    workspace.manualAssignments,
  ]);
  const review = calculated.data;
  const ignoredCells = useMemo(() => {
    const ignored = new Set([
      ...workspace.excluded,
      ...(workspace.plan?.ignoredCells.map((cell) => sourceId(cell.sheet, cell.address)) || []),
    ]);
    return activeSheets.flatMap((sheet) =>
      sheet.cells
        .filter((cell) => ignored.has(sourceId(sheet.name, cell.address)))
        .map((cell) => ({
          ...cell,
          sheet: sheet.name,
          id: sourceId(sheet.name, cell.address),
        })),
    );
  }, [workspace.excluded, workspace.plan, activeSheets]);

  async function upload(file: File, kind: 'excel' | 'image') {
    if (locked.current) return;
    locked.current = true;
    setReading(true);
    setError('');
    try {
      if (kind === 'excel') {
        const sheets = await readExcelFile(file);
        update({
          sheets,
          selectedSheets: sheets.map((sheet) => sheet.name),
          excelName: file.name,
          plan: null,
          demo: false,
          ...clearedEdits,
        });
      } else {
        update({
          image: await prepareImage(file),
          imageName: file.name,
          plan: null,
          demo: false,
          ...clearedEdits,
        });
      }
      setView('upload');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法读取文件。');
    } finally {
      locked.current = false;
      setReading(false);
    }
  }
  function loadDemo() {
    if (locked.current) return;
    const data = demoData();
    update({
      ...emptyWorkspace(),
      ...data,
      selectedSheets: data.sheets.map((sheet) => sheet.name),
      excelName: '示例座次表.xlsx',
      imageName: '示例会场座次图',
      image: '/seating-demo-venue.svg',
      demo: true,
      resultModel: '示例数据 · 未调用 AI',
    });
    setView('review');
    setError('');
  }
  async function analyze(selection: ModelSelection) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 105_000);
    try {
      validateSheets(activeSheets);
      if (!workspace.image || workspace.image.startsWith('/'))
        throw new Error('请先上传会场图片。示例图片仅用于演示。');
      const result = await api<AnalysisResult>('/api/seating/analyze', {
        method: 'POST',
        body: JSON.stringify({ selection, image: workspace.image, sheets: activeSheets, notes: workspace.notes }),
        signal: controller.signal,
      });
      const plan = planSchema.parse(result.plan),
        built = buildRoster(plan, activeSheets);
      if (built.errors.length) throw new Error(built.errors[0]);
      update({
        plan,
        ...clearedEdits,
        demo: false,
        resultModel: result.provider + ' · ' + result.model,
      });
      setView('review');
    } catch (failure) {
      setError(
        controller.signal.aborted
          ? '识别等待超时，请稍后重试或手动分区。'
          : failure instanceof Error
            ? failure.message
            : '识别失败，请重试。',
      );
    } finally {
      clearTimeout(timeout);
      locked.current = false;
      setBusy(false);
    }
  }
  function startManual(): boolean {
    if (locked.current) return false;
    setError('');
    try {
      validateSheets(activeSheets);
      update({
        plan: createManualPlan(activeSheets),
        ...clearedEdits,
        demo: false,
        resultModel: '手动整理 · 未调用 AI',
      });
      setView('review');
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '请先上传表格。');
      return false;
    }
  }
  function savePlan(plan: Plan) {
    const next = reconcileRosterOptions(plan, activeSheets, workspace);
    update({
      plan,
      overrides: next.overrides || {},
      excluded: next.excluded || [],
      manualAssignments: next.manualAssignments || {},
    });
    setError('');
  }
  function editPerson(person: Person, key: keyof PersonOverride, value: string) {
    update((previous) => ({
      ...previous,
      overrides: {
        ...previous.overrides,
        [person.id]: { ...previous.overrides[person.id], [key]: value },
      },
    }));
  }
  const exclude = (id: string) =>
    update((previous) => ({
      ...previous,
      excluded: [...new Set([...previous.excluded, id])],
    }));
  function restore(id: string) {
    update((previous) => ({
      ...previous,
      excluded: previous.excluded.filter((item) => item !== id),
      plan: previous.plan
        ? {
            ...previous.plan,
            ignoredCells: previous.plan.ignoredCells.filter(
              (cell) => sourceId(cell.sheet, cell.address) !== id,
            ),
          }
        : null,
    }));
  }
  const assign = (id: string, zoneId: string) =>
    update((previous) => ({
      ...previous,
      manualAssignments: { ...previous.manualAssignments, [id]: zoneId },
    }));
  function toggleSheet(name: string, checked: boolean) {
    update((previous) => ({
      ...previous,
      selectedSheets: checked
        ? [...new Set([...previous.selectedSheets, name])]
        : previous.selectedSheets.filter((item) => item !== name),
      plan: null,
      ...clearedEdits,
    }));
  }
  async function exportExcel() {
    if (
      !review ||
      !acknowledged ||
      review.errors.length ||
      review.unassigned.length ||
      !review.people.length ||
      exporting
    )
      return;
    const currentRevision = revision.current;
    const people = review.people.map((person) => ({ ...person }));
    setExporting(true);
    setError('');
    try {
      await downloadRoster(people);
      if (revision.current === currentRevision) {
        setExported(true);
        setNotice('人员库已导出，包含当前核对后的全部记录。');
      } else {
        setNotice('已导出点击导出时的完整名单；当前数据已修改，请重新核对后再次导出。');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  }
  return {
    workspace,
    activeSheets,
    review,
    calculated,
    ignoredCells,
    view,
    setView,
    reading,
    busy,
    exporting,
    error,
    setError,
    notice,
    acknowledged,
    setAcknowledged,
    exported,
    restoreWorkspace,
    reset,
    uploadExcel: (file: File) => upload(file, 'excel'),
    uploadImage: (file: File) => upload(file, 'image'),
    loadDemo,
    analyze,
    startManual,
    savePlan,
    editPerson,
    exclude,
    restore,
    assign,
    toggleSheet,
    exportExcel,
    setNotes: (notes: string) => update({ notes }),
  };
}
export type RosterWorkspace = ReturnType<typeof useRosterWorkspace>;
