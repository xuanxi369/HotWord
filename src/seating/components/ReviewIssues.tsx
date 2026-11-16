import { AlertCircle } from 'lucide-react';
import type { RosterReview } from '../lib/roster';
import type { Plan } from '../lib/schema';
export function ReviewIssues({
  review,
  plan,
  demo,
}: {
  review: RosterReview;
  plan: Plan;
  demo: boolean;
}) {
  return (
    <section className="review-notes">
      <div className="review-notes-heading">
        <AlertCircle size={18} />
        <strong>导出前，留意这些信息</strong>
        <span>不会自动删减记录</span>
      </div>
      <div className="issue-chips">
        {review.zones.some((z) => z.overflow > 0) && (
          <span className="issue-chip warning">
            人数超过座位：
            {review.zones
              .filter((z) => z.overflow > 0)
              .map((z) => `${z.label} +${z.overflow}`)
              .join('、')}
          </span>
        )}
        {review.zones.some((zone) => zone.shortfall > 0) && (
          <span className="issue-chip warning">
            人数少于座位：
            {review.zones
              .filter((zone) => zone.shortfall > 0)
              .map((zone) => zone.label + ' 少 ' + zone.shortfall + ' 人')
              .join('、')}
            ，请核对空座或漏记
          </span>
        )}
        {review.zones.some((zone) => zone.capacityStatus === 'unknown') && (
          <span className="issue-chip neutral">部分分区容量未知，请人工核对</span>
        )}
        {review.duplicates.size > 0 && (
          <span className="issue-chip">{review.duplicates.size} 组重名，已保留</span>
        )}
        {review.annotated.length > 0 && (
          <span className="issue-chip">{review.annotated.length} 条姓名备注</span>
        )}
        {review.unassigned.length > 0 && (
          <span className="issue-chip warning">{review.unassigned.length} 个单元格未归档</span>
        )}
        {plan.zones.some((z) => z.confidence !== 'high') && (
          <span className="issue-chip warning">部分分区需确认</span>
        )}
        <span className="issue-chip neutral">缺失字段保持为空</span>
      </div>
      {plan.warnings
        .filter((w) => !demo)
        .map((warning, i) => (
          <p className="ai-warning" key={i}>
            {warning}
          </p>
        ))}
      {review.errors.map((e) => (
        <p className="danger-text" key={e}>
          {e}
        </p>
      ))}
    </section>
  );
}
