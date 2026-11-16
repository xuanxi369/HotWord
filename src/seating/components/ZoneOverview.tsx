import { AlertCircle, CheckCircle2, Settings2 } from 'lucide-react';
import type { RosterReview } from '../lib/roster';
export function ZoneOverview({
  review,
  image,
  demo,
  filter,
  setFilter,
  onMapping,
}: {
  review: RosterReview;
  image: string;
  demo: boolean;
  filter: string;
  setFilter: (filter: string) => void;
  onMapping: () => void;
}) {
  const setShowMapping = (_open: boolean) => onMapping();
  return (
    <div className="review-overview">
      <section className="venue-card">
        <div className="section-title">
          <h3>会场分区对照</h3>
          <span className="muted">{demo ? '示例会场' : '你的座次图'}</span>
        </div>
        <div className="venue-image">
          {image ? (
            <>
              <img src={image} alt="会场座次图，用于核对分区" />
              {review.zones.map(
                (zone, i) =>
                  zone.bbox && (
                    <button
                      key={zone.id}
                      className={`zone-marker zone-color-${i % 4} ${filter === zone.id ? 'selected' : ''}`}
                      style={{
                        left: `${zone.bbox.x * 100}%`,
                        top: `${zone.bbox.y * 100}%`,
                        width: `${zone.bbox.width * 100}%`,
                        height: `${zone.bbox.height * 100}%`,
                      }}
                      onClick={() => {
                        setFilter(zone.id);
                      }}
                      aria-label={`查看 ${zone.label} 人员`}
                    >
                      <span>{zone.label}</span>
                    </button>
                  ),
              )}
            </>
          ) : (
            <div className="image-placeholder">
              手动整理模式
              <br />
              可返回上传会场图片
            </div>
          )}
        </div>
        <div className="venue-footer">点击分区查看人员；分区位置与人数以核对结果为准。</div>
      </section>
      <section className="zones-card">
        <div className="section-title">
          <h3>分区统计</h3>
          <button className="text-btn" onClick={() => setShowMapping(true)}>
            <Settings2 size={15} />
            修改分区
          </button>
        </div>
        <div className="zone-summary-total">
          <strong>
            {review.people.length}
            <small>条</small>
          </strong>
          <span>当前人员记录</span>
          {demo && <span className="demo-pill">演示模式</span>}
        </div>
        <div className="zone-summary-list">
          {review.zones.map((zone, i) => (
            <button
              className={`zone-summary-row ${filter === zone.id ? 'selected' : ''}`}
              key={zone.id}
              onClick={() => {
                setFilter(filter === zone.id ? 'all' : zone.id);
              }}
            >
              <span className={`zone-dot zone-color-${i % 4}`} />
              <div>
                <strong>{zone.label}</strong>
                <small>{zone.position || zone.sources.map((s) => s.range).join('、')}</small>
              </div>
              <div className="zone-amount">
                <strong>{zone.count}</strong>
                <span>{zone.capacity === null ? '容量未识别' : `/ ${zone.capacity} 座`}</span>
              </div>
              {zone.overflow > 0 ? (
                <span className="overflow-tag">超出 {zone.overflow}</span>
              ) : zone.shortfall > 0 ? (
                <span className="shortfall-tag">少 {zone.shortfall} 人</span>
              ) : zone.capacityStatus === 'unknown' ? (
                <AlertCircle size={16} className="muted" aria-label="容量未知" />
              ) : (
                <CheckCircle2 size={16} className="success-icon" aria-label="人数与容量一致" />
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
