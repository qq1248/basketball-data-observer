import { Clock } from 'lucide-react';
import {
  formatBeijingTime,
  type BeijingTimeFormat,
} from '@client/src/utils/format-beijing-time';
import { computeMatchStatus } from '@client/src/utils/format';
import type { ComputedMatchStatus } from '@client/src/utils/format';

/**
 * 适配足球 MatchItem 和篮球 BasketballMatchItem 的通用字段
 */
interface MatchLike {
  matchStatus: string;
  kickoffTime: string;
  homeScore?: number | null;
  awayScore?: number | null;
  liveScoreSource?: string | null;
  lastScoreAt?: string | null;
  // 足球详情没有 dataUpdatedAt，篮球有；足球用更新时间兜底
  dataUpdatedAt?: string;
  intelUpdatedAt?: string;
}

interface MatchTimestampsProps {
  match: MatchLike;
  /** 指数线更新时间（指数刷新时设置，没有就不传） */
  lastOddsUpdateAt?: string | null;
  /** 数据同步时间（拉取详情/列表的时间，没有就不传） */
  lastDataSyncAt?: string | null;
  /** 预测/模型更新时间（足球端无 dataUpdatedAt 字段时外部传入） */
  predictionUpdatedAt?: string | null;
  /** 运动类型，影响状态计算 */
  sport?: 'football' | 'basketball';
}

function TimeRow({
  label,
  iso,
  format = 'time',
  emptyText,
  accent = false,
}: {
  label: string;
  iso: string | null | undefined;
  format?: BeijingTimeFormat;
  /** 为空时的替代文字，不传则隐藏整行 */
  emptyText?: string;
  accent?: boolean;
}) {
  const formatted = iso ? formatBeijingTime(iso, format) : '';

  if (!formatted && !emptyText) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-xs font-mono ml-auto ${
          accent ? 'text-foreground font-semibold' : 'text-muted-foreground'
        }`}
      >
        {formatted || emptyText}
      </span>
    </div>
  );
}

export default function MatchTimestamps({
  match,
  lastOddsUpdateAt,
  lastDataSyncAt,
  predictionUpdatedAt,
  sport = 'football',
}: MatchTimestampsProps) {
  const hasScore = match.homeScore != null && match.awayScore != null;
  const hasLiveSource = !!match.liveScoreSource && match.liveScoreSource !== '';
  const status: ComputedMatchStatus = computeMatchStatus(
    match.matchStatus,
    match.kickoffTime,
    hasScore,
    sport,
    hasLiveSource,
  );

  const isLive = status === 'live';
  const isUpcoming = status === 'upcoming';
  const isFinished = status === 'finished' || status === 'finished_pending';

  // 预测更新时间：优先用 match.dataUpdatedAt（篮球），其次外部传入，最后兜底 lastDataSyncAt
  const predictionTime = match.dataUpdatedAt || predictionUpdatedAt || lastDataSyncAt || null;

  return (
    <div className="bg-card/60 border border-border/50 rounded-lg p-3 space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          时间戳（北京时间）
        </span>
      </div>

      {isLive && (
        <>
          <TimeRow
            label="比分更新"
            iso={match.lastScoreAt}
            format="time-seconds"
            accent
            emptyText="—"
          />
          <TimeRow label="数据更新" iso={lastDataSyncAt} emptyText="—" />
          {lastOddsUpdateAt && (
            <TimeRow label="指数更新" iso={lastOddsUpdateAt} />
          )}
          <TimeRow
            label="模型/指数生成"
            iso={predictionTime}
            emptyText="—"
          />
          <TimeRow
            label="情报更新"
            iso={match.intelUpdatedAt}
            emptyText="暂无情报"
          />
        </>
      )}

      {isUpcoming && (
        <>
          <TimeRow label="数据更新" iso={lastDataSyncAt} emptyText="—" />
          {lastOddsUpdateAt && (
            <TimeRow label="指数更新" iso={lastOddsUpdateAt} />
          )}
          <TimeRow
            label="模型/指数生成"
            iso={predictionTime}
            emptyText="—"
          />
          <TimeRow
            label="情报更新"
            iso={match.intelUpdatedAt}
            emptyText="暂无情报"
          />
        </>
      )}

      {isFinished && (
        <>
          {match.lastScoreAt && (
            <TimeRow label="完赛时间" iso={match.lastScoreAt} />
          )}
          <TimeRow label="数据更新" iso={lastDataSyncAt} emptyText="—" />
        </>
      )}
    </div>
  );
}
