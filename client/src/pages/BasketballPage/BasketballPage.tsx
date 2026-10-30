import { useState, useMemo, useEffect, useCallback, useRef } from 'react';

import { logger } from '@lark-apaas/client-toolkit/logger';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { basketballApi, syncApi } from '@client/src/api';
import { toast } from 'sonner';
import type { BasketballMatchItem } from '@shared/api.interface';
import { Search, ShieldCheck, Clock, TrendingUp, Percent, AlertCircle, ChevronRight, BarChart3, LineChart, RefreshCw, Sparkles, CalendarDays, Database, Heart, ChevronDown, ChevronUp } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import { useFollowStore } from '@client/src/hooks/useFollowStore';
import dayjs from 'dayjs';
import { computeMatchStatus, statusSortPriority } from '@client/src/utils/format';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { AnimatePresence, motion } from 'framer-motion';
import { ErrorState } from '@client/src/components/ui/error-state';
import { LiveStatusBar } from '@client/src/components/LiveStatusBar';
import PullToRefresh from '@client/src/components/PullToRefresh';
import { setLiveCount } from '@client/src/utils/live-count';
import type { ComputedMatchStatus } from '@client/src/utils/format';
import BasketballCard from './BasketballCard';
import { useMinuteTicker } from '@client/src/utils/match-card-enhance';
import { dedupMatches } from '@client/src/utils/match-dedup';

function getBeijingToday(): string {
  const now = new Date();
  const beijingMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().slice(0, 10);
}

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const LEAGUE_TABS = ['全部', 'WNBA', '澳篮联', '欧篮联', '西篮联', '德篮联', 'NBA', '亚运男篮', '亚运女篮'] as const;
type LeagueTab = (typeof LEAGUE_TABS)[number];

const STATUS_TABS = ['全部', '进行中', '待开赛', '已完赛'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const SOURCE_TABS = ['官方竞彩', '国际赛事'] as const;
type SourceTab = (typeof SOURCE_TABS)[number];

function matchLeagueTab(league: string, tab: LeagueTab): boolean {
  if (tab === '全部') return true;
  const name = league || '';
  switch (tab) {
    case 'WNBA':
      return name.includes('WNBA');
    case '澳篮联':
      return name.includes('澳NBL') || name.includes('澳大利亚') || (name.includes('NBL') && !name.includes('CBA'));
    case '欧篮联':
      return name.includes('欧篮') || name.includes('Euro') || name.includes('欧冠篮') || name.includes('欧洲篮球');
    case '西篮联':
      return name.includes('西篮') || name.includes('ACB') || name.includes('西班牙');
    case '德篮联':
      return name.includes('德篮') || name.includes('BBL') || name.includes('德国篮球');
    case 'NBA':
      return name.includes('NBA') || name.includes('美职篮');
    case '亚运男篮':
      return name.includes('亚运') && name.includes('男篮');
    case '亚运女篮':
      return name.includes('亚运') && name.includes('女篮');
    default:
      return false;
  }
}

const SORT_OPTIONS = ['时间', '信心度', '指数'] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const BASKETBALL_DATE_KEY = 'basketball_selected_date';
const getLeagueTabKey = (date: string) => `basketball_league_tab_${date}`;
const getSortKey = (date: string) => `basketball_sort_${date}`;
const getScrollKey = (date: string) => `basketball_scroll_${date}`;

function isOfficialJingcai(m: BasketballMatchItem): boolean {
  return m.source === 'sporttery' || m.source === 'fox';
}

function isInternationalMatch(m: BasketballMatchItem): boolean {
  return m.source !== 'sporttery';
}

type JcSaleStatus = 'on_sale' | 'pending_sale' | 'suspended' | 'live' | 'finished';

function getJcSaleStatus(m: BasketballMatchItem): JcSaleStatus {
  if (m.matchStatus === 'finished' || m.matchStatus === 'finished_pending' || m.matchStatus === 'result_pending') return 'finished';
  if (m.matchStatus === 'live') return 'live';
  const hasOdds =
    (m.handicapOddsHome != null && m.handicapOddsHome > 0) ||
    (m.totalOddsOver != null && m.totalOddsOver > 0) ||
    (m.homeWinOdds != null && m.homeWinOdds > 0);
  if (hasOdds) return 'on_sale';
  return 'pending_sale';
}

const JC_SALE_GROUPS: { key: JcSaleStatus | 'suspended'; label: string; accent: string }[] = [
  { key: 'on_sale', label: '已开售', accent: 'bg-green-500' },
  { key: 'live', label: '进行中', accent: 'bg-nebula-crimson' },
  { key: 'pending_sale', label: '待开售', accent: 'bg-amber-500' },
  { key: 'suspended', label: '暂停销售', accent: 'bg-gray-400' },
  { key: 'finished', label: '已完赛', accent: 'bg-gray-300' },
];

function formatEngineVersion(version: string | undefined | null): string {
  if (!version) return 'V11.1';
  const v = version.toLowerCase();
  if (v.includes('v11.3') && v.includes('injury')) return 'V11.3 伤停加权版';
  if (v.includes('v11.5') && v.includes('shallow')) return 'V11.5 浅盘修正版';
  if (v.includes('v11.1') && v.includes('unified')) return 'V11.1 统一引擎';
  if (v.includes('v11.1')) return 'V11.1';
  if (v.includes('v11.3')) return 'V11.3';
  if (v.includes('data-driven')) return '数据驱动版';
  const m = v.match(/v(\d+\.\d+)/i);
  if (m) return `V${m[1]}`;
  return version;
}

function getDateList(baseDate: string) {
  const base = dayjs(baseDate);
  const today = getBeijingToday();
  const dates: { date: string; day: number; weekday: string; isToday: boolean }[] = [];
  for (let i = -14; i <= 2; i += 1) {
    const d = base.add(i, 'day');
    dates.push({
      date: d.format('YYYY-MM-DD'),
      day: d.date(),
      weekday: WEEKDAY_MAP[d.day()],
      isToday: d.format('YYYY-MM-DD') === today,
    });
  }
  return dates;
}

const QUICK_ENTRIES = [
  { key: 'stats', label: '篮球数据', icon: BarChart3, path: '/basketball/stats', color: 'text-info bg-info/10' },
] as const;


function FinishedSummary({ matches }: { matches: BasketballMatchItem[] }) {
  const finished = matches.filter((m) => {
    const computed = computeMatchStatus(
      m.matchStatus,
      m.kickoffTime,
      m.homeScore != null && m.awayScore != null,
      'basketball',
    );
    return computed === 'finished';
  });
  const wdwDenom = finished.filter((m) => m.hitWdw !== null && m.hitWdw !== undefined).length;
  const hcDenom = finished.filter((m) => m.hitHandicap !== null && m.hitHandicap !== undefined).length;
  const ouDenom = finished.filter((m) => m.hitOverunder !== null && m.hitOverunder !== undefined).length;
  const allEmpty = wdwDenom === 0 && hcDenom === 0 && ouDenom === 0;
  const hasAnyMatches = matches.length > 0;
  if (allEmpty && !hasAnyMatches) {
    return (
      <div className="grid grid-cols-3 gap-2 md:gap-3" data-ai-section-type="card-stat">
        <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">胜负验证</div>
          <div className="text-sm md:text-base font-medium text-[var(--muted-foreground)] md:text-gray-400 pt-2.5 md:pt-3">今日无赛事</div>
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)]/70 md:text-gray-300 mt-0.5 md:mt-1">&nbsp;</div>
        </div>
        <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">实力验证</div>
          <div className="text-sm md:text-base font-medium text-[var(--muted-foreground)] md:text-gray-400 pt-2.5 md:pt-3">今日无赛事</div>
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)]/70 md:text-gray-300 mt-0.5 md:mt-1">&nbsp;</div>
        </div>
        <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">总分验证</div>
          <div className="text-sm md:text-base font-medium text-[var(--muted-foreground)] md:text-gray-400 pt-2.5 md:pt-3">今日无赛事</div>
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)]/70 md:text-gray-300 mt-0.5 md:mt-1">&nbsp;</div>
        </div>
      </div>
    );
  }
  if (allEmpty) {
    return (
      <div className="grid grid-cols-3 gap-2 md:gap-3" data-ai-section-type="card-stat">
        <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">胜负验证</div>
          <div className="text-lg md:text-2xl font-black text-[var(--muted-foreground)] md:text-gray-300 tabular-nums">—/—</div>
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-0.5 md:mt-1">等待完赛</div>
        </div>
        <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">实力验证</div>
          <div className="text-lg md:text-2xl font-black text-[var(--muted-foreground)] md:text-gray-300 tabular-nums">—/—</div>
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-0.5 md:mt-1">等待完赛</div>
        </div>
        <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">总分验证</div>
          <div className="text-lg md:text-2xl font-black text-[var(--muted-foreground)] md:text-gray-300 tabular-nums">—/—</div>
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-0.5 md:mt-1">等待完赛</div>
        </div>
      </div>
    );
  }

  const wdwHit = finished.filter((m) => m.hitWdw === true).length;
  const hcHit = finished.filter((m) => m.hitHandicap === true).length;
  const ouHit = finished.filter((m) => m.hitOverunder === true).length;

  return (
    <div className="grid grid-cols-3 gap-2 md:gap-3" data-ai-section-type="card-stat">
       <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
            <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">胜负验证</div>
         <div className="text-lg md:text-2xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tabular-nums">
           {wdwHit}/{wdwDenom}
         </div>
        <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-0.5 md:mt-1">
          {wdwDenom > 0 ? `${Math.round((wdwHit / wdwDenom) * 100)}%` : '—'}
        </div>
          <div className="mt-1.5 md:mt-3 h-1 rounded-full bg-[var(--secondary)] md:bg-gray-100 overflow-hidden">
          <div
             className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-light)] md:progress-gradient rounded-full"
             style={{ width: wdwDenom > 0 ? `${(wdwHit / wdwDenom) * 100}%` : '0%' }}
           />
        </div>
      </div>
       <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
          <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">实力验证</div>
         <div className="text-lg md:text-2xl font-black text-[var(--total-over)] md:text-seq-3 tabular-nums">
           {hcHit}/{hcDenom}
         </div>
        <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-0.5 md:mt-1">
          {hcDenom > 0 ? `${Math.round((hcHit / hcDenom) * 100)}%` : '—'}
        </div>
          <div className="mt-1.5 md:mt-3 h-1 rounded-full bg-[var(--secondary)] md:bg-gray-100 overflow-hidden">
          <div
              className="h-full bg-gradient-to-r from-[var(--total-over)] to-[var(--accent-primary-light)] md:bg-seq-3 rounded-full"
             style={{ width: hcDenom > 0 ? `${(hcHit / hcDenom) * 100}%` : '0%' }}
           />
        </div>
      </div>
       <div className="p-2.5 md:p-4 text-center rounded-xl md:rounded-2xl bg-[var(--card)] md:bg-white border border-[var(--border)] md:border-0 md:metric-card">
             <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-widest mb-1">总分验证</div>
         <div className="text-lg md:text-2xl font-black text-[var(--total-under)] md:text-seq-5 tabular-nums">
           {ouHit}/{ouDenom}
         </div>
        <div className="text-[9px] md:text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-0.5 md:mt-1">
          {ouDenom > 0 ? `${Math.round((ouHit / ouDenom) * 100)}%` : '—'}
        </div>
          <div className="mt-1.5 md:mt-3 h-1 rounded-full bg-[var(--secondary)] md:bg-gray-100 overflow-hidden">
          <div
              className="h-full bg-gradient-to-r from-[var(--total-under)] to-[var(--success)] md:bg-seq-5 rounded-full"
             style={{ width: ouDenom > 0 ? `${(ouHit / ouDenom) * 100}%` : '0%' }}
           />
        </div>
      </div>
    </div>
  );
}

