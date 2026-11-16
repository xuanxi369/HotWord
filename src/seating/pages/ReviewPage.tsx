import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import type { RosterWorkspace } from '../hooks/useRosterWorkspace';
import { ZoneOverview } from '../components/ZoneOverview';
import { ReviewIssues } from '../components/ReviewIssues';
import { RosterTable } from '../components/RosterTable';
import { UnassignedPanel } from '../components/UnassignedPanel';
import { IgnoredPanel } from '../components/IgnoredPanel';
import { SourcePreview } from '../components/SourcePreview';

export function ReviewPage({ work, onMapping }: { work: RosterWorkspace; onMapping: () => void }) {
  const [filter, setFilter] = useState('all');
  const { plan, image, demo } = work.workspace;
  const {
    review,
    calculated,
    ignoredCells,
    activeSheets,
    acknowledged,
    setAcknowledged,
    exporting,
    exported,
    exportExcel,
  } = work;
  useEffect(() => setFilter('all'), [plan?.zones]);
  if (!review || !plan)
    return (
      <div className="error-box">
        {calculated.error || '请先上传表格并设置分区。'}
        <button className="text-btn" onClick={onMapping}>
          修改分区
        </button>
      </div>
    );
  return (
    <>
      <ZoneOverview
        review={review}
        image={image}
        demo={demo}
        filter={filter}
        setFilter={setFilter}
        onMapping={onMapping}
      />
      <ReviewIssues review={review} plan={plan} demo={demo} />
      <UnassignedPanel review={review} onAssign={work.assign} onIgnore={work.exclude} />
      <RosterTable
        review={review}
        filter={filter}
        setFilter={setFilter}
        editPerson={work.editPerson}
        exclude={work.exclude}
      />
      <IgnoredPanel cells={ignoredCells} plan={plan} onRestore={work.restore} />
      <SourcePreview sheets={activeSheets} />
      <section className={'export-panel ' + (exported ? 'exported' : '')}>
        <label className="acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            <strong>我已核对分区、名单与人数</strong>
            <small>包括重名、姓名备注、缺失信息，以及人数多于或少于座位容量的情况。</small>
          </span>
        </label>
        <button
          className="primary-btn export-btn"
          disabled={
            !acknowledged ||
            !!review.errors.length ||
            !!review.unassigned.length ||
            !review.people.length ||
            exporting
          }
          onClick={exportExcel}
        >
          {exporting ? (
            <Loader2 className="spin" size={18} />
          ) : exported ? (
            <CheckCircle2 size={18} />
          ) : (
            <Download size={18} />
          )}
          导出人员库 .xlsx
        </button>
      </section>
    </>
  );
}
