import { useNavigate } from 'react-router-dom';
import { Target, ShieldCheck } from 'lucide-react';
import type { BasketballMatchItem } from '@shared/api.interface';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import { formatMatchNoBadge } from '@client/src/utils/match-card-enhance';

interface ScheduleCardProps {
  match: BasketballMatchItem;
}

function ConfidenceBadge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  let label = '低';
  let cls = 'bg-[var(--secondary)] text-[var(--muted-foreground)]';
  if (v >= 65) {
    label = '高';
    cls = 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]';
  } else if (v >= 58) {
    label = '中';
    cls = 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]';
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded ${cls}`}>
      <ShieldCheck className="w-3 h-3" />
      {label}信心 {v}%
    </span>
  );
}

function PickPill({
  label,
  pick,
  prob,
}: {
  label: string;
  pick: string;
  prob: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(prob ?? 0)));
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider font-medium">
          {label}
        </span>
        <span className="text-[10px] font-black tabular-nums text-[var(--foreground)]">
          {pct}%
        </span>
      </div>
      <div className="text-xs font-bold text-[var(--foreground)] truncate">{pick || '—'}</div>
      <div className="w-full h-1 bg-[var(--secondary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-light)] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ScheduleCard({ match }: ScheduleCardProps) {
  const navigate = useNavigate();
  const matchNoBadge = formatMatchNoBadge(match.matchNo, match.source);

  const handleClick = () => {
    navigate(`/basketball/detail/${match.id}`);
  };

  const kickoffTimeLabel = formatBeijingTime(match.kickoffTime, 'time');
  const kickoffDateLabel = formatBeijingTime(match.kickoffTime, 'date');

  const wdwPick = match.predictionDirection || '—';
  const wdwProb =
    match.predictionDirection === '主胜'
      ? match.homeWinProb
      : match.predictionDirection === '客胜'
        ? match.awayWinProb
        : 50;

  const handicapPick = match.handicapPick || match.handicapRecommendation || '—';
  const totalPick = match.totalPick || match.totalDirection || '—';

  const isLive = match.matchStatus === 'live';
  const isFinished = match.matchStatus === 'finished';

  const statusDot = isLive
    ? 'bg-[var(--destructive)] animate-pulse'
    : isFinished
      ? 'bg-[var(--success)]'
      : 'bg-[var(--accent-primary)]';
  const statusText = isLive ? 'LIVE' : isFinished ? '终场' : '未开赛';
  const statusColor = isLive
    ? 'text-[var(--destructive)]'
    : isFinished
      ? 'text-[var(--success)]'
      : 'text-[var(--accent-primary)]';

  return (
    <div
      onClick={handleClick}
      className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 cursor-pointer active:scale-[0.98] transition-transform duration-150"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* 顶部：三列布局 — 时间 | 对阵 | 联赛状态 */}
      <div className="flex items-center gap-3 mb-4">
        {/* 左侧：时间列 */}
        <div className="flex flex-col items-start flex-shrink-0 w-14">
          <span className="text-[var(--accent-primary)] font-bold text-lg tabular-nums leading-none">
            {kickoffTimeLabel}
          </span>
          <span className="text-[var(--muted-foreground)] text-xs mt-1">{kickoffDateLabel}</span>
          {isLive && (
            <div className="text-[var(--destructive)] text-xs font-bold flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--destructive)] animate-pulse" />
              LIVE
            </div>
          )}
        </div>

        {/* 中间：对阵列 — 上客下主（竞彩官方口径：客队 VS 主队） */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
          <div className="text-[var(--foreground)] font-medium text-sm truncate w-full text-right pr-2">
            {match.awayTeam}
          </div>
          <div className="flex items-center gap-2 my-0.5">
            {isFinished && match.homeScore !== undefined && match.awayScore !== undefined ? (
              <span className="text-[var(--foreground)] font-bold tabular-nums text-sm">
                {match.awayScore} <span className="text-[var(--muted-foreground)] mx-0.5">:</span> {match.homeScore}
              </span>
            ) : (
              <span className="text-[var(--muted-foreground)] text-[10px] font-bold uppercase">VS</span>
            )}
          </div>
          <div className="text-[var(--foreground)] font-medium text-sm truncate w-full text-left pl-2">
            {match.homeTeam}
          </div>
        </div>

        {/* 右侧：联赛/状态标签 */}
        <div className="flex flex-col items-end flex-shrink-0 gap-1.5 w-20">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] truncate w-full text-right">
            {match.league}
          </span>
          {matchNoBadge && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] whitespace-nowrap">
              {matchNoBadge}
            </span>
          )}
          <div className={`flex items-center gap-1 text-xs font-medium ${statusColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            {statusText}
          </div>
        </div>
      </div>

      {/* 三项预测 */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[var(--border)]">
        <PickPill label="胜负" pick={wdwPick} prob={wdwProb} />
        <PickPill label="让分" pick={handicapPick} prob={match.handicapPickProb} />
        <PickPill label="大小" pick={totalPick} prob={match.totalPickProb} />
      </div>

      {/* 底部：信心度 */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
          <Target className="w-3.5 h-3.5" />
          <span>模型信心</span>
        </div>
        <ConfidenceBadge value={match.confidence} />
      </div>
    </div>
  );
}