interface LeagueGroupsProps {
  matches: BasketballMatchItem[];
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  nowTimestamp: number;
}

function LeagueGroups({ matches, favoriteIds, onToggleFavorite, nowTimestamp }: LeagueGroupsProps) {
  const groupsMap = new Map<string, BasketballMatchItem[]>();
  for (const m of matches) {
    const league = m.league || '其他赛事';
    if (!groupsMap.has(league)) groupsMap.set(league, []);
    groupsMap.get(league)!.push(m);
  }
  const groups = Array.from(groupsMap.entries())
    .sort((a, b) => {
      const aTime = Math.min(...a[1].map((m: BasketballMatchItem) => new Date(m.kickoffTime).getTime()));
      const bTime = Math.min(...b[1].map((m: BasketballMatchItem) => new Date(m.kickoffTime).getTime()));
      return aTime - bTime;
    });

  if (groups.length === 0) return null;

  return (
    <div className="space-y-6 md:space-y-10">
      {groups.map(([league, items]) => (
        <div key={league}>
          <div className="sticky top-[160px] z-10 bg-[var(--background)]/90 backdrop-blur -mx-4 px-4 py-2 md:static md:bg-transparent md:backdrop-blur-none md:mx-0 md:px-0 md:py-0 mb-2.5 md:mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)] md:bg-nebula-crimson" />
              <h3 className="text-sm md:text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                {league}
                <span className="ml-2 text-[11px] md:text-xs text-[var(--muted-foreground)] md:text-gray-400 font-normal">{items.length} 场</span>
              </h3>
            </div>
          </div>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3 lg:gap-5" data-ai-section-type="card-list">
            {items.sort((a: BasketballMatchItem, b: BasketballMatchItem) => {
              const aStatus = statusSortPriority(
                computeMatchStatus(a.matchStatus, a.kickoffTime, a.homeScore != null && a.awayScore != null, 'basketball'),
              );
              const bStatus = statusSortPriority(
                computeMatchStatus(b.matchStatus, b.kickoffTime, b.homeScore != null && b.awayScore != null, 'basketball'),
              );
              if (aStatus !== bStatus) return aStatus - bStatus;
              return new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime();
            }).map((match: BasketballMatchItem) => {
              const computedStatus: ComputedMatchStatus = computeMatchStatus(
                match.matchStatus,
                match.kickoffTime,
                match.homeScore != null && match.awayScore != null,
                'basketball',
              );
              return (
                 <BasketballCard
                   key={match.id}
                   match={match}
                   computedStatus={computedStatus}
                   isFavorite={favoriteIds.has(match.id)}
                   onToggleFavorite={onToggleFavorite}
                   nowTimestamp={nowTimestamp}
                 />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface AllMatchesSplitViewProps {
  matches: BasketballMatchItem[];
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  nowTimestamp: number;
  selectedDate: string;
}

function AllMatchesSplitView({ matches, favoriteIds, onToggleFavorite, nowTimestamp, selectedDate }: AllMatchesSplitViewProps) {
  const today = getBeijingToday();
  const isFutureDate = selectedDate > today;
  const jcMatches = matches.filter((m: BasketballMatchItem) => isOfficialJingcai(m));
  const intlMatches = matches.filter((m: BasketballMatchItem) => isInternationalMatch(m));

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-nebula-crimson" />
          <h3 className="text-base font-black tracking-tight text-foreground">
            官方数据（官方数据平台开售）
            <span className="ml-2 text-xs text-gray-400 font-normal">{jcMatches.length} 场</span>
          </h3>
        </div>
        {jcMatches.length > 0 ? (
           <JcSaleStatusGroups
             matches={jcMatches}
             favoriteIds={favoriteIds}
             onToggleFavorite={onToggleFavorite}
             nowTimestamp={nowTimestamp}
           />
        ) : (
          <div className="text-center py-10 bg-white rounded-2xl border border-gray-100">
            <Clock className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500 mb-1">
              {isFutureDate ? '竞彩暂未开售该日场次' : '今日暂无官方开售场次'}
            </p>
            <p className="text-xs text-gray-400">
              {isFutureDate
                ? '通常赛前一天中午/下午陆续放出，开售后自动生成预测'
                : '数据仅供参考，请理性观赛'}
            </p>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-basketball-orange" />
          <h3 className="text-base font-black tracking-tight text-foreground">
            国际赛事（球美宝/ESPN 同步）
            <span className="ml-2 text-xs text-gray-400 font-normal">{intlMatches.length} 场</span>
          </h3>
        </div>
        {intlMatches.length > 0 ? (
           <LeagueGroups
             matches={intlMatches}
             favoriteIds={favoriteIds}
             onToggleFavorite={onToggleFavorite}
             nowTimestamp={nowTimestamp}
           />
        ) : (
          <div className="text-center py-10 bg-white rounded-2xl border border-gray-100">
            <p className="text-sm text-gray-400">
              {isFutureDate ? '该日暂无国际赛事数据' : '今日暂无国际赛事'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface JcSaleStatusGroupsProps {
  matches: BasketballMatchItem[];
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  nowTimestamp: number;
  storageKey?: string;
}

function JcSaleStatusGroups({ matches, favoriteIds, onToggleFavorite, nowTimestamp, storageKey = 'basketball_jc_groups_collapsed' }: JcSaleStatusGroupsProps) {
  const groups = JC_SALE_GROUPS.map((g) => ({
    ...g,
    items: matches.filter((m: BasketballMatchItem) => getJcSaleStatus(m) === g.key),
  })).filter((g) => g.items.length > 0);

  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) return new Set(JSON.parse(saved));
    } catch {
      // ignore
    }
    return new Set();
  });

  const toggleGroup = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  }, [storageKey]);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-5 md:space-y-8">
      {groups.map((group) => {
        const isCollapsed = collapsedKeys.has(group.key);
        return (
          <div key={group.key}>
            <div className="sticky top-[160px] z-10 bg-[var(--background)]/90 backdrop-blur -mx-4 px-4 py-2 md:static md:bg-transparent md:backdrop-blur-none md:mx-0 md:px-0 md:py-0 mb-2.5 md:mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${group.accent}`} />
                  <h3 className="text-sm md:text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                    {group.label}
                     <span className="ml-2 text-[11px] md:text-xs text-[var(--muted-foreground)] md:text-gray-400 font-normal">{group.items.length} 场</span>
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                   className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--accent-primary)] md:hover:text-nebula-crimson transition-colors active:scale-95"
                  aria-label={isCollapsed ? `展开${group.label}` : `收起${group.label}`}
                >
                  {isCollapsed ? '展开' : '收起'}
                  {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            {!isCollapsed && (
              <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3 lg:gap-5" data-ai-section-type="card-list">
                {group.items.map((match: BasketballMatchItem) => {
                  const computedStatus: ComputedMatchStatus = computeMatchStatus(
                    match.matchStatus,
                    match.kickoffTime,
                    match.homeScore != null && match.awayScore != null,
                    'basketball',
                  );
                  return (
                     <BasketballCard
                       key={match.id}
                       match={match}
                       computedStatus={computedStatus}
                       isFavorite={favoriteIds.has(match.id)}
                       onToggleFavorite={onToggleFavorite}
                       nowTimestamp={nowTimestamp}
                     />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function BasketballPage() {
  const todayStr = getBeijingToday();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const getInitialDate = (): string => {
    const urlDate = searchParams.get('date');
    if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
      return urlDate;
    }
    try {
      const saved = localStorage.getItem(BASKETBALL_DATE_KEY);
      if (saved) return saved;
    } catch {
      // ignore
    }
    return todayStr;
  };

  const initialDate = getInitialDate();
  const [selectedDate, setSelectedDateState] = useState<string>(initialDate);
  const [sourceTab, setSourceTabState] = useState<SourceTab>('官方竞彩');
  const sourceTabRef = useRef<SourceTab>('官方竞彩');
  const setSourceTab = useCallback((tab: SourceTab) => {
    sourceTabRef.current = tab;
    setSourceTabState(tab);
  }, []);
  const selectedDateRef = useRef<string>(initialDate);
  const nowTimestamp = useMinuteTicker();
  const { data: followData, getFollowedTeams, getFollowedLeagues } = useFollowStore();
  const dateList = useMemo(() => getDateList(todayStr), [todayStr]);
  const [matches, setMatches] = useState<BasketballMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const PAGE_SIZE = 50;
  const [leagueTab, setLeagueTab] = useState<LeagueTab>(() => {
    try {
      const saved = localStorage.getItem(getLeagueTabKey(initialDate));
      if (saved && LEAGUE_TABS.includes(saved as LeagueTab)) return saved as LeagueTab;
    } catch { /* ignore */ }
    return '全部';
  });
  const [statusFilter, setStatusFilter] = useState<StatusTab>('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    try {
      const saved = localStorage.getItem(getSortKey(initialDate));
      if (saved && SORT_OPTIONS.includes(saved as SortOption)) return saved as SortOption;
    } catch { /* ignore */ }
    return '时间';
  });
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>(() =>
    formatBeijingTime(new Date().toISOString(), 'time-seconds'),
  );
  const [lastUpdateIso, setLastUpdateIso] = useState<string>(new Date().toISOString());
  const [wnbaSyncStatus, setWnbaSyncStatus] = useState<{
    lastSuccessAt: string | null;
    lastError: string | null;
    status: string;
  } | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [modelVersion, setModelVersion] = useState<string>('v11.1-unified');
  const isRefreshingRef = useRef<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState<number>(30);
  const AUTO_REFRESH_INTERVAL = 30;
  const [showV67Announce, setShowV67Announce] = useState<boolean>(false);
  const closeV67Announce = () => {
    setShowV67Announce(false);
    try {
      localStorage.setItem('basketball_v671_announced', '1');
    } catch { /* ignore */ }
  };

  const isToday = selectedDate === todayStr;

  // 判断是否有进行中的比赛（含开赛时间兜底）
  const hasLiveMatch = useMemo(() => {
    return matches.some((m: BasketballMatchItem) => {
      const computed = computeMatchStatus(
        m.matchStatus,
        m.kickoffTime,
        m.homeScore != null && m.awayScore != null,
        'basketball',
      );
      return computed === 'live';
    });
  }, [matches]);

  const hasUpcomingToday = useMemo(() => {
    if (!isToday) return false;
    return matches.some((m: BasketballMatchItem) => {
      const computed = computeMatchStatus(
        m.matchStatus,
        m.kickoffTime,
        m.homeScore != null && m.awayScore != null,
        'basketball',
      );
      return computed === 'upcoming';
    });
  }, [matches, isToday]);

  // 智能刷新频率（与详情页一致）：有live 30~45s抖动，当日upcoming 60~120s抖动，其他5min
  const refreshInterval = useMemo(() => {
    if (hasLiveMatch) {
      const base = 37;
      const jitter = Math.floor(Math.random() * 16) - 7;
      return Math.max(30, Math.min(45, base + jitter));
    }
    if (hasUpcomingToday) {
      const base = 90;
      const jitter = Math.floor(Math.random() * 37) - 18;
      return Math.max(60, Math.min(120, base + jitter));
    }
    return 300;
  }, [hasLiveMatch, hasUpcomingToday]);

   const fetchMatches = async (showLoading = false, pageNum = 1, append = false) => {
     if (!append && showLoading) {
       setLoading(true);
       setError(null);
     }
     if (append) setLoadingMore(true);
     try {
        const res = await basketballApi.getBasketballMatches({
           date: selectedDateRef.current,
           sort: 'kickoff',
           dateMode: 'kickoff',
           sourceFilter:
            sourceTabRef.current === '官方竞彩'
              ? 'jingcai'
              : sourceTabRef.current === '国际赛事'
                ? 'others'
                : 'all',
          page: pageNum,
          pageSize: PAGE_SIZE,
        });
       const newItems: BasketballMatchItem[] = res.items;
       const total: number = res.total ?? 0;

      if (append) {
        setMatches((prev) => {
          const existingIds = new Set(prev.map((m: BasketballMatchItem) => m.id));
          const uniqueNew = newItems.filter((m: BasketballMatchItem) => !existingIds.has(m.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setMatches(newItems);
        setPage(pageNum);
        const firstWithVersion = newItems.find((m: BasketballMatchItem) => {
          const v = (m as unknown as Record<string, unknown>).predEngineVersion;
          return typeof v === 'string' && v.trim() !== '';
        });
        if (firstWithVersion) {
          setModelVersion((firstWithVersion as unknown as Record<string, unknown>).predEngineVersion as string);
        }
      }
      setTotalMatches(total);
      const loadedCount = append
        ? (matches.length + newItems.length)
        : newItems.length;
      setHasMore(loadedCount < total && newItems.length > 0);
      const nowIso = new Date().toISOString();
      setLastUpdateIso(nowIso);
      setLastUpdateTime(formatBeijingTime(nowIso, 'time-seconds'));
      setSyncError(false);
     } catch (err) {
       logger.error('加载篮球比赛失败', String(err));
       setSyncError(true);
       if (!append && showLoading) setError('加载失败，请稍后重试');
     } finally {
       if (!append && showLoading) setLoading(false);
       if (append) setLoadingMore(false);
     }
   };



  const lastVisibilityRefreshRef = useRef<number>(0);

  useEffect(() => {
    const handleRefreshOnFocus = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < 3000) return;
      lastVisibilityRefreshRef.current = now;
      void fetchMatches(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleRefreshOnFocus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleRefreshOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleRefreshOnFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasLiveMatch) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchMatches(false);
      }
    }, refreshInterval * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [hasLiveMatch, refreshInterval]);

  // 30秒自动刷新开关与倒计时
  useEffect(() => {
    if (!autoRefresh) return;
    setAutoRefreshCountdown(AUTO_REFRESH_INTERVAL);
    const timer = setInterval(() => {
      setAutoRefreshCountdown((prev) => {
        if (prev <= 1) {
          void fetchMatches(false);
          return AUTO_REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const toggleAutoRefresh = () => {
    setAutoRefresh((prev) => !prev);
  };

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    void fetchMatches(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, sourceTab]);

  const handleManualRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    setIsRefreshing(true);
    isRefreshingRef.current = true;
    try {
      await syncApi.refreshLiveScoresUser();
      toast.success('已开始刷新比分，约30秒后更新');
      setTimeout(() => {
        void fetchMatches(false);
      }, 30000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        toast.error('请登录后刷新比分');
      } else {
        logger.error('手动刷新比分失败', String(err));
        toast.error('刷新失败，请稍后重试');
      }
    } finally {
      setIsRefreshing(false);
      isRefreshingRef.current = false;
    }
  }, []);

  const setSelectedDate = useCallback((newDate: string) => {
    selectedDateRef.current = newDate;
    setSelectedDateState(newDate);
    try {
      localStorage.setItem(BASKETBALL_DATE_KEY, newDate);
    } catch { /* ignore */ }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newDate === todayStr) {
        next.delete('date');
      } else {
        next.set('date', newDate);
      }
      return next;
    }, { replace: true });
  }, [todayStr, setSearchParams]);

  useEffect(() => {
    try { localStorage.setItem(getLeagueTabKey(selectedDate), leagueTab); } catch { /* ignore */ }
  }, [leagueTab, selectedDate]);

  useEffect(() => {
    try { localStorage.setItem(getSortKey(selectedDate), sortBy); } catch { /* ignore */ }
  }, [sortBy, selectedDate]);

  // 按日期保存滚动位置 + 切换日期时恢复对应日期的状态
  const saveScrollForDate = (date: string) => {
    try {
      localStorage.setItem(getScrollKey(date), String(window.scrollY));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => saveScrollForDate(selectedDate), 200);
    };
     window.addEventListener('scroll', handleScroll);
     return () => {
       window.removeEventListener('scroll', handleScroll);
       clearTimeout(timer);
     };
   }, [selectedDate]);

   // 无限滚动 loadMore 函数 ref（始终持有最新闭包）
   useEffect(() => {
     loadMoreRef.current = () => {
       if (loadingMore || !hasMore || loading) return;
       const nextPage = page + 1;
       setPage(nextPage);
       void fetchMatches(false, nextPage, true);
     };
   });

   // 无限滚动：IntersectionObserver 监听 sentinel
   useEffect(() => {
     const sentinel = sentinelRef.current;
     if (!sentinel) return;

     const observer = new IntersectionObserver(
       (entries) => {
         for (const entry of entries) {
           if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
             if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
             loadMoreTimerRef.current = setTimeout(() => {
               loadMoreRef.current();
             }, 200);
           }
         }
       },
       { rootMargin: '200px' },
     );

     observer.observe(sentinel);
     return () => {
       observer.disconnect();
       if (loadMoreTimerRef.current) {
         clearTimeout(loadMoreTimerRef.current);
         loadMoreTimerRef.current = null;
       }
     };
   }, [hasMore, loadingMore, loading]);

  const handleDateChange = useCallback((newDate: string) => {
    if (newDate === selectedDateRef.current) return;
    saveScrollForDate(selectedDateRef.current);
    setSelectedDate(newDate);

    // 恢复新日期的联赛 tab
    try {
      const savedTab = localStorage.getItem(getLeagueTabKey(newDate));
      if (savedTab && LEAGUE_TABS.includes(savedTab as LeagueTab)) {
        setLeagueTab(savedTab as LeagueTab);
      } else {
        setLeagueTab('全部');
      }
    } catch { /* ignore */ }

    // 恢复新日期的排序
    try {
      const savedSort = localStorage.getItem(getSortKey(newDate));
      if (savedSort && SORT_OPTIONS.includes(savedSort as SortOption)) {
        setSortBy(savedSort as SortOption);
      } else {
        setSortBy('时间');
      }
    } catch { /* ignore */ }

    // 恢复新日期的滚动位置（等待布局稳定后）
    requestAnimationFrame(() => {
      try {
        const savedScroll = localStorage.getItem(getScrollKey(newDate));
        if (savedScroll) {
          window.scrollTo(0, parseInt(savedScroll, 10));
        } else {
          window.scrollTo(0, 0);
        }
      } catch { /* ignore */ }
    });
  }, [setSelectedDate]);

  useEffect(() => {
    const el = document.querySelector(`[data-date="${selectedDate}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedDate]);

  const toggleFavorite = async (id: string) => {
    syncStore.toggleFavorite(id);
    setMatches((prev) =>
      prev.map((m: BasketballMatchItem) =>
        m.id === id ? { ...m, isFavorited: !favoriteIds.has(id) } : m,
      ),
    );
  };

  const syncStore = useSyncStore();
  const favoriteIds = new Set(syncStore.favorites);
  // 本地关注的球队/联赛匹配的比赛（最多3场）
  const followedMatches = useMemo(() => {
    const followedTeams = new Set(getFollowedTeams('basketball'));
    const followedLeagues = new Set(getFollowedLeagues('basketball'));
    if (followedTeams.size === 0 && followedLeagues.size === 0) return [];
    const matched = dedupMatches(matches).filter((m: BasketballMatchItem) => {
      if (followedTeams.has(m.homeTeam) || followedTeams.has(m.awayTeam)) return true;
      if (followedLeagues.has(m.league)) return true;
      return false;
    });
    return matched
      .sort((a: BasketballMatchItem, b: BasketballMatchItem) =>
        new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime()
      )
      .slice(0, 3);
  }, [matches, followData, getFollowedTeams, getFollowedLeagues]);

  const filteredMatches = useMemo(() => {
    let result = dedupMatches(matches);

    // Source filter
    if (sourceTab === '官方竞彩') {
      result = result.filter((m: BasketballMatchItem) => isOfficialJingcai(m));
    } else if (sourceTab === '国际赛事') {
      result = result.filter((m: BasketballMatchItem) => isInternationalMatch(m));
    }

    // League filter
    if (leagueTab !== '全部') {
      result = result.filter(
        (m: BasketballMatchItem) => matchLeagueTab(m.league, leagueTab),
      );
    }

    // Status filter
    if (statusFilter !== '全部') {
      result = result.filter((m: BasketballMatchItem) => {
        const s = computeMatchStatus(
          m.matchStatus,
          m.kickoffTime,
          m.homeScore != null && m.awayScore != null,
          'basketball',
        );
        if (statusFilter === '进行中') return s === 'live';
        if (statusFilter === '待开赛') return s === 'upcoming';
        if (statusFilter === '已完赛') return s === 'finished';
        return true;
      });
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (m: BasketballMatchItem) =>
          m.homeTeam.toLowerCase().includes(q) ||
          m.awayTeam.toLowerCase().includes(q),
      );
    }

    // Sort
    if (sortBy === '时间') {
      result.sort(
        (a: BasketballMatchItem, b: BasketballMatchItem) => {
          const aStatus = statusSortPriority(
            computeMatchStatus(a.matchStatus, a.kickoffTime, a.homeScore != null && a.awayScore != null, 'basketball'),
          );
          const bStatus = statusSortPriority(
            computeMatchStatus(b.matchStatus, b.kickoffTime, b.homeScore != null && b.awayScore != null, 'basketball'),
          );
          if (aStatus !== bStatus) return aStatus - bStatus;
          return new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime();
        },
      );
    } else if (sortBy === '信心度') {
      result.sort(
        (a: BasketballMatchItem, b: BasketballMatchItem) => b.confidence - a.confidence,
      );
    } else if (sortBy === '指数') {
      result.sort((a: BasketballMatchItem, b: BasketballMatchItem) => {
        const aOdds = Math.max(a.homeWinOdds ?? 0, a.awayWinOdds ?? 0);
        const bOdds = Math.max(b.homeWinOdds ?? 0, b.awayWinOdds ?? 0);
        return bOdds - aOdds;
      });
    }

    // Favorites float to top
    result.sort(
      (a: BasketballMatchItem, b: BasketballMatchItem) =>
        (favoriteIds.has(b.id) ? 1 : 0) - (favoriteIds.has(a.id) ? 1 : 0),
    );

    return result;
  }, [matches, leagueTab, statusFilter, searchQuery, sortBy, favoriteIds, nowTimestamp]);

  const liveMatches = useMemo(() => {
    if (loading || error) return [];
    return filteredMatches.filter((m: BasketballMatchItem) => {
      const status = computeMatchStatus(
        m.matchStatus,
        m.kickoffTime,
        m.homeScore != null && m.awayScore != null,
        'basketball',
      );
      return status === 'live';
    });
  }, [filteredMatches, loading, error]);
  useEffect(() => {
    setLiveCount(liveMatches.length);
  }, [liveMatches.length]);

  return (
    <div className="min-h-screen bg-[var(--background)] md:bg-background text-foreground overflow-x-hidden">
      <PullToRefresh onRefresh={handleManualRefresh}>
      {/* 顶部信息区（免责声明 + 状态栏，不吸顶） */}
      <LiveStatusBar
        lastUpdateIso={lastUpdateIso}
        refreshInterval={refreshInterval}
        onRefresh={handleManualRefresh}
        syncError={syncError}
      />
      {/* 免责声明 */}
       <div className="bg-[var(--accent-primary)]/5 border-b border-[var(--accent-primary)]/10 md:bg-red-50 md:border-red-100">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4 flex-wrap">
           <div className="flex items-center gap-2 text-[var(--muted-foreground)] md:text-red-800 text-sm">
            <span>⚠</span>
            <span>数据仅供参考，不构成任何投注建议。仅限数据研究与学习交流使用，请理性观赛。</span>
          </div>
          <Link
            to="/disclaimer"
               className="text-xs text-[var(--accent-primary)] md:text-red-700 hover:text-[var(--accent-primary-light)] md:hover:text-red-900 font-medium transition-colors flex-shrink-0"
          >
            查看免责声明 →
          </Link>
        </div>
      </div>

      {/* 主内容区（吸顶头部 + 列表） */}
      <div className="relative">
        {/* ===== 移动端吸顶头部 ===== */}
         <div className="md:hidden fixed left-0 right-0 z-30 bg-[var(--background)]/95 backdrop-blur-xl border-b border-[var(--border)]" style={{ top: 'calc(3rem + 44px)' }}>
        <div className="px-4 pt-3 pb-2">
          {/* 日期 + 刷新按钮行 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[var(--foreground)] font-black text-lg">
                {dayjs(selectedDate).month() + 1}月{dayjs(selectedDate).date()}日
              </span>
              <span className="text-[var(--muted-foreground)] text-xs">
                {WEEKDAY_MAP[dayjs(selectedDate).day()]}
              </span>
              {isToday && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] text-[10px] font-bold">
                  今天
                </span>
              )}
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
               className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/20 active:scale-95 text-xs font-bold transition-all disabled:opacity-50 flex-shrink-0"
              aria-label="刷新比分"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {/* 日期选择条 */}
          <div className="overflow-x-auto scrollbar-hide pb-2 -mx-4">
            <div className="flex gap-2 min-w-max px-4">
              {dateList.map((d) => {
                const isSelected = selectedDate === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    data-date={d.date}
                    aria-current={isSelected ? 'date' : undefined}
                    onClick={() => handleDateChange(d.date)}
                    className={`flex-shrink-0 flex flex-col items-center justify-center w-11 h-12 rounded-xl border transition-all text-xs cursor-pointer active:scale-95 ${
                       isSelected
                         ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                         : 'bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--accent-primary)]/30'
                    }`}
                  >
                    <span className="text-base font-black leading-none tabular-nums">{d.day}</span>
                    <span
                      className={`text-[9px] mt-0.5 ${
                        isSelected ? 'text-white/70' : 'text-[var(--muted-foreground)]'
                      } ${d.isToday && !isSelected ? 'text-[var(--accent-primary)] font-bold' : ''}`}
                    >
                      {d.weekday}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 联赛筛选 chips */}
          <div className="overflow-x-auto scrollbar-hide pb-1 -mx-4"
               style={{ WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)', maskImage: 'linear-gradient(to right, black 85%, transparent 100%)' }}>
            <div className="flex gap-2 min-w-max px-4">
              {LEAGUE_TABS.map((tab: LeagueTab) => {
                const isActive = leagueTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setLeagueTab(tab)}
                      className={`flex-shrink-0 py-1 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 border ${
                        isActive
                          ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                          : 'bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--accent-primary)]/30'
                      }`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
           </div>

           {/* 状态筛选 chips */}
           <div className="overflow-x-auto scrollbar-hide pt-1 pb-1 -mx-4"
                style={{ WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)', maskImage: 'linear-gradient(to right, black 85%, transparent 100%)' }}>
             <div className="flex gap-2 min-w-max px-4">
               {STATUS_TABS.map((tab: StatusTab) => {
                 const isActive = statusFilter === tab;
                 return (
                   <button
                     key={tab}
                     type="button"
                     onClick={() => setStatusFilter(tab)}
                      className={`flex-shrink-0 py-1 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 border ${
                        isActive
                          ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                          : 'bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--accent-primary)]/30'
                      }`}
                   >
                     {tab}
                   </button>
                 );
               })}
             </div>
           </div>

           {/* Live 提示条（仅移动端） */}
           {liveMatches.length > 0 && (
             <div className="mt-2 -mx-4 px-4">
               <button
                 onClick={() => {
                   const el = document.querySelector('[data-live-group="true"]');
                   if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                 }}
                 className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-rose-500/10 text-rose-400 text-xs font-bold active:scale-[0.98] transition-transform"
               >
                 <span className="flex items-center gap-1.5">
                   <span className="relative flex h-2 w-2">
                     <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                     <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                   </span>
                   {liveMatches.length} 场比赛进行中
                 </span>
                 <ChevronRight className="w-3.5 h-3.5" />
               </button>
             </div>
           )}
          </div>
        </div>
          <div className="basketball-content pb-32 md:py-12 px-4 md:px-8 max-w-7xl mx-auto" style={{ paddingTop: 'calc(10rem + 44px)' }}>
            <style>{`@media (min-width: 768px) { .basketball-content { padding-top: 2.5rem !important; } }`}</style>
         {/* ===== 桌面端 Hero ===== */}
         <div className="hidden md:block mb-10 md:mb-12">
           <div className="eyebrow eyebrow-line mb-3">Basketball Analytics</div>
           <div className="flex items-start justify-between gap-4 flex-wrap">
             <div className="flex-1 min-w-0">
                <h1 className="text-3xl md:text-5xl font-black tracking-tight text-foreground mb-3">
                 篮球赛事分析
               </h1>
               <p className="text-sm md:text-base text-gray-400 leading-relaxed max-w-2xl">
                  篮球模型 {formatEngineVersion(modelVersion)} 统一引擎 · 锚定V10 + data-driven融合：Elo评分加权、近期战绩分层、H2H交锋净胜分、伤停压小增强；有指数线必给方向，数据不足时保留锚定基线并标注
               </p>
             </div>
             <button
               onClick={handleManualRefresh}
               disabled={isRefreshing}
               className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-nebula-crimson hover:bg-nebula-crimson/90 text-white text-sm font-medium transition-all duration-300 disabled:opacity-50 flex-shrink-0 shadow-lg shadow-nebula-crimson/20"
             >
               <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
               刷新比分
             </button>
           </div>
         </div>

         {/* Quick entries (金刚区) - 桌面端 */}
         <div className="hidden md:block mb-8 overflow-x-auto scrollbar-hide pb-2">
           <div className="flex gap-3 min-w-max" data-ai-section-type="card-menu">
             {QUICK_ENTRIES.map((entry) => {
               const Icon = entry.icon;
               return (
                 <button
                   key={entry.key}
                   onClick={() => navigate(entry.path)}
                   className="flex-shrink-0 flex items-center gap-3 px-5 py-4 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:shadow-nebula-crimson/5 hover:-translate-y-0.5 hover:border-nebula-crimson/20 transition-all duration-300 group"
                 >
                   <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center group-hover:bg-nebula-crimson group-hover:text-white transition-all duration-300 text-nebula-crimson">
                     <Icon className="w-5 h-5" />
                   </div>
                   <div className="text-left">
                     <div className="text-sm font-bold text-foreground">{entry.label}</div>
                     <div className="text-[10px] text-gray-400 uppercase tracking-wider">{entry.key}</div>
                   </div>
                 </button>
               );
             })}
           </div>
         </div>

         {/* ===== 桌面端日期选择 ===== */}
         <div className="hidden md:block mb-8">
           <div className="flex items-start md:items-center justify-between mb-4 gap-3 flex-wrap md:flex-nowrap">
              <div className="flex items-baseline gap-3 flex-shrink-0">
               <span className="text-2xl font-black tracking-tight text-foreground">
                 {dayjs(selectedDate).month() + 1}月{dayjs(selectedDate).date()}日
               </span>
               <span className="text-sm text-gray-400">
                 {WEEKDAY_MAP[dayjs(selectedDate).day()]}
               </span>
               {isToday && (
                 <span className="px-2.5 py-0.5 rounded-full bg-nebula-crimson/10 text-nebula-crimson text-xs font-bold">
                   今天
                 </span>
               )}
             </div>
             <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-end flex-1 md:flex-none min-w-0">
                <div className="text-[11px] text-muted-foreground">
                   最后更新：{lastUpdateTime}
                 </div>
                 {leagueTab === 'WNBA' && wnbaSyncStatus?.lastSuccessAt && (
                   <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                     <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
                     WNBA数据更新于 {formatBeijingTime(wnbaSyncStatus.lastSuccessAt, 'datetime')}
                   </div>
                 )}
                 {leagueTab === 'WNBA' && wnbaSyncStatus?.status === 'failed' && (
                   <div className="text-[11px] text-amber-600 flex items-center gap-1">
                     <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                     同步失败：{wnbaSyncStatus.lastError?.slice(0, 30)}
                   </div>
                 )}
                <button
                  onClick={toggleAutoRefresh}
                  className={`text-[11px] font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                    autoRefresh
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-gray-50'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
                  {autoRefresh ? `${autoRefreshCountdown}s` : '自动刷新'}
                </button>
              </div>
           </div>
            <div className="overflow-x-auto scrollbar-hide pb-2 -mx-6 px-8 md:mx-0 md:px-0">
              <div className="flex gap-2 min-w-max">
               {dateList.map((d) => {
                 const isSelected = selectedDate === d.date;
                 return (
                   <button
                     key={d.date}
                     type="button"
                     data-date={d.date}
                     aria-current={isSelected ? 'date' : undefined}
                     onClick={() => handleDateChange(d.date)}
                     className={`flex-shrink-0 flex flex-col items-center justify-center w-14 h-16 rounded-2xl border transition-all text-xs cursor-pointer ${
                       isSelected
                         ? 'bg-nebula-crimson text-white border-nebula-crimson shadow-lg shadow-nebula-crimson/25'
                         : 'bg-white text-foreground border-gray-100 hover:border-nebula-crimson/30 hover:shadow-md'
                     }`}
                   >
                     <span className="text-lg font-black leading-none tabular-nums">{d.day}</span>
                     <span
                       className={`text-[10px] mt-1 uppercase tracking-wider ${
                         isSelected ? 'text-white/70' : 'text-gray-400'
                       } ${d.isToday && !isSelected ? 'text-nebula-crimson font-bold' : ''}`}
                     >
                       {d.weekday}
                     </span>
                   </button>
                 );
               })}
             </div>
           </div>
         </div>

           {/* 指数线覆盖说明 - 桌面端 */}
           <div className="hidden md:block mb-6">
             <div className="bg-amber-50 text-amber-700 text-sm px-4 py-2.5 rounded-lg border border-amber-100 flex items-start gap-2">
               <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
               <span className="flex-1 min-w-0 leading-relaxed break-words">
                 篮球指数线覆盖有限，仅官方数据开售场次与部分联赛有指数线，未开售场次显示指数线待开放
               </span>
             </div>
          </div>

         {/* Source tabs - 桌面端 */}
         <div className="hidden md:block mb-6">
           <div className="bg-gray-100 p-1 rounded-2xl inline-flex">
              {SOURCE_TABS.map((tab: SourceTab) => {
                const isActive = sourceTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSourceTab(tab)}
                    className={`px-8 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
                      isActive
                        ? 'bg-white text-nebula-crimson shadow-sm'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>

         {/* League tabs - 桌面端 */}
         <div className="hidden md:block mb-6 overflow-x-auto scrollbar-hide pb-1">
           <div className="bg-gray-50 p-1 rounded-2xl inline-flex min-w-full gap-1">
             {LEAGUE_TABS.map((tab) => {
               const isActive = leagueTab === tab;
               return (
                 <button
                   key={tab}
                   onClick={() => setLeagueTab(tab)}
                   className={`flex-shrink-0 flex-1 min-w-max px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-300 ${
                     isActive
                       ? 'bg-white text-foreground shadow-md'
                       : 'text-gray-400 hover:text-foreground hover:bg-white/50'
                   }`}
                 >
                   {tab}
                 </button>
               );
             })}
           </div>
         </div>

         {/* Search + source + sort — 移动端单列 / 桌面端原布局 */}
          {/* 移动端：搜索 + 来源切换 + 排序 */}
          <div className="md:hidden mb-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索球队名"
                 className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--accent-primary)]/30 focus:ring-2 focus:ring-[var(--accent-primary)]/10 transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
               <div className="flex-1 bg-[var(--card)] p-0.5 rounded-xl flex border border-[var(--border)]">
                {SOURCE_TABS.map((tab: SourceTab) => {
                  const isActive = sourceTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSourceTab(tab)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                        isActive
                           ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                           : 'text-[var(--muted-foreground)]'
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--card)]">
                {SORT_OPTIONS.map((opt: SortOption) => {
                  const isActive = sortBy === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setSortBy(opt)}
                      className={`px-2.5 py-2 text-[11px] font-bold transition-all active:scale-95 ${
                        isActive
                          ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                          : 'text-[var(--muted-foreground)]'
                      }`}
                    >
                      {opt === '时间' && <Clock className="w-3 h-3 inline mr-0.5" />}
                      {opt === '信心度' && <TrendingUp className="w-3 h-3 inline mr-0.5" />}
                      {opt === '指数' && <Percent className="w-3 h-3 inline mr-0.5" />}
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

         {/* Search + sort - 桌面端 */}
         <div className="hidden md:flex items-center gap-3 mb-8">
           <div className="relative flex-1">
             <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
             <input
               type="text"
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               placeholder="搜索球队名"
               className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-gray-100 text-sm text-foreground placeholder:text-gray-400 focus:outline-none focus:border-nebula-crimson/30 focus:ring-2 focus:ring-nebula-crimson/10 transition-all shadow-sm"
             />
           </div>
           <div className="flex items-center rounded-xl border border-gray-100 overflow-hidden bg-white shadow-sm">
             {SORT_OPTIONS.map((opt) => {
               const isActive = sortBy === opt;
               return (
                 <button
                   key={opt}
                   onClick={() => setSortBy(opt)}
                   className={`px-3.5 py-3 text-xs font-bold transition-all duration-200 ${
                     isActive
                       ? 'bg-nebula-crimson/10 text-nebula-crimson'
                       : 'bg-white text-gray-400 hover:text-foreground hover:bg-gray-50'
                   }`}
                 >
                   {opt === '时间' && <Clock className="w-3.5 h-3.5 inline mr-1" />}
                   {opt === '信心度' && <TrendingUp className="w-3.5 h-3.5 inline mr-1" />}
                   {opt === '指数' && <Percent className="w-3.5 h-3.5 inline mr-1" />}
                   {opt}
                 </button>
               );
             })}
           </div>
         </div>

        <div className="mb-4 md:mb-6">
          <FinishedSummary matches={filteredMatches} />
        </div>

         {/* 我的关注板块 */}
         {!loading && followedMatches.length > 0 && (
             <div className="rounded-xl md:rounded-2xl border border-[var(--border)] md:border-border bg-[var(--card)] md:bg-card p-4 md:p-5 md:shadow-sm mb-4 md:mb-6">
             <div className="flex items-center justify-between mb-3">
               <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 fill-[var(--accent-primary)] text-[var(--accent-primary)] md:fill-nebula-crimson md:text-nebula-crimson" />
                  <h2 className="text-lg font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                   我的关注
                 </h2>
                  <span className="text-xs text-[var(--muted-foreground)] md:text-gray-400">{followedMatches.length} 场</span>
               </div>
               <button
                  className="text-xs text-[var(--accent-primary)] md:text-nebula-crimson font-medium hover:opacity-80 transition-opacity"
                 onClick={() => {
                   const q = followedMatches[0]?.homeTeam || '';
                   setSearchQuery(q);
                 }}
               >
                查看全部
              </button>
            </div>
             <div className="space-y-2">
               {followedMatches.map((match: BasketballMatchItem) => {
                 const isFollowedHome = getFollowedTeams('basketball').includes(match.homeTeam);
                 const isFollowedAway = getFollowedTeams('basketball').includes(match.awayTeam);
                 const isLeagueFollowed = getFollowedLeagues('basketball').includes(match.league);
                 return (
                   <div
                     key={match.id}
                     onClick={() => navigate(`/basketball/detail/${match.id}`)}
                      className="flex items-center justify-between p-3 rounded-xl bg-[var(--card)] md:bg-gray-50 border border-[var(--border)] md:border-0 hover:bg-[var(--secondary)] md:hover:bg-nebula-crimson/5 transition-colors cursor-pointer group"
                   >
                     <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground bg-[var(--secondary)] md:bg-white px-2 py-0.5 rounded font-mono font-bold flex-shrink-0 border border-[var(--border)] md:border-gray-100">
                         {match.matchNo || '—'}
                       </span>
                       <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground truncate">
                            {isFollowedHome && <span className="text-[var(--accent-primary)] md:text-nebula-crimson mr-1">★</span>}
                           {match.homeTeam}
                            <span className="text-[var(--muted-foreground)] md:text-muted-foreground mx-1.5">vs</span>
                           {match.awayTeam}
                            {isFollowedAway && <span className="text-[var(--accent-primary)] md:text-nebula-crimson ml-1">★</span>}
                         </div>
                          <div className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5 flex items-center gap-1.5">
                           <span>{match.league}</span>
                            {isLeagueFollowed && <span className="text-[var(--accent-primary)] md:text-nebula-crimson">·已关注联赛</span>}
                         </div>
                       </div>
                     </div>
                     <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
                        <span className="text-xs font-mono text-[var(--foreground)] md:text-foreground">
                         {formatBeijingTime(match.kickoffTime, 'time')}
                       </span>
                       {match.predictionDirection && match.predictionDirection !== '观望' && match.predictionDirection !== '-' && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-primary)]/15 md:bg-nebula-crimson/10 text-[var(--accent-primary)] md:text-nebula-crimson">
                           {match.predictionDirection}
                         </span>
                       )}
                     </div>
                   </div>
                 );
               })}
             </div>
          </div>
        )}

          {/* Match list */}
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-3 pt-2 md:pt-4"
              >
              {[0, 1, 2, 3, 4].map((i: number) => (
                 <div
                   key={i}
                   className="rounded-2xl border border-[var(--border)] md:border-border bg-[var(--card)] md:bg-card p-4 space-y-3 md:shadow-sm"
                 >
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 text-right">
                      <Skeleton className="h-5 w-24 ml-auto" />
                    </div>
                    <Skeleton className="h-8 w-16 shrink-0" />
                    <div className="flex-1 text-left">
                      <Skeleton className="h-5 w-24" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton className="h-1.5 w-full rounded-full" />
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
              <ErrorState
                size="md"
                message={error}
                description="请检查网络连接后重试"
                onRetry={() => void fetchMatches(true)}
              />
              </motion.div>
             ) : filteredMatches.length === 0 ? (
             <div className="rounded-2xl border border-[var(--border)] md:border-gray-100 bg-[var(--card)] md:bg-white p-12 text-center md:shadow-sm metric-card">
               <div className="w-16 h-16 rounded-2xl bg-[var(--secondary)] md:bg-gray-50 flex items-center justify-center mx-auto mb-5">
                {leagueTab !== '全部' ? (
                  <CalendarDays className="w-8 h-8 text-[var(--muted-foreground)] md:text-gray-300" />
                ) : sourceTab === '官方竞彩' && !isToday ? (
                   <Clock className="w-8 h-8 text-[var(--muted-foreground)] md:text-gray-300" />
                ) : (
                  <CalendarDays className="w-8 h-8 text-[var(--muted-foreground)] md:text-gray-300" />
                )}
              </div>
                <p className="text-lg font-bold text-[var(--foreground)] md:text-foreground mb-2">
                 {sourceTab === '国际赛事' && leagueTab === '全部'
                   ? (isToday ? '今日暂无国际赛事' : '该日暂无国际赛事数据')
                   : leagueTab !== '全部'
                     ? `今日暂无${leagueTab}赛事`
                     : isToday
                       ? '今日暂无官方开售场次'
                       : '竞彩暂未开售该日场次'}
               </p>
                <p className="text-sm text-[var(--muted-foreground)] md:text-gray-400 mb-4">
                  {leagueTab !== '全部'
                    ? '切换其他日期或联赛查看更多赛事'
                    : sourceTab === '国际赛事'
                      ? '切换其他日期或联赛查看更多赛事'
                      : isToday
                         ? '为您精选明日精彩赛事'
                         : '通常赛前一天中午/下午陆续放出，开售后自动生成预测'}
               </p>
                {(isToday && leagueTab === '全部' && sourceTab === '官方竞彩') ? (
                 <button
                   onClick={() => {
                     const next = dayjs(selectedDate).add(1, 'day').format('YYYY-MM-DD');
                     handleDateChange(next);
                   }}
                      className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-[var(--accent-primary)]/15 md:bg-nebula-crimson/10 text-[var(--accent-primary)] md:text-nebula-crimson text-sm font-bold hover:bg-[var(--accent-primary)]/25 md:hover:bg-nebula-crimson/20 transition-colors"
                  >
                    查看明日赛事
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (!isToday && leagueTab === '全部' && sourceTab === '官方竞彩') ? (
                  <button
                    onClick={() => {
                      setSourceTab('国际赛事');
                    }}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-orange-500/15 md:bg-basketball-orange/10 text-orange-400 md:text-basketball-orange text-sm font-bold hover:bg-orange-500/25 md:hover:bg-basketball-orange/20 transition-colors"
                 >
                   查看 ESPN 赛程预览
                   <ChevronRight className="w-3.5 h-3.5" />
                 </button>
               ) : null}
           </div>
            ) : sourceTab === '官方竞彩' ? (
              <div className="space-y-3 md:space-y-0">
                <JcSaleStatusGroups
                  matches={filteredMatches}
                  favoriteIds={favoriteIds}
                  onToggleFavorite={toggleFavorite}
                  nowTimestamp={nowTimestamp}
                />
              </div>
            ) : (
              <div className="space-y-3 md:space-y-0">
                <LeagueGroups
                  matches={filteredMatches}
                  favoriteIds={favoriteIds}
                  onToggleFavorite={toggleFavorite}
                  nowTimestamp={nowTimestamp}
                />
              </div>
             )}
           </AnimatePresence>

        {/* Model description */}
        <div className="mt-10 p-6 rounded-2xl border border-gray-100 bg-white shadow-sm emphasis-bar">
          <h3 className="text-lg font-black tracking-tight mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-nebula-crimson" />
            模型说明
          </h3>
          <div className="text-sm text-gray-400 space-y-2.5 leading-relaxed">
             <p>• 篮球模型 {formatEngineVersion(modelVersion)}（统一引擎 · 对称±2双向判定 · 分层闸门）：锚定V10.2指数线模型为基底，融合data-driven的Elo评分、近期战绩、H2H交锋与伤停数据，数据充足场次自动升级为统一引擎，数据不足保持锚定基线。实力方向双向判定——模型预期净胜比热门方线强≥2分 → 看好热门方（中/高信心）；模型预期比热门方线弱≤-2分 → 反向看好受让方（低信心）；介于±2之间 → 跟指数线热门方（低信心）。客队热门系统性降权1.5分，中盘3.5-6分额外+0.8分，深盘10.5-15分额外+0.6分。伤停融合：热门方核心缺阵≥2人或伤停贡献≥20PPG时，禁止看好热门方，强制转向受让方（低信心）。深盘规则：让分线≥25分且方向正确概率47%-53%才观望，12-24分一律给方向（低信心）。大小分采用分层闸门（浅/中盘差＜8分阈值4分、深盘8-15分阈值2分、超深盘≥15分阈值3分，概率约束40%-60%），有指数线必给方向。融合增强：有近期战绩/H2H/伤停数据时基于预期总分与线值的差计算概率，不再贴线50/50。</p>
             <p>• 情景调整（回测验证）：WNBA 9月赛季末强队过线≈80% (+0.84σ)、5/7月赛季初≈32% (-0.47σ)；WNBA大小月份：6月+4分(大)、7月+3分(大)、8月-2.5分(小)、9月-1.5分(小)；边缘指数核心缺阵热门方球星缺阵→弱队侧≈69% (+0.50σ)</p>
             <p>• 独立预期净胜分由市场共识净胜分 + 情景调整（赛季阶段、伤停、战意等）推导，独立于指数；V11额外融合Elo评分（权重0.25）修正预期净胜分</p>
              <p>• 信心分级：高(偏离50%≥15%) / 中(8%~15%) / 低(低于8%)；低信心场次不进数据组合</p>
            <p>• 赛果、实力方向、总分、胜分差四个口径独立建模，互不干扰</p>
            <p>• 数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛。</p>
          </div>
        </div>

        {/* v7.0 更新公告 */}
        <Dialog open={showV67Announce} onOpenChange={closeV67Announce}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-primary">
                <Sparkles className="w-5 h-5" />
                篮球模型 v7.0 全面升级
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-1">
                 集中到统计优势区，弱边缘一律观望，模型规则口径统一。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-foreground/90">
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">硬不变量</span>
                 <span>进行中/未分析比赛概率0/0时，总分与实力方向强制清空为观望，绝不残留方向。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">真实调整</span>
                 <span>总分调整由真实节奏（场均得分）驱动，有正有负；缺数据时调整量为0，不再默认+3看大。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">调整分解</span>
                <span>每场调整分解为 pace/stage/injury 三项，详情可核对，防止系统性偏向。</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground text-right">
              2026-09-25
            </div>
          </DialogContent>
        </Dialog>
       </div>
       </div>
      </PullToRefresh>
    </div>
  );
}
