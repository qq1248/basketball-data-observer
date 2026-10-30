import { useState, useMemo } from 'react';
import type { BasketballMatchItem, BasketballH2HGame } from '@shared/api.interface';
import { isPlaceholder } from '@client/src/utils/data-quality';

interface H2HTabProps {
  match: BasketballMatchItem;
}

type RangeKey = 'all' | '10' | '5';

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: '10', label: '近10次' },
  { key: '5', label: '近5次' },
];

function H2HGameCard({ game }: { game: BasketballH2HGame }) {
  const homeWin = game.homeScore > game.awayScore;
  return (
    <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground">{game.date}</span>
        <div className="flex gap-2 text-xs">
          {game.handicapResult && (
            <span
              className={`px-1.5 py-0.5 rounded font-medium ${
                game.handicapResult === 'HW'
                  ? 'text-home-win bg-home-win-bg'
                  : game.handicapResult === 'HL'
                    ? 'text-miss-text bg-miss-bg'
                    : 'text-draw-text bg-draw-bg'
              }`}
            >
              让分 {game.handicapResult === 'P' ? '走' : game.handicapResult === 'HW' ? '主赢' : '主输'}
            </span>
          )}
          {game.totalResult && (
            <span
              className={`px-1.5 py-0.5 rounded font-medium ${
                game.totalResult === 'O'
                  ? 'text-basketball-orange bg-basketball-orange/10'
                  : 'text-away-win bg-away-win-bg'
              }`}
            >
              {game.totalResult === 'O' ? '大分' : '小分'}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div className="flex-1 text-right">
          <span className={homeWin ? 'text-[var(--foreground)] md:text-foreground font-semibold' : 'text-[var(--muted-foreground)] md:text-muted-foreground'}>
            {game.homeTeam}
          </span>
        </div>
        <div className="mx-3 font-mono font-bold text-[var(--foreground)]/90 md:text-foreground/90">
          <span className={homeWin ? 'text-red-400 md:text-home-win' : 'text-slate-500 md:text-foreground/70'}>
            {game.homeScore}
          </span>
          <span className="mx-1 text-[var(--muted-foreground)]/30 md:text-muted-foreground/30">:</span>
          <span className={!homeWin ? 'text-blue-400 md:text-away-win' : 'text-slate-500 md:text-foreground/70'}>
            {game.awayScore}
          </span>
        </div>
        <div className="flex-1 text-left">
          <span className={!homeWin ? 'text-[var(--foreground)] md:text-foreground font-semibold' : 'text-[var(--muted-foreground)] md:text-muted-foreground'}>
            {game.awayTeam}
          </span>
        </div>
      </div>
      {(game.handicapLine !== undefined || game.totalLine !== undefined) && (
        <div className="flex justify-center gap-4 mt-2 text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
          {game.handicapLine !== undefined && (
            <span>让分: {game.handicapLine > 0 ? '+' : ''}{game.handicapLine}</span>
          )}
          {game.totalLine !== undefined && <span>总分: {game.totalLine}</span>}
        </div>
      )}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl p-6 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm text-center">
      <p className="text-sm text-[var(--muted-foreground)] md:text-gray-400">{text}</p>
    </div>
  );
}

function DataSourceLabel({ source }: { source: string }) {
  return (
    <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] md:text-gray-400 ml-auto">
      数据来源：{source}
    </span>
  );
}

function getH2HDataSource(match: BasketballMatchItem): string | null {
  const src = match.source;
  if (src && typeof src === 'string' && src.trim()) {
    const upper = src.trim().toUpperCase();
    if (upper.includes('ESPN')) return 'ESPN';
    if (upper.includes('SPORTTERY')) return '竞彩官方';
    if (upper.includes('QIUMIBAO')) return '球美宝';
    return src.trim();
  }
  return null;
}

export default function H2HTab({ match }: H2HTabProps) {
  const [range, setRange] = useState<RangeKey>('all');

  const allHistory = useMemo(() => {
    return [...(match.h2hHistory ?? [])]
      .filter(
        (g: BasketballH2HGame) =>
          g.homeScore > 0 && g.awayScore > 0 &&
          new Date(g.date) < new Date(match.kickoffTime),
      )
      .sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
  }, [match.h2hHistory, match.kickoffTime]);

  const displayHistory = useMemo(() => {
    if (range === 'all') return allHistory;
    const n = range === '10' ? 10 : 5;
    return allHistory.slice(0, n);
  }, [allHistory, range]);

  const stats = useMemo(() => {
    const list = displayHistory;
    const homeWins = list.filter((g) => g.homeScore > g.awayScore).length;
    const awayWins = list.filter((g) => g.awayScore > g.homeScore).length;
    const total = list.length || 1;
    const avgTotal = list.length > 0
      ? list.reduce((sum, g) => sum + g.homeScore + g.awayScore, 0) / list.length
      : 0;
    return {
      homeWins,
      awayWins,
      total: list.length,
      avgTotal: Math.round(avgTotal * 10) / 10,
      homeWinRate: Math.round((homeWins / total) * 100),
      awayWinRate: Math.round((awayWins / total) * 100),
    };
  }, [displayHistory]);

  const h2hSource = getH2HDataSource(match);
  const hasH2HData = allHistory.length > 0 && !isPlaceholder(match.h2hHistory, 'default');

  if (!hasH2HData) {
    return <EmptyCard text="暂无数据" />;
  }

  return (
    <div className="space-y-3">
      {/* Summary with Range Toggle */}
      <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground flex items-center gap-2 w-full">
             <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
             交锋总览
             {h2hSource && <DataSourceLabel source={h2hSource} />}
           </div>
           <div className="flex gap-1 bg-[var(--secondary)] md:bg-muted/50 rounded-lg p-0.5">
             {RANGE_TABS.map((tab) => (
               <button
                 key={tab.key}
                 onClick={() => setRange(tab.key)}
                 className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                   range === tab.key
                     ? 'bg-[var(--card)] text-blue-400 md:bg-white md:text-nebula-crimson shadow-sm font-black'
                     : 'text-[var(--muted-foreground)] md:text-muted-foreground hover:text-[var(--foreground)] md:hover:text-foreground/70'
                 }`}
               >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 胜负分布 */}
        <div className="flex items-center justify-around">
          <div className="text-center">
             <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{match.homeTeam}</div>
             <div className="text-3xl font-bold text-red-400 md:text-home-win font-mono">
              {stats.homeWins}
            </div>
             <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-1">胜 ({stats.homeWinRate}%)</div>
          </div>
          <div className="text-center">
             <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">场均总分</div>
             <div className="text-2xl font-black text-blue-400 md:text-nebula-crimson font-mono">
              {stats.avgTotal}
            </div>
             <div className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] md:text-muted-foreground mt-1">
              AVG TOTAL
            </div>
          </div>
          <div className="text-center">
             <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{match.awayTeam}</div>
             <div className="text-3xl font-bold text-blue-400 md:text-away-win font-mono">
              {stats.awayWins}
            </div>
            <div className="text-xs text-muted-foreground mt-1">胜 ({stats.awayWinRate}%)</div>
          </div>
        </div>

        {/* 进度条对比 */}
         <div className="mt-4 h-2 rounded-full overflow-hidden bg-[var(--secondary)] md:bg-muted flex">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${stats.homeWinRate}%`,
              background: '#8B0000',
            }}
          />
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${stats.awayWinRate}%`,
              background: '#CD5C5C',
            }}
          />
        </div>
      </div>

      {/* H2H List */}
       <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
        <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2 w-full">
            <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-primary" />
           历史对阵 ({displayHistory.length}场)
           {h2hSource && <DataSourceLabel source={h2hSource} />}
         </div>
        <div className="space-y-2">
          {displayHistory.map((game, i) => (
            <H2HGameCard key={i} game={game} />
          ))}
        </div>
      </div>
    </div>
  );
}
