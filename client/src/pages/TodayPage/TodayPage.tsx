import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getVersion } from '@client/src/api/version';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
     Calendar,
     CalendarDays,
     AlertCircle,
     Trophy,
     ArrowUpDown,
     Heart,
     ChevronDown,
     ChevronUp,
     ChevronRight,
      RefreshCw,
        TrendingUp,
      Users,
      BookOpen,
       HelpCircle,
       Sparkles,
       Activity,
       Database,
    } from 'lucide-react';
import {
    matchesApi,
    favoritesApi,
    predictionRecordsApi,
    followedTeamsApi,
    syncApi,
  } from '@client/src/api';
import { toast } from 'sonner';
import type { MatchItem, DateStatsItem } from '@shared/api.interface';
import type { GetMatchesParams } from '@client/src/api/matches';
import MatchCard from './MatchCard';
import { dedupMatches } from '@client/src/utils/match-dedup';
import { LiveStatusBar } from '@client/src/components/LiveStatusBar';
import { computeMatchStatus, statusSortPriority } from '@client/src/utils/format';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { ErrorState } from '@client/src/components/ui/error-state';
import { useFollowStore } from '@client/src/hooks/useFollowStore';
import { formatKickoffDisplay } from '@client/src/utils/format-beijing-time';
import { useMinuteTicker } from '@client/src/utils/match-card-enhance';

function getBeijingToday(): string {
  const now = new Date();
  const beijingMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().slice(0, 10);
}

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const getDateList = () => {
  const today = dayjs(getBeijingToday());
  const dates: { date: string; day: number; weekday: string; isToday: boolean }[] = [];
  for (let i = -14; i <= 2; i += 1) {
    const d = today.add(i, 'day');
    dates.push({
      date: d.format('YYYY-MM-DD'),
      day: d.date(),
      weekday: WEEKDAY_MAP[d.day()],
      isToday: i === 0,
    });
  }
  return dates;
};

const CONFIDENCE_OPTIONS = [
  { value: '', label: '全部参考指数' },
  { value: 'high', label: '高 (≥60%)' },
  { value: 'medium', label: '中 (40-60%)' },
  { value: 'low', label: '低 (<40%)' },
];

const DIRECTION_OPTIONS = [
  { value: '', label: '全部方向' },
  { value: '主胜', label: '主胜' },
  { value: '平', label: '平' },
  { value: '客胜', label: '客胜' },
  { value: '观望', label: '观望' },
];

const SORT_OPTIONS = [
  { value: 'kickoff', label: '开赛时间' },
  { value: 'confidence', label: '参考指数' },
];

const FOOTBALL_DATE_KEY = 'football_selected_date';

const SOURCE_TABS = ['竞彩官方', '北单', '国际赛事'] as const;
type SourceTab = (typeof SOURCE_TABS)[number];

const TODAY_STATE_KEY = 'today_list_state';

interface TodayListState {
  selectedDate: string;
  sourceTab: SourceTab;
  scrollTop: number;
}

function loadTodayState(defaultDate: string): TodayListState {
  try {
    const saved = sessionStorage.getItem(TODAY_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<TodayListState>;
      return {
        selectedDate: parsed.selectedDate ?? defaultDate,
        sourceTab: (parsed.sourceTab && (SOURCE_TABS as readonly string[]).includes(parsed.sourceTab))
          ? parsed.sourceTab as SourceTab
          : '竞彩官方',
        scrollTop: parsed.scrollTop ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return { selectedDate: defaultDate, sourceTab: '竞彩官方', scrollTop: 0 };
}

function saveTodayState(state: Partial<TodayListState>): void {
  try {
    const existing = sessionStorage.getItem(TODAY_STATE_KEY);
    const prev: TodayListState = existing
      ? (JSON.parse(existing) as TodayListState)
      : { selectedDate: '', sourceTab: '竞彩官方', scrollTop: 0 };
    sessionStorage.setItem(TODAY_STATE_KEY, JSON.stringify({ ...prev, ...state }));
  } catch {
    // ignore
  }
}

function isOfficialJingcai(m: MatchItem): boolean {
  return m.source === 'sporttery';
}

function isBeidanMatch(m: MatchItem): boolean {
  return m.source === 'beidan';
}

function isInternationalMatch(m: MatchItem): boolean {
  return m.source !== 'sporttery' && m.source !== 'beidan';
}

type JcSaleStatus = 'on_sale' | 'pending_sale' | 'suspended' | 'live' | 'finished';

function getJcSaleStatus(m: MatchItem): JcSaleStatus {
  if (m.matchStatus === 'finished') return 'finished';
  if (m.matchStatus === 'live') return 'live';
  const hasOdds =
    (m.handicapOddsHome != null && m.handicapOddsHome > 0) ||
    (m.homeWinOdds != null && m.homeWinOdds > 0) ||
    (m.overUnder != null && m.overUnder !== '');
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

const getFootballScrollKey = (date: string): string => `football_scroll_${date}`;
const getFootballLeagueKey = (date: string): string => `football_league_${date}`;
const getFootballConfidenceKey = (date: string): string => `football_confidence_${date}`;
const getFootballDirectionKey = (date: string): string => `football_direction_${date}`;
const getFootballSortKey = (date: string): string => `football_sort_${date}`;

const QUICK_ENTRIES = [
  { label: '球队', icon: Users, path: '/teams', color: 'text-primary', bg: 'bg-primary/10' },
  { label: '模型规则', icon: BookOpen, path: '/rules', color: 'text-info', bg: 'bg-info/10' },
  { label: '使用帮助', icon: HelpCircle, path: '/help', color: 'text-muted-foreground', bg: 'bg-muted' },
];

interface JcSaleStatusGroupsProps {
  matches: MatchItem[];
  onToggleFavorite: (matchId: string, isFavorited: boolean) => void;
  onViewDetail: (id: string) => void;
  nowTimestamp: number;
  storageKey?: string;
}

function JcSaleStatusGroups({ matches, onToggleFavorite, onViewDetail, nowTimestamp, storageKey = 'football_jc_groups_collapsed' }: JcSaleStatusGroupsProps) {
  const groups = JC_SALE_GROUPS.map((g) => ({
    ...g,
    items: matches.filter((m: MatchItem) => getJcSaleStatus(m) === g.key),
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
    <div className="space-y-8">
      {groups.map((group) => {
        const isCollapsed = collapsedKeys.has(group.key);
        return (
          <div key={group.key}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${group.accent}`} />
                 <h3 className="text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                  {group.label}
                   <span className="ml-2 text-xs text-[var(--muted-foreground)] md:text-gray-400 font-normal">{group.items.length} 场</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                 className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--accent-primary)] md:hover:text-nebula-crimson transition-colors"
                aria-label={isCollapsed ? `展开${group.label}` : `收起${group.label}`}
              >
                {isCollapsed ? '展开' : '收起'}
                {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!isCollapsed && (
              <div className="space-y-4" data-ai-section-type="card-list">
                {group.items
                  .sort((a: MatchItem, b: MatchItem) => {
                    const aStatus = statusSortPriority(
                      computeMatchStatus(a.matchStatus, a.kickoffTime, a.homeScore != null && a.awayScore != null, 'football'),
                    );
                    const bStatus = statusSortPriority(
                      computeMatchStatus(b.matchStatus, b.kickoffTime, b.homeScore != null && b.awayScore != null, 'football'),
                    );
                    if (aStatus !== bStatus) return aStatus - bStatus;
                    return a.kickoffTime.localeCompare(b.kickoffTime);
                  })
                  .map((match: MatchItem) => {
                    const computed = computeMatchStatus(
                      match.matchStatus,
                      match.kickoffTime,
                      match.homeScore != null && match.awayScore != null,
                      'football',
                    );
                    return (
                      <MatchCard
                        key={match.id}
                        match={match}
                        computedStatus={computed}
                        onToggleFavorite={onToggleFavorite}
                        onViewDetail={onViewDetail}
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

interface LeagueGroupsProps {
  matches: MatchItem[];
  onToggleFavorite: (matchId: string, isFavorited: boolean) => void;
  onViewDetail: (id: string) => void;
  nowTimestamp: number;
}

function LeagueGroups({ matches, onToggleFavorite, onViewDetail, nowTimestamp }: LeagueGroupsProps) {
  const groupsMap = new Map<string, MatchItem[]>();
  for (const m of matches) {
    const league = m.league || '其他赛事';
    if (!groupsMap.has(league)) groupsMap.set(league, []);
    groupsMap.get(league)!.push(m);
  }
  const groups = Array.from(groupsMap.entries())
    .sort((a, b) => {
      const aTime = Math.min(...a[1].map((m: MatchItem) => new Date(m.kickoffTime).getTime()));
      const bTime = Math.min(...b[1].map((m: MatchItem) => new Date(m.kickoffTime).getTime()));
      return aTime - bTime;
    });

  if (groups.length === 0) return null;

  return (
    <div className="space-y-8">
      {groups.map(([league, items]) => (
        <div key={league}>
          <div className="flex items-center gap-2 mb-4">
             <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)] md:bg-seq-5" />
                 <h3 className="text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground">
              {league}
               <span className="ml-2 text-xs text-[var(--muted-foreground)] md:text-gray-400 font-normal">{items.length} 场</span>
            </h3>
          </div>
           <div className="space-y-4" data-ai-section-type="card-list">
             {items
               .sort((a: MatchItem, b: MatchItem) => {
                 const aStatus = statusSortPriority(
                   computeMatchStatus(a.matchStatus, a.kickoffTime, a.homeScore != null && a.awayScore != null, 'football'),
                 );
                 const bStatus = statusSortPriority(
                   computeMatchStatus(b.matchStatus, b.kickoffTime, b.homeScore != null && b.awayScore != null, 'football'),
                 );
                 if (aStatus !== bStatus) return aStatus - bStatus;
                 return a.kickoffTime.localeCompare(b.kickoffTime);
               })
               .map((match: MatchItem) => {
                const computed = computeMatchStatus(
                  match.matchStatus,
                  match.kickoffTime,
                  match.homeScore != null && match.awayScore != null,
                  'football',
                );
                return (
                  <MatchCard
                    key={match.id}
                    match={match}
                    computedStatus={computed}
                    onToggleFavorite={onToggleFavorite}
                    onViewDetail={onViewDetail}
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
  matches: MatchItem[];
  onToggleFavorite: (matchId: string, isFavorited: boolean) => void;
  onViewDetail: (id: string) => void;
  nowTimestamp: number;
}

function AllMatchesSplitView({ matches, onToggleFavorite, onViewDetail, nowTimestamp }: AllMatchesSplitViewProps) {
  const jcMatches = matches.filter((m: MatchItem) => isOfficialJingcai(m));
  const intlMatches = matches.filter((m: MatchItem) => isInternationalMatch(m));

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4">
           <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)] md:bg-nebula-crimson" />
                 <h3 className="text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground">
            官方数据（官方数据平台开售）
             <span className="ml-2 text-xs text-[var(--muted-foreground)] md:text-gray-400 font-normal">{jcMatches.length} 场</span>
          </h3>
        </div>
        {jcMatches.length > 0 ? (
          <JcSaleStatusGroups
            matches={jcMatches}
            onToggleFavorite={onToggleFavorite}
            onViewDetail={onViewDetail}
            nowTimestamp={nowTimestamp}
          />
        ) : (
          <div className="text-center py-10 bg-white rounded-2xl border border-gray-100">
            <p className="text-sm text-gray-400">今日暂无官方开售场次</p>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4">
           <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)]/60 md:bg-seq-5" />
                 <h3 className="text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground">
            国际赛事（球美宝同步）
             <span className="ml-2 text-xs text-[var(--muted-foreground)] md:text-gray-400 font-normal">{intlMatches.length} 场</span>
          </h3>
        </div>
        {intlMatches.length > 0 ? (
          <LeagueGroups
            matches={intlMatches}
            onToggleFavorite={onToggleFavorite}
            onViewDetail={onViewDetail}
            nowTimestamp={nowTimestamp}
          />
        ) : (
          <div className="text-center py-10 bg-[var(--card)] md:bg-white rounded-2xl border border-[var(--border)] md:border-gray-100">
             <p className="text-sm text-[var(--muted-foreground)] md:text-gray-400">今日暂无国际赛事</p>
          </div>
        )}
      </div>
    </div>
  );
}

const getInitialFootballDate = (searchParams: URLSearchParams): string => {
  const urlDate = searchParams.get('date');
  if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
    return urlDate;
  }
  const today = getBeijingToday();
  try {
    const saved = localStorage.getItem(FOOTBALL_DATE_KEY);
    if (saved) return saved;
  } catch {
    // ignore
  }
  return today;
};

const TodayPage = () => {
  const navigate = useNavigate();
  const todayStr = getBeijingToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = getInitialFootballDate(searchParams);
  const initialTodayState = loadTodayState(initialDate);
  // URL 参数优先级最高，其次 sessionStorage（返回详情恢复），最后 localStorage
  const resolvedInitialDate = searchParams.get('date') ? initialDate : initialTodayState.selectedDate;
  const [selectedDate, setSelectedDateState] = useState<string>(resolvedInitialDate);
  const selectedDateRef = useRef<string>(resolvedInitialDate);

  const setSelectedDate = useCallback((newDate: string) => {
    selectedDateRef.current = newDate;
    setSelectedDateState(newDate);
    try {
      localStorage.setItem(FOOTBALL_DATE_KEY, newDate);
    } catch { /* ignore */ }
    saveTodayState({ selectedDate: newDate, scrollTop: 0 });
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
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [dateStr, setDateStr] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const [highConfCount, setHighConfCount] = useState<number>(0);
  const [modelVersion, setModelVersion] = useState<string>('');
  const PAGE_SIZE = 50;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dateStats, setDateStats] = useState<DateStatsItem[]>([]);

  const [selectedLeague, setSelectedLeague] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(getFootballLeagueKey(initialDate));
      if (saved !== null) return saved;
    } catch { /* ignore */ }
    return '';
  });
  const [selectedConfidence, setSelectedConfidence] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(getFootballConfidenceKey(initialDate));
      if (saved !== null) return saved;
    } catch { /* ignore */ }
    return '';
  });
  const [selectedDirection, setSelectedDirection] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(getFootballDirectionKey(initialDate));
      if (saved !== null) return saved;
    } catch { /* ignore */ }
    return '';
  });
  const [sourceTab, setSourceTabState] = useState<SourceTab>(initialTodayState.sourceTab);

  const setSourceTab = useCallback((tab: SourceTab) => {
    setSourceTabState(tab);
    saveTodayState({ sourceTab: tab });
  }, []);

  const [sortBy, setSortBy] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(getFootballSortKey(initialDate));
      if (saved !== null) return saved;
    } catch { /* ignore */ }
    return 'kickoff';
  });
   const [followFilter, setFollowFilter] = useState<'all' | 'followed'>('all');
  const [followedTeamNames, setFollowedTeamNames] = useState<string[]>([]);
  const [followLoading, setFollowLoading] = useState(false);
  const [lastUpdateIso, setLastUpdateIso] = useState<string>(new Date().toISOString());
  const lastUpdateTime = formatBeijingTime(lastUpdateIso, 'time-seconds');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState<number>(30);
  const AUTO_REFRESH_INTERVAL = 30;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncError, setSyncError] = useState(false);

   const nowTimestamp = useMinuteTicker();

   const { data: followData, getFollowedTeams, getFollowedLeagues } = useFollowStore();

    const dateList = getDateList();
    const currentDateRef = useRef<string>(selectedDate);

  // 初次加载从 sessionStorage 恢复滚动位置（优先级高于 localStorage 按日期 key）
  useEffect(() => {
    if (initialTodayState.scrollTop > 0) {
      const timer = setTimeout(() => {
        window.scrollTo(0, initialTodayState.scrollTop);
      }, 100);
      return () => clearTimeout(timer);
    }
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动时防抖写入 sessionStorage（作为返回恢复的主依据）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveTodayState({ scrollTop: window.scrollY });
      }, 150);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);
  const [reviewExpanded, setReviewExpanded] = useState<boolean>(false);
  const [showV68Announce, setShowV68Announce] = useState<boolean>(false);

  // v6.8.8 更新公告（已停用，保留结构以便后续复用）
  useEffect(() => {
    // 停用：不再自动弹出
  }, []);

  useEffect(() => {
    getVersion()
      .then((v) => {
        if (v?.version) setModelVersion(`v${v.version}`);
      })
      .catch((err: unknown) => {
        logger.error('[today] 加载版本失败', err);
      });
  }, []);

  const closeV68Announce = () => {
    setShowV68Announce(false);
    localStorage.setItem('v688_announce_seen', '1');
  };

  // 保持 currentDateRef 与 selectedDate 同步，供滚动防抖使用
  useEffect(() => {
    currentDateRef.current = selectedDate;
  }, [selectedDate]);

  const currentDateStats = useMemo(() => {
    return dateStats.find((s: DateStatsItem) => s.date === selectedDate) ?? null;
  }, [dateStats, selectedDate]);

  const finishedMatches = useMemo(() => {
    return matches.filter((m: MatchItem) => {
      const computed = computeMatchStatus(
        m.matchStatus,
        m.kickoffTime,
        m.homeScore != null && m.awayScore != null,
        'football',
      );
      return computed === 'finished';
    });
  }, [matches]);

  // 判断是否有进行中的比赛（含开赛时间兜底）
  const hasLiveMatch = useMemo(() => {
    return matches.some((m: MatchItem) => {
      const computed = computeMatchStatus(
        m.matchStatus,
        m.kickoffTime,
        m.homeScore != null && m.awayScore != null,
        'football',
      );
      return computed === 'live';
    });
  }, [matches]);

  // 智能刷新频率：有live比赛30s，否则5分钟
   const refreshInterval = hasLiveMatch ? 30 : 300;

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

  const reviewStats = useMemo(() => {
    // 只统计有赛前方向的完赛场次（predictionDirection 为主胜/平/客胜）
    const predictedMatches = finishedMatches.filter(
      (m: MatchItem) =>
        m.predictionDirection === '主胜' ||
        m.predictionDirection === '平' ||
        m.predictionDirection === '客胜',
    );
    const total = predictedMatches.length;
    if (total === 0) return null;

    const wdwHits = predictedMatches.filter(
      (m: MatchItem) => m.hitWdw === true,
    ).length;
    const handicapHits = predictedMatches.filter(
      (m: MatchItem) => m.hitHandicap === true,
    ).length;
    const ouHits = predictedMatches.filter(
      (m: MatchItem) => m.hitOverunder === true,
    ).length;
    const hitCount = wdwHits;
    const missCount = total - hitCount;

    return {
      total,
      wdwHitRate: wdwHits / total,
      handicapHitRate: handicapHits / total,
      overUnderHitRate: ouHits / total,
      hitCount,
      missCount,
    };
  }, [finishedMatches]);

  const deriveActualResult = (
    homeScore: number | undefined,
    awayScore: number | undefined,
  ): '主胜' | '平' | '客胜' => {
    const h = homeScore ?? 0;
    const a = awayScore ?? 0;
    if (h > a) return '主胜';
    if (h < a) return '客胜';
    return '平';
  };

  // 本地关注的球队/联赛匹配的比赛（最多3场）
  const followedMatches = useMemo(() => {
    const followedTeams = new Set(getFollowedTeams('football'));
    const followedLeagues = new Set(getFollowedLeagues('football'));
    if (followedTeams.size === 0 && followedLeagues.size === 0) return [];
    const matched = dedupMatches(matches).filter((m: MatchItem) => {
      if (followedTeams.has(m.homeTeam) || followedTeams.has(m.awayTeam)) return true;
      if (followedLeagues.has(m.league)) return true;
      return false;
    });
    return matched
      .sort((a: MatchItem, b: MatchItem) => a.kickoffTime.localeCompare(b.kickoffTime))
      .slice(0, 3);
  }, [matches, followData, getFollowedTeams, getFollowedLeagues]);

  const leagueOptions = useMemo(() => {
    const uniqueLeagues = new Set<string>();
    for (const m of matches) {
      if (m.league) uniqueLeagues.add(m.league);
    }
    const sorted = Array.from(uniqueLeagues).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return [
      { value: '', label: '全部' },
      ...sorted.map((league) => ({ value: league, label: league })),
    ];
  }, [matches]);

  const displayedMatches = useMemo(() => {
    let result: MatchItem[] = dedupMatches(matches);
    if (followFilter === 'followed') {
      result = matches.filter(
        (m: MatchItem) =>
          followedTeamNames.includes(m.homeTeam) ||
          followedTeamNames.includes(m.awayTeam),
      );
    }
    if (sortBy === 'kickoff') {
      result = [...result].sort((a: MatchItem, b: MatchItem) => {
        const aStatus = statusSortPriority(
          computeMatchStatus(a.matchStatus, a.kickoffTime, a.homeScore != null && a.awayScore != null, 'football'),
        );
        const bStatus = statusSortPriority(
          computeMatchStatus(b.matchStatus, b.kickoffTime, b.homeScore != null && b.awayScore != null, 'football'),
        );
        if (aStatus !== bStatus) return aStatus - bStatus;
        const timeCmp = a.kickoffTime.localeCompare(b.kickoffTime);
        if (timeCmp !== 0) return timeCmp;
        return a.matchNo.localeCompare(b.matchNo);
      });
    }
    return result;
  }, [matches, followFilter, followedTeamNames, sortBy, nowTimestamp]);

  const fetchMatches = async (silent = false, pageNum = 1, append = false) => {
    if (!append && !silent) setLoading(true);
    if (!append && !silent) setError(null);
    if (append) setLoadingMore(true);
    try {
      const baseParams: GetMatchesParams = {
        date: selectedDate,
        sort: sortBy as GetMatchesParams['sort'],
        page: pageNum,
        pageSize: PAGE_SIZE,
      };
      if (selectedLeague) baseParams.league = selectedLeague;
      if (selectedConfidence)
        baseParams.confidence = selectedConfidence as GetMatchesParams['confidence'];
      if (selectedDirection) baseParams.direction = selectedDirection;

      let sourceFilter: 'jingcai' | 'beidan' | 'international';
      if (sourceTab === '竞彩官方') sourceFilter = 'jingcai';
      else if (sourceTab === '北单') sourceFilter = 'beidan';
      else sourceFilter = 'international';
      let newItems: MatchItem[] = [];
      let total = 0;
      let highConf = 0;
      let dateStrResult = selectedDate;

      const params: GetMatchesParams = { ...baseParams, sourceFilter };
      const response = await matchesApi.getMatches(params);
      newItems = response.items ?? [];
      total = response.total ?? 0;
      highConf = response.highConfCount ?? 0;
      dateStrResult = response.date ?? selectedDate;

      if (append) {
        setMatches((prev) => {
          const existingIds = new Set(prev.map((m: MatchItem) => m.id));
          const uniqueNew = newItems.filter((m: MatchItem) => !existingIds.has(m.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setMatches(newItems);
        setDateStr(dateStrResult);
        setPage(pageNum);
        // 从第一场比赛读取真实模型版本号（字段可能未在类型中声明，运行时安全读取）
        const firstWithVersion = newItems.find((m: MatchItem) => {
          const v = (m as unknown as Record<string, unknown>).predEngineVersion;
          return typeof v === 'string' && v.trim() !== '';
        });
        if (firstWithVersion) {
          setModelVersion((firstWithVersion as unknown as Record<string, unknown>).predEngineVersion as string);
        }
      }
      setTotalMatches(total);
      setHighConfCount(highConf);
      const loadedCount = append
        ? (matches.length + newItems.length)
        : newItems.length;
      setHasMore(loadedCount < total && newItems.length > 0);
      setLastUpdateIso(new Date().toISOString());
      } catch (err) {
        logger.error('加载赛事失败', err);
        if (!append && !silent) setError('加载失败，请稍后重试');
      } finally {
        if (!append && !silent) setLoading(false);
        if (append) setLoadingMore(false);
        setIsRefreshing(false);
      }
    };

  const loadMoreRef = useRef<() => void>(() => {});

  useEffect(() => {
    loadMoreRef.current = () => {
      if (loadingMore || !hasMore || loading) return;
      const nextPage = page + 1;
      setPage(nextPage);
      void fetchMatches(true, nextPage, true);
    };
  });

  const fetchLiveScores = useCallback(async () => {
    try {
      const response = await matchesApi.getLiveScores(selectedDate);
      const liveMap = new Map<string, { homeScore: number | null; awayScore: number | null; matchStatus: string }>();
      for (const item of response.items) {
        liveMap.set(item.id, {
          homeScore: item.homeScore,
          awayScore: item.awayScore,
          matchStatus: item.matchStatus,
        });
      }
      setMatches((prev) => {
        let changed = false;
        const next = prev.map((m: MatchItem) => {
          const live = liveMap.get(m.id);
          if (!live) return m;
          if (
            m.homeScore === live.homeScore &&
            m.awayScore === live.awayScore &&
            m.matchStatus === live.matchStatus
          ) {
            return m;
          }
          changed = true;
          const status = live.matchStatus as MatchItem['matchStatus'];
          return {
            ...m,
            homeScore: live.homeScore ?? undefined,
            awayScore: live.awayScore ?? undefined,
            matchStatus: status,
          };
        });
        return changed ? next : prev;
      });
      setLastUpdateIso(new Date().toISOString());
      setSyncError(false);
    } catch (err) {
      logger.error('拉取实时比分失败', err);
      setSyncError(true);
    }
  }, [selectedDate]);


   const handleManualRefresh = useCallback(async () => {
     if (isRefreshing) return;
     setIsRefreshing(true);
     try {
       await syncApi.refreshLiveScoresUser();
       toast.success('已开始刷新比分，约30秒后更新');
       setTimeout(() => {
         void fetchMatches(true);
       }, 30000);
     } catch (err: unknown) {
       const status = (err as { response?: { status?: number } })?.response?.status;
       if (status === 401) {
         toast.error('请登录后刷新比分');
       } else {
         logger.error('手动刷新比分失败', err);
         toast.error('刷新失败，请稍后重试');
       }
     } finally {
       setIsRefreshing(false);
     }
   }, [isRefreshing, fetchMatches]);

  const fetchDateStats = async (source: SourceTab) => {
    try {
      const firstDate = dateList[0]?.date;
      const lastDate = dateList[dateList.length - 1]?.date;
      let sourceParam: string | undefined;
      if (source === '竞彩官方') sourceParam = 'sporttery';
      else if (source === '北单') sourceParam = 'beidan';
      else if (source === '国际赛事') sourceParam = 'international';
      const response = await matchesApi.getDateStats(firstDate, lastDate, sourceParam);
      setDateStats(response.items ?? []);
    } catch (err) {
      logger.error('加载日期统计失败', err);
    }
  };

  useEffect(() => {
    void fetchDateStats(sourceTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTab]);

  // 筛选条件变化时重置分页并重新拉取第一页
  useEffect(() => {
     setPage(1);
     setHasMore(true);
     fetchMatches();
     // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, selectedLeague, selectedConfidence, selectedDirection, sortBy, sourceTab]);

  const refreshSilent = useCallback(() => {
    void fetchLiveScores();
  }, [fetchLiveScores]);

  useEffect(() => {
    try { localStorage.setItem(getFootballLeagueKey(selectedDate), selectedLeague); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeague]);

  useEffect(() => {
    try { localStorage.setItem(getFootballConfidenceKey(selectedDate), selectedConfidence); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConfidence]);

  useEffect(() => {
    try { localStorage.setItem(getFootballDirectionKey(selectedDate), selectedDirection); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDirection]);

  useEffect(() => {
    try { localStorage.setItem(getFootballSortKey(selectedDate), sortBy); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  useEffect(() => {
    if (!selectedLeague || loading) return;
    const validLeagues = new Set(leagueOptions.map((opt) => opt.value));
    if (!validLeagues.has(selectedLeague)) {
      setSelectedLeague('');
    }
  }, [leagueOptions, selectedLeague, loading]);

  // 初次加载恢复当前日期的滚动位置
  useEffect(() => {
    try {
      const saved = localStorage.getItem(getFootballScrollKey(selectedDate));
      if (saved) {
        window.scrollTo(0, parseInt(saved, 10));
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动时防抖保存当前日期的滚动位置
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(
            getFootballScrollKey(currentDateRef.current),
            String(window.scrollY),
          );
        } catch { /* ignore */ }
      }, 200);
    };
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timer);
    };
  }, []);

  // 无限滚动：监听底部 sentinel 元素，进入视口时加载下一页（防抖 200ms）
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

  // 切换日期时：保存旧日期滚动位置 → 恢复新日期筛选状态 → 恢复新日期滚动位置
  const prevDateRef = useRef<string>(selectedDate);
  useEffect(() => {
    const prevDate = prevDateRef.current;
    // 先保存旧日期的滚动位置（处理防抖未触发的边界情况）
    if (prevDate !== selectedDate) {
      try {
        localStorage.setItem(getFootballScrollKey(prevDate), String(window.scrollY));
      } catch { /* ignore */ }
    }
    prevDateRef.current = selectedDate;

    // 恢复新日期的筛选状态（若无保存值则重置为默认）
    try {
      const savedLeague = localStorage.getItem(getFootballLeagueKey(selectedDate));
      setSelectedLeague(savedLeague ?? '');
    } catch { /* ignore */ }
    try {
      const savedConfidence = localStorage.getItem(getFootballConfidenceKey(selectedDate));
      setSelectedConfidence(savedConfidence ?? '');
    } catch { /* ignore */ }
    try {
      const savedDirection = localStorage.getItem(getFootballDirectionKey(selectedDate));
      setSelectedDirection(savedDirection ?? '');
    } catch { /* ignore */ }
    try {
      const savedSort = localStorage.getItem(getFootballSortKey(selectedDate));
      setSortBy(savedSort ?? 'kickoff');
    } catch { /* ignore */ }

    // 恢复滚动位置（延迟一帧等待 DOM 更新）
    const scrollTimer = requestAnimationFrame(() => {
      try {
        const savedScroll = localStorage.getItem(getFootballScrollKey(selectedDate));
        window.scrollTo(0, savedScroll ? parseInt(savedScroll, 10) : 0);
      } catch { /* ignore */ }
    });

    return () => cancelAnimationFrame(scrollTimer);
  }, [selectedDate]);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-date="${selectedDate}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
    return () => cancelAnimationFrame(timer);
  }, [selectedDate, dateList.length, dateStats.length]);

  const loadFollowedTeams = async () => {
    setFollowLoading(true);
    try {
      const res = await followedTeamsApi.getFollowedTeams();
      setFollowedTeamNames(res.items.map((item) => item.teamName));
    } catch (error) {
      // 静默处理：未登录或无关注记录时均置空，不弹出错误提示干扰首页
      logger.error('加载关注球队失败', error);
      setFollowedTeamNames([]);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleFollowFilterChange = (filter: 'all' | 'followed') => {
    if (filter === 'followed') {
      loadFollowedTeams();
    }
    setFollowFilter(filter);
  };

  const handleToggleFavorite = async (matchId: string, isFavorited: boolean) => {
    setMatches((prev) =>
      prev.map((m: MatchItem) =>
        m.id === matchId ? { ...m, isFavorited: !isFavorited } : m,
      ),
    );

    try {
      if (isFavorited) {
        await favoritesApi.removeFavorite(matchId);
      } else {
        await favoritesApi.addFavorite(matchId);
        try {
          await predictionRecordsApi.addPredictionRecord(matchId, 'favorited');
        } catch (recordErr) {
          logger.warn('记录收藏操作失败', recordErr);
        }
      }
    } catch (err) {
      logger.error('切换收藏状态失败', err);
      setMatches((prev) =>
        prev.map((m: MatchItem) =>
          m.id === matchId ? { ...m, isFavorited } : m,
        ),
      );
    }
  };

  const formatDate = (dateString: string): string => {
    const d = dayjs(dateString);
    const month = d.month() + 1;
    const day = d.date();
    const weekday = WEEKDAY_MAP[d.day()];
    return `${month}月${day}日 ${weekday}`;
  };

   if (loading) {
     return (
       <div className="bg-background min-h-screen">
         <LiveStatusBar
           lastUpdateIso={lastUpdateIso}
           refreshInterval={refreshInterval}
           onRefresh={refreshSilent}
           syncError={syncError}
         />
         <section className="relative overflow-hidden hero-dark-bg">
           <div className="absolute inset-0 grid-pattern opacity-30" />
           <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-10 pb-14 md:pt-16 md:pb-20">
             <div className="h-4 w-40 bg-white/10 rounded animate-pulse mb-6" />
             <div className="h-12 md:h-20 w-72 md:w-96 bg-white/10 rounded-lg animate-pulse mb-4" />
             <div className="h-4 w-96 bg-white/10 rounded animate-pulse" />
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-10">
               {[0, 1, 2, 3].map((i: number) => (
                 <div key={i} className="glass-card p-4 md:p-5">
                   <div className="h-3 w-20 bg-white/10 rounded animate-pulse mb-3" />
                   <div className="h-8 w-16 bg-white/10 rounded animate-pulse" />
                 </div>
               ))}
             </div>
           </div>
           <div className="absolute bottom-0 left-0 right-0 h-8 bg-background rounded-t-[2rem]" />
         </section>
         <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 -mt-2 relative z-10 space-y-4">
           <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
             {[0, 1, 2, 3].map((i: number) => (
               <div
                 key={i}
                 className="bg-white border border-gray-100 rounded-2xl p-4 space-y-2"
                 style={{ boxShadow: '0 10px 40px -15px rgba(0, 0, 0, 0.08)' }}
               >
                 <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
                 <div className="h-6 w-16 bg-gray-100 rounded animate-pulse" />
               </div>
             ))}
           </div>
           <div className="space-y-3 pt-4">
              {[0, 1, 2, 3].map((i: number) => (
                <div
                  key={i}
                  className="bg-white border border-gray-100 rounded-3xl p-5 space-y-4"
                  style={{ boxShadow: '0 10px 40px -15px rgba(0, 0, 0, 0.08)' }}
                >
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-6 w-28" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-6 w-28" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                  <div className="flex justify-between">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              ))}
            </div>
         </div>
       </div>
     );
   }

   if (error) {
     return (
       <div className="bg-background min-h-screen">
         <LiveStatusBar
           lastUpdateIso={lastUpdateIso}
           refreshInterval={refreshInterval}
           onRefresh={refreshSilent}
           syncError={syncError}
         />
         <section className="relative overflow-hidden hero-dark-bg">
           <div className="absolute inset-0 grid-pattern opacity-30" />
           <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-10 pb-14 md:pt-16 md:pb-20">
             <div className="eyebrow eyebrow-line text-white/70 mb-6">
               FOOTBALL ANALYTICS
             </div>
             <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white leading-[1.05]">
               加载失败
             </h1>
           </div>
           <div className="absolute bottom-0 left-0 right-0 h-8 bg-background rounded-t-[2rem]" />
         </section>
         <div className="max-w-7xl mx-auto px-4 md:px-8 -mt-2 relative z-10">
           <ErrorState
             size="lg"
             message={error}
             description="请检查网络连接后重试"
             onRetry={() => fetchMatches()}
           />
         </div>
       </div>
     );
   }

   return (
       <div className="bg-background md:bg-background min-h-screen bg-[var(--background)]">
        {/* 移动端顶部吸顶栏 */}
        <div className="md:hidden sticky top-0 z-40 bg-[var(--background)]/95 backdrop-blur-xl border-b border-[var(--border)]">
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
                {selectedDate === getBeijingToday() && (
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
                      onClick={() => setSelectedDate(d.date)}
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
          </div>
        </div>

        <LiveStatusBar
          lastUpdateIso={lastUpdateIso}
          refreshInterval={refreshInterval}
          onRefresh={refreshSilent}
          syncError={syncError}
        />

        {/* Hero 深红品牌区块 / 移动端隐藏 */}
        <section className="relative overflow-hidden hero-dark-bg hidden md:block">
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-14 pb-14 md:pt-20 md:pb-20">
            <div className="eyebrow eyebrow-line text-white/70 mb-6">
              FOOTBALL ANALYTICS · 2026
            </div>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
               <div className="max-w-2xl">
                 <h1 className="text-3xl md:text-5xl font-black tracking-tighter text-white leading-[1.05]">
                    今日足球
                    <span className="block mt-1">赛事数据参考</span>
                 </h1>
                 <p className="mt-4 text-sm md:text-base text-white/60 leading-relaxed max-w-lg">
                     覆盖赛果方向、让分、进球数三维度模型输出。
                     <span className="block mt-2 text-white/80 font-medium">数据与模型分析仅供参考，不构成任何决策建议，请理性观赛。</span>
                 </p>
               </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <button
                  onClick={() => navigate('/brand')}
                  className="self-start sm:self-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-xs font-bold hover:from-yellow-300 hover:to-amber-400 transition-all shadow-lg shadow-amber-500/20"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  数据参考 · 品牌页
                </button>
                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="self-start sm:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white/10 backdrop-blur border border-white/20 text-white text-sm font-semibold hover:bg-white/15 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  刷新比分
                </button>
              </div>
           </div>

           {/* 当日核心指标 */}
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
             <div className="glass-card p-4 md:p-5">
               <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Total Matches</div>
                <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white tabular-nums">
                  {totalMatches}
                </div>
                <div className="mt-1 text-xs text-white/50">场比赛</div>
             </div>
             <div className="glass-card p-4 md:p-5">
               <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">High Confidence</div>
               <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white tabular-nums">
                  {highConfCount}
               </div>
               <div className="mt-1 text-xs text-white/50">高信心场次</div>
             </div>
             <div className="glass-card p-4 md:p-5">
               <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Win Rate</div>
               <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-[#FFA07A] tabular-nums">
                 {currentDateStats && currentDateStats.wdwValidTotal > 0
                   ? `${Math.max(0, Math.min(100, Math.round(currentDateStats.wdwHitRate * 100)))}%`
                   : '—'}
               </div>
                 <div className="mt-1 text-xs text-white/50">赛果方向模型验证</div>
             </div>
             <div className="glass-card p-4 md:p-5">
               <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Live Now</div>
               <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-[#CD5C5C] tabular-nums">
                 {matches.filter((m: MatchItem) => computeMatchStatus(m.matchStatus, m.kickoffTime, m.homeScore != null && m.awayScore != null, 'football') === 'live').length}
               </div>
               <div className="mt-1 text-xs text-white/50">进行中</div>
             </div>
           </div>
         </div>
          {/* 底部过渡弧 */}
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-background rounded-t-[2rem]" />
        </section>

        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-4 md:pt-8 pb-20 md:pb-8 -mt-0 md:-mt-2 relative z-10">
       {/* 顶部标题区 - 仅桌面端 */}
       <div className="mb-4 hidden md:block">
        <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              今日足球赛事
            </h1>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新比分
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
                足球赛事分析 · 数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛
            </p>

          {/* 移动端免责声明 */}
          <p className="md:hidden text-xs text-[var(--muted-foreground)] mb-3 text-center">
            数据与模型分析仅供参考，不构成任何决策建议
          </p>

          {/* 日期选择器（仅桌面端） */}
          <div className="mb-6 hidden md:block">
            <div className="eyebrow eyebrow-line mb-3 hidden md:block">
              Match Calendar
            </div>
             <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 md:hidden">SELECT DATE</div>
           <div className="overflow-x-auto scrollbar-hide -mx-4 md:mx-0 px-4 md:px-0 pb-1">
            <div className="flex gap-2 min-w-min">
              {dateList.map((d) => {
                const stat = dateStats.find(
                  (s: DateStatsItem) => s.date === d.date,
                );
                const hasData = stat ? stat.hasData : false;
                const isSelected = selectedDate === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    data-date={d.date}
                    aria-current={isSelected ? 'date' : undefined}
                    onClick={() => setSelectedDate(d.date)}
                    className={`flex-shrink-0 flex flex-col items-center justify-center w-16 py-3 rounded-2xl border transition-all duration-300 text-xs cursor-pointer min-h-[64px] ${
                      isSelected
                        ? 'bg-[var(--accent-primary)] md:bg-nebula-crimson text-white border-[var(--accent-primary)] md:border-nebula-crimson shadow-lg shadow-[var(--accent-primary)]/30 md:shadow-nebula-crimson/30 scale-105'
                        : hasData
                          ? 'bg-[var(--card)] md:bg-white text-[var(--muted-foreground)] md:text-gray-500 border-[var(--border)] md:border-gray-100 hover:border-[var(--accent-primary)]/50 md:hover:border-nebula-crimson/30'
                          : 'bg-[var(--background)]/50 md:bg-white/50 text-[var(--muted-foreground)]/70 md:text-gray-300 border-[var(--border)] md:border-gray-50'
                    }`}
                  >
                    <span className={`text-xl font-black leading-none tabular-nums ${
                      d.isToday && !isSelected ? 'text-[var(--accent-primary)] md:text-nebula-crimson' : ''
                    }`}>
                      {d.day}
                    </span>
                    <span className={`text-[10px] mt-1.5 font-semibold ${
                      isSelected ? 'text-white/80' : 'text-[var(--muted-foreground)] md:text-gray-400'
                    }`}>
                      {d.weekday}
                    </span>
                    <span className={`text-[9px] mt-1 font-medium ${
                      isSelected ? 'text-white/60' : 'text-[var(--muted-foreground)]/60 md:text-gray-300'
                    }`}>
                      {stat && hasData
                        ? `${stat.totalMatches}场`
                        : '暂无'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          </div>

          {/* 快捷入口 */}
          <div className="mb-6">
            <div className="eyebrow eyebrow-line mb-3 hidden md:block">
              Quick Access
            </div>
          <div className="overflow-x-auto scrollbar-hide -mx-4 md:mx-0 px-4 md:px-0">
            <div className="flex gap-3 min-w-max">
              {QUICK_ENTRIES.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.path}
                    onClick={() => navigate(entry.path)}
                    className="flex-shrink-0 flex flex-col items-center gap-2 w-20 active:scale-95 transition-transform group"
                  >
                    <div className={`w-14 h-14 rounded-2xl bg-[var(--card)] md:bg-transparent ${entry.bg} flex items-center justify-center transition-all duration-300 group-hover:shadow-lg md:group-hover:-translate-y-1 border border-[var(--border)] md:border-0 ${entry.color}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-medium text-[var(--muted-foreground)] md:text-gray-500 md:group-hover:text-nebula-crimson transition-colors">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          </div>

           {/* 关注筛选 Tab */}
           <div className="inline-flex items-center bg-[var(--card)] md:bg-gray-100 p-1 rounded-2xl mb-6 border border-[var(--border)] md:border-0">
            <button
              onClick={() => handleFollowFilterChange('all')}
              className={`px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 min-h-[36px] ${
                followFilter === 'all'
                  ? 'bg-[var(--accent-primary)] md:bg-white text-white md:text-nebula-crimson shadow-sm border border-[var(--accent-primary)] md:border-transparent'
                  : 'text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--foreground)]/60 md:hover:text-gray-600'
              }`}
            >
              全部赛事
            </button>
            <button
              onClick={() => handleFollowFilterChange('followed')}
              className={`px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-1.5 min-h-[36px] ${
                followFilter === 'followed'
                   ? 'bg-[var(--accent-primary)] md:bg-white text-white md:text-nebula-crimson shadow-sm border border-[var(--accent-primary)] md:border-transparent'
                   : 'text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--foreground)]/60 md:hover:text-gray-600'
              }`}
            >
              <Heart className="w-4 h-4" />
              我的关注
            </button>
           </div>

             <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                 <h2 className="text-xl md:text-xl font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                  {dateStr ? formatDate(dateStr) : ''}
                </h2>
               <span className="text-sm text-[var(--muted-foreground)] md:text-gray-400 font-medium">
                  共 <span className="text-[var(--accent-primary)] md:text-nebula-crimson font-bold tabular-nums">{totalMatches}</span> 场比赛
                {followFilter === 'followed' && followedTeamNames.length > 0 && (
                  <span className="ml-1">· 关注 {displayedMatches.length} 场</span>
                )}
              </span>
              </div>
            </div>
      </div>

       {/* 三维度模型验证统计条（已完赛且有赛前方向时显示） */}
        {currentDateStats && (currentDateStats.wdwValidTotal > 0 || currentDateStats.handicapValidTotal > 0 || currentDateStats.overUnderValidTotal > 0) && (
          <div className="metric-card bg-[var(--card)] md:bg-card p-6 mb-6 rounded-2xl border border-[var(--border)] md:border-border">
            <div className="eyebrow eyebrow-line mb-4 hidden md:block">
              Daily Performance
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-4 md:hidden">DAILY PERFORMANCE</div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tracking-tight tabular-nums">
                  {Math.max(0, Math.min(100, Math.round(currentDateStats.wdwHitRate * 100)))}%
                </div>
                <div className="text-xs text-[var(--muted-foreground)] md:text-gray-400 mt-2 font-medium">
                    赛果方向模型验证
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-300 mt-1 font-mono">
                  {currentDateStats.wdwValidTotal > 0
                    ? `${Math.round(currentDateStats.wdwHitRate * currentDateStats.wdwValidTotal)}/${currentDateStats.wdwValidTotal}`
                    : '—'}
                </div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tracking-tight tabular-nums">
                  {Math.max(0, Math.min(100, Math.round(currentDateStats.handicapHitRate * 100)))}%
                </div>
                <div className="text-xs text-[var(--muted-foreground)] md:text-gray-400 mt-2 font-medium">
                    让分模型验证
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-300 mt-1 font-mono">
                  {currentDateStats.handicapValidTotal > 0
                    ? `${Math.round(currentDateStats.handicapHitRate * currentDateStats.handicapValidTotal)}/${currentDateStats.handicapValidTotal}`
                    : '—'}
                </div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tracking-tight tabular-nums">
                  {Math.max(0, Math.min(100, Math.round(currentDateStats.overUnderHitRate * 100)))}%
                </div>
                <div className="text-xs text-[var(--muted-foreground)] md:text-gray-400 mt-2 font-medium">
                     进球数模型验证
                 </div>
                 <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-300 mt-1 font-mono">
                   {currentDateStats.overUnderValidTotal > 0
                     ? `${Math.round(currentDateStats.overUnderHitRate * currentDateStats.overUnderValidTotal)}/${currentDateStats.overUnderValidTotal}`
                     : '—'}
                 </div>
               </div>
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)] md:text-gray-300 text-center mt-4 uppercase tracking-wider">
               分母 = 已完赛且有赛前方向的场次
            </div>
          </div>
        )}

       {/* 已完赛复盘卡片（仅今天） */}
       {reviewStats && selectedDate === todayStr && (
         <div className="metric-card p-6 mb-8 bg-gradient-to-r from-[var(--secondary)] to-[var(--card)] md:from-white md:to-white border border-[var(--border)] md:border-gray-100 rounded-2xl">
           {/* 标题行 */}
           <div className="flex items-center justify-between mb-6">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-2xl bg-[var(--accent-primary)]/20 md:bg-nebula-crimson/10 flex items-center justify-center">
                 <Trophy className="w-5 h-5 text-[var(--accent-primary)] md:text-nebula-crimson" />
               </div>
               <div>
                 <h2 className="text-lg font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                   已完赛回顾
                 </h2>
                 <span className="text-xs text-[var(--muted-foreground)] md:text-gray-400">
                   {dateStr || dayjs().format('YYYY-MM-DD')}
                 </span>
               </div>
             </div>
             <button
               onClick={() => navigate('/stats')}
               className="text-xs font-bold text-[var(--accent-primary)] md:text-nebula-crimson hover:opacity-80 flex items-center gap-1 transition-opacity"
             >
               查看详情
               <ChevronDown className="w-3 h-3 rotate-[-90deg]" />
             </button>
           </div>

           {/* 三项模型验证统计 */}
           <div className="grid grid-cols-3 gap-3 mb-6">
             <div className="bg-[var(--card)] md:bg-gray-50 rounded-2xl p-4 text-center border border-[var(--border)] md:border-0">
               <div className="text-2xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tabular-nums">
                 {Math.round(reviewStats.wdwHitRate * 100)}%
               </div>
               <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-400 mt-1 font-medium">
                   赛果方向模型验证
               </div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-gray-300 mt-0.5 font-mono">
                 {reviewStats.hitCount}/{reviewStats.total}
               </div>
             </div>
             <div className="bg-[var(--card)] md:bg-gray-50 rounded-2xl p-4 text-center border border-[var(--border)] md:border-0">
               <div className="text-2xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tabular-nums">
                 {Math.round(reviewStats.handicapHitRate * 100)}%
               </div>
               <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-400 mt-1 font-medium">
                   让分模型验证
               </div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-gray-300 mt-0.5 font-mono">
                 {finishedMatches.filter((m: MatchItem) => m.hitHandicap === true).length}/{reviewStats.total}
               </div>
             </div>
             <div className="bg-[var(--card)] md:bg-gray-50 rounded-2xl p-4 text-center border border-[var(--border)] md:border-0">
               <div className="text-2xl font-black text-[var(--accent-primary)] md:text-nebula-crimson tabular-nums">
                 {Math.round(reviewStats.overUnderHitRate * 100)}%
               </div>
               <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-400 mt-1 font-medium">
                    进球数模型验证
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)] md:text-gray-300 mt-0.5 font-mono">
                  {finishedMatches.filter((m: MatchItem) => m.hitOverunder === true).length}/{reviewStats.total}
                </div>
             </div>
           </div>

           {/* 验证/未验证 比例条 */}
           <div className="mb-6">
             <div className="flex justify-between text-sm mb-2">
               <span className="text-[var(--accent-primary)] md:text-nebula-crimson font-bold">
                  验证通过 {reviewStats.hitCount} 场
               </span>
               <span className="text-[var(--muted-foreground)] md:text-gray-400 font-bold">
                  未通过 {reviewStats.missCount} 场
               </span>
             </div>
             <div className="h-3 w-full bg-[var(--secondary)] md:bg-gray-100 rounded-full overflow-hidden flex">
               <div
                  className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-light)] md:progress-gradient transition-all duration-1000 ease-out"
                 style={{
                   width: `${reviewStats.total > 0 ? (reviewStats.hitCount / reviewStats.total) * 100 : 0}%`,
                 }}
               />
             </div>
           </div>

          {/* 展开/收起按钮 */}
           <button
             onClick={() => setReviewExpanded((prev) => !prev)}
             className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--accent-primary)] md:hover:text-nebula-crimson transition-colors rounded-xl hover:bg-[var(--secondary)] md:hover:bg-gray-50"
           >
            {reviewExpanded ? (
              <>
                收起列表
                <ChevronUp className="w-4 h-4" />
              </>
            ) : (
              <>
                展开比赛详情
                <ChevronDown className="w-4 h-4" />
              </>
            )}
          </button>

          {/* 比赛列表 */}
          {reviewExpanded && (
             <div className="border-t border-[var(--border)] md:border-gray-100 pt-4 mt-2 space-y-2">
              {finishedMatches.slice(0, 5).map((match: MatchItem) => {
                const actualResult = deriveActualResult(
                  match.homeScore,
                  match.awayScore,
                );
                const isHit = match.hitWdw === true;
                return (
                  <div
                    key={match.id}
                      className="flex items-center gap-3 p-4 rounded-2xl bg-[var(--secondary)] md:bg-gray-50 hover:bg-[var(--accent-primary)]/10 md:hover:bg-nebula-crimson/5 transition-all duration-300 cursor-pointer group border border-[var(--border)] md:border-0"
                    onClick={() => {
                       const isBasketball = match.league && /NBA|WNBA|篮球|篮联|NBL|CBA|欧篮|西篮|德篮|日篮|菲篮|韩篮|澳篮/i.test(match.league);
                       navigate(isBasketball ? `/basketball/detail/${match.id}` : `/match/${match.id}`);
                     }}
                  >
                      <span className="text-[10px] text-[var(--muted-foreground)] md:text-gray-400 bg-[var(--card)] md:bg-white px-2 py-1 rounded-lg font-mono font-bold flex-shrink-0 border border-[var(--border)] md:border-gray-100">
                       {match.matchNo}
                     </span>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[var(--foreground)] md:text-foreground truncate">
                         {match.homeTeam} vs {match.awayTeam}
                       </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-[var(--muted-foreground)] md:text-gray-400">
                        <span>
                          比分: {match.homeScore ?? 0}-{match.awayScore ?? 0}
                        </span>
                        <span className="text-[var(--muted-foreground)]/70 md:text-border">·</span>
                         <span>模型倾向: {match.predictionDirection}</span>
                        <span className="text-[var(--muted-foreground)]/70 md:text-border">·</span>
                        <span>实际: {actualResult}</span>
                      </div>
                       {!isHit && match.errorReason && (
                          <div className="text-[11px] text-[var(--muted-foreground)] md:text-gray-400 mt-1.5 line-clamp-1">
                           原因: {match.errorReason}
                         </div>
                       )}
                    </div>
                    <div className="flex-shrink-0">
                       {isHit ? (
                         <span className="text-[var(--success)] md:text-nebula-crimson text-2xl font-black">✓</span>
                       ) : (
                         <span className="text-[var(--muted-foreground)]/70 md:text-gray-300 text-2xl font-black">✗</span>
                       )}
                    </div>
                  </div>
                );
              })}
              {finishedMatches.length > 5 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate('/stats');
                  }}
                   className="w-full text-center text-sm font-bold text-nebula-crimson hover:opacity-80 py-2 transition-opacity"
                >
                  查看全部 {finishedMatches.length} 场 →
                </button>
              )}
            </div>
          )}
        </div>
      )}

       {/* 官方数据休市提示 */}
       {!loading && matches.length > 0 && selectedDate === todayStr &&
         matches.filter((m: MatchItem) => m.source === 'sporttery').length === 0 && (
         <div className="mb-4 px-4 py-3 rounded-xl bg-[var(--warning)]/10 md:bg-gray-100 border border-[var(--warning)]/30 md:border-gray-200 flex items-center gap-3">
           <AlertCircle className="w-5 h-5 text-[var(--warning)] md:text-nebula-crimson shrink-0" />
           <p className="text-sm text-[var(--warning)] md:text-nebula-crimson font-medium">
              数据更新暂停中，以下为国际赛事数据（非官方指数）
           </p>
         </div>
       )}

       {/* 筛选栏 */}
       <div className="metric-card p-5 mb-6 space-y-4 bg-gradient-to-r from-[var(--secondary)] to-[var(--card)] md:from-white md:to-white border border-[var(--border)] md:border-gray-100 rounded-2xl">
         <div className="eyebrow eyebrow-line mb-1 text-[var(--accent-primary)]/70 md:text-foreground/70">
           Filters
         </div>

          {/* 数据源 - 三段 Tab */}
          <div className="bg-[var(--card)] md:bg-gray-100 p-1 rounded-2xl inline-flex border border-[var(--border)] md:border-0">
            {SOURCE_TABS.map((tab) => {
              const isActive = sourceTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setSourceTab(tab)}
                  className={`px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 min-h-[36px] ${
                    isActive
                       ? 'bg-[var(--accent-primary)] md:bg-white text-white md:text-nebula-crimson shadow-sm'
                      : 'text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--foreground)]/60 md:hover:text-gray-600'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* 联赛筛选 - Tab 风格 */}
           <div className="bg-[var(--card)] md:bg-gray-100 p-1 rounded-2xl overflow-x-auto scrollbar-hide border border-[var(--border)] md:border-0">
            <div className="flex gap-1 min-w-max">
              {leagueOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedLeague(opt.value)}
                  className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 whitespace-nowrap min-h-[32px] ${
                    selectedLeague === opt.value
                       ? 'bg-[var(--accent-primary)] md:bg-white text-white md:text-nebula-crimson shadow-sm shadow-[var(--accent-primary)]/20'
                      : 'text-[var(--muted-foreground)] md:text-gray-400 hover:text-[var(--foreground)]/60 md:hover:text-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

         {/* 参考指数 + 方向 + 排序 */}
         <div className="flex gap-3 flex-wrap">
           <select
             value={selectedConfidence}
             onChange={(e) => setSelectedConfidence(e.target.value)}
              className="flex-1 min-w-[100px] bg-[var(--card)] md:bg-gray-50 text-[var(--foreground)] md:text-foreground text-sm rounded-xl px-4 py-2.5 border border-[var(--border)] md:border-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 md:focus:ring-nebula-crimson/30 focus:border-[var(--accent-primary)]/30 md:focus:border-nebula-crimson/30 appearance-none cursor-pointer font-bold"
           >
            {CONFIDENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
           <select
             value={selectedDirection}
             onChange={(e) => setSelectedDirection(e.target.value)}
              className="flex-1 min-w-[100px] bg-[var(--card)] md:bg-gray-50 text-[var(--foreground)] md:text-foreground text-sm rounded-xl px-4 py-2.5 border border-[var(--border)] md:border-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 md:focus:ring-nebula-crimson/30 focus:border-[var(--accent-primary)]/30 md:focus:border-nebula-crimson/30 appearance-none cursor-pointer font-bold"
           >
            {DIRECTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
           <button
             onClick={() =>
               setSortBy((prev) => (prev === 'kickoff' ? 'confidence' : 'kickoff'))
             }
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[var(--card)] md:bg-gray-50 text-[var(--muted-foreground)] md:text-gray-500 hover:text-[var(--accent-primary)] md:hover:text-nebula-crimson border border-[var(--border)] md:border-gray-100 transition-all duration-300 hover:border-[var(--accent-primary)]/50 md:hover:border-nebula-crimson/20"
             title={`排序：${sortBy === 'kickoff' ? '开赛时间' : '参考指数'}`}
           >
             <ArrowUpDown className="w-4 h-4" />
             <span className="hidden sm:inline">
               {sortBy === 'kickoff' ? '开赛时间' : '参考指数'}
             </span>
           </button>
          </div>
         </div>

        {/* 我的关注板块 */}
        {!loading && followedMatches.length > 0 && (
          <div className="metric-card p-5 mb-6 bg-[var(--card)] md:bg-card border border-[var(--border)] md:border-border rounded-2xl md:rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                 <Heart className="w-4 h-4 fill-[var(--accent-primary)] md:fill-nebula-crimson text-[var(--accent-primary)] md:text-nebula-crimson" />
                 <h2 className="text-lg font-black tracking-tight text-[var(--foreground)] md:text-foreground">
                  我的关注
                </h2>
                 <span className="text-xs text-[var(--muted-foreground)] md:text-gray-400">{followedMatches.length} 场</span>
              </div>
              <button
                 className="text-xs text-[var(--accent-primary)] md:text-nebula-crimson font-medium hover:opacity-80 transition-opacity"
                onClick={() => setFollowFilter('followed')}
              >
                查看全部
              </button>
            </div>
            <div className="space-y-2">
              {followedMatches.map((match: MatchItem) => {
                const isFollowedHome = getFollowedTeams('football').includes(match.homeTeam);
                const isFollowedAway = getFollowedTeams('football').includes(match.awayTeam);
                const isLeagueFollowed = getFollowedLeagues('football').includes(match.league);
                return (
                  <div
                    key={match.id}
                    onClick={() => navigate(`/match/${match.id}`)}
                     className="flex items-center justify-between p-3 rounded-xl bg-[var(--secondary)] md:bg-gray-50 hover:bg-[var(--accent-primary)]/10 md:hover:bg-nebula-crimson/5 transition-colors cursor-pointer group border border-[var(--border)] md:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                       <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground bg-[var(--card)] md:bg-white px-2 py-0.5 rounded font-mono font-bold flex-shrink-0 border border-[var(--border)] md:border-gray-100">
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
                        {formatKickoffDisplay(match.kickoffTime)}
                      </span>
                      {match.predictionDirection && match.predictionDirection !== '观望' && (
                         <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-primary)]/20 md:bg-nebula-crimson/10 text-[var(--accent-primary)] md:text-nebula-crimson">
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

        {/* 最后更新时间 + 自动刷新开关 */}
         {!loading && matches.length > 0 && (
           <div className="flex items-center justify-between mb-4">
             <div className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground">
              最后更新：{lastUpdateTime}
            </div>
            <button
              onClick={toggleAutoRefresh}
              className={`text-[11px] font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                autoRefresh
                   ? 'bg-[var(--accent-primary)]/20 md:bg-primary/10 text-[var(--accent-primary)] md:text-primary'
                   : 'text-[var(--muted-foreground)] md:text-muted-foreground hover:text-[var(--foreground)] md:hover:text-foreground hover:bg-[var(--secondary)] md:hover:bg-gray-50'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? `${autoRefreshCountdown}s 后自动刷新` : '开启自动刷新'}
            </button>
          </div>
        )}

       {/* 无数据日期空态 */}
       {!loading &&
         matches.length === 0 &&
         (!currentDateStats || !currentDateStats.hasData) &&
           followFilter === 'all' && (
            <div className="py-20 flex flex-col items-center justify-center text-center metric-card">
              <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
                <CalendarDays className="w-8 h-8 text-gray-300" />
              </div>
               <p className="text-lg font-bold text-foreground mb-1">
                  {selectedDate === todayStr
                    ? '今日暂无比赛'
                    : '当日暂无赛事'}
                </p>
                <p className="text-sm text-gray-400 mt-2 mb-4">
                  {selectedDate === todayStr
                     ? '为您精选明日精彩赛事'
                    : '该日期暂未更新或无比赛数据'}
                </p>
                {selectedDate === todayStr && (
                   <button
                    onClick={() => {
                      const tomorrow = dayjs(getBeijingToday()).add(1, 'day').format('YYYY-MM-DD');
                      setSelectedDate(tomorrow);
                    }}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-nebula-crimson/10 text-nebula-crimson text-sm font-bold hover:bg-nebula-crimson/20 transition-colors"
                  >
                    查看明日赛事
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
           </div>
         )}

       {/* 比赛列表 */}
       {!loading && matches.length === 0 && (!currentDateStats || !currentDateStats.hasData)
          ? null : followLoading ? (
         <div className="space-y-3">
           {[0, 1, 2, 3].map((i: number) => (
             <div key={i} className="metric-card p-5 space-y-4">
               <div className="flex justify-between">
                 <Skeleton className="h-4 w-24" />
                 <Skeleton className="h-4 w-16" />
               </div>
               <div className="flex justify-between items-center">
                 <Skeleton className="h-6 w-28" />
                 <Skeleton className="h-8 w-16" />
                 <Skeleton className="h-6 w-28" />
               </div>
               <Skeleton className="h-2 w-full rounded-full" />
               <div className="flex justify-between">
                 <Skeleton className="h-5 w-20" />
                 <Skeleton className="h-4 w-24" />
               </div>
             </div>
           ))}
         </div>
       ) : displayedMatches.length === 0 ? (
         <div className="py-20 flex flex-col items-center justify-center text-center metric-card bg-[var(--card)] md:bg-card rounded-2xl md:rounded-none border border-[var(--border)] md:border-0">
           <div className="w-16 h-16 rounded-2xl bg-[var(--secondary)] md:bg-gray-50 flex items-center justify-center mb-4">
             {followFilter === 'followed' ? (
               <Heart className="w-8 h-8 text-[var(--muted-foreground)]/60 md:text-gray-300" />
             ) : selectedLeague ? (
               <Database className="w-8 h-8 text-[var(--muted-foreground)]/60 md:text-gray-300" />
             ) : (
               <Activity className="w-8 h-8 text-[var(--muted-foreground)]/60 md:text-gray-300" />
             )}
           </div>
            <p className="text-lg font-bold text-[var(--foreground)] md:text-foreground mb-1">
             {followFilter === 'followed'
               ? '暂无关注球队的比赛'
               : selectedLeague
                 ? '该联赛暂无数据'
                 : sourceTab === '国际赛事'
                   ? '今日暂无国际赛事'
                   : '今日暂无官方开售场次'}
           </p>
            <p className="text-sm text-[var(--muted-foreground)] md:text-gray-400 mt-2">
             {followFilter === 'followed'
               ? '去球队详情页关注喜欢的球队吧'
               : selectedLeague
                 ? '数据源接入后自动更新'
                 : sourceTab === '国际赛事'
                   ? '更多国际赛事陆续接入中'
                   : '试试调整筛选条件'}
           </p>
         </div>
         ) : (
           <div>
             {sourceTab !== '国际赛事' ? (
               <JcSaleStatusGroups
                 matches={displayedMatches}
                 onToggleFavorite={handleToggleFavorite}
                 onViewDetail={(id: string) => {
                   const m = displayedMatches.find((item: MatchItem) => item.id === id);
                   const isBasketball = m?.league && /NBA|WNBA|篮球|篮联|NBL|CBA|欧篮|西篮|德篮|日篮|菲篮|韩篮|澳篮/i.test(m.league);
                   navigate(isBasketball ? `/basketball/detail/${id}` : `/match/${id}`);
                 }}
                 nowTimestamp={nowTimestamp}
               />
             ) : (
               <LeagueGroups
                 matches={displayedMatches}
                 onToggleFavorite={handleToggleFavorite}
                 onViewDetail={(id: string) => {
                   const m = displayedMatches.find((item: MatchItem) => item.id === id);
                   const isBasketball = m?.league && /NBA|WNBA|篮球|篮联|NBL|CBA|欧篮|西篮|德篮|日篮|菲篮|韩篮|澳篮/i.test(m.league);
                   navigate(isBasketball ? `/basketball/detail/${id}` : `/match/${id}`);
                 }}
                 nowTimestamp={nowTimestamp}
               />
             )}
            {/* 无限滚动 sentinel 与状态 */}
            <div ref={sentinelRef} className="py-6 flex items-center justify-center">
              {loadingMore ? (
                 <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] md:text-gray-400">
                   <div className="w-4 h-4 border-2 border-[var(--accent-primary)]/30 md:border-nebula-crimson/30 border-t-[var(--accent-primary)] md:border-t-nebula-crimson rounded-full animate-spin" />
                  加载更多...
                </div>
              ) : hasMore ? (
                 <div className="text-sm text-[var(--muted-foreground)] md:text-gray-300">向下滚动加载更多</div>
              ) : matches.length > 0 ? (
                 <div className="text-sm text-[var(--muted-foreground)] md:text-gray-300">没有更多了</div>
              ) : null}
            </div>
          </div>
        )}
        </div>

       {/* v6.8.6 更新公告 */}
      <Dialog open={showV68Announce} onOpenChange={closeV68Announce}>
        <DialogContent className="w-[min(92vw,420px)] max-w-none max-h-[80vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-primary text-base">
              <Sparkles className="w-5 h-5" />
                足球模型{modelVersion ? ` ${modelVersion}` : ''} — 赛果方向概率缺失让分兜底修复
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground pt-1">
                赛果方向0/0/0归一观望，让分指数兜底全路径56%门槛，模型n=1/n=2规则输出受保护不被覆盖。
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-3 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch] space-y-2.5 text-sm text-foreground/90 grow min-h-0">
            <div className="flex items-start gap-2">
                <span className="text-destructive font-bold shrink-0">核心修复</span>
                  <span>赛果方向概率缺失（0/0/0）时让分指数兜底输出未套用56%门槛，导致49%也被强推成让胜（周三002）。现已修复：低于56%一律观望。</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-destructive font-bold shrink-0">尊重入参</span>
               <span>请求体显式提供 handicapRecommendation/totalPick/predictionDirection（含「观望」）时，update 直接持久化，不再被指数重算覆盖。</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-destructive font-bold shrink-0">三项非空</span>
                <span>赛果方向、让分参考、大小球参考任一写入路径都保证非空，无数据即「观望」，杜绝 null 透传。</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-600 font-bold shrink-0">测试保障</span>
                <span>新增 HTTP 端点 e2e 回归：显式观望全拦截、高信心让分正常输出、provided分支大小球指数推导，12项断言全过。</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-bold shrink-0">篮球不变</span>
              <span>篮球模型保持 v6.7.1，本次升级仅限足球。</span>
            </div>
          </div>
          <div className="px-5 py-3 border-t shrink-0 sticky bottom-0 bg-background flex justify-end">
            <button
              onClick={closeV68Announce}
              className="bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
            >
              我知道了
            </button>
          </div>
          <div className="pb-1 text-xs text-muted-foreground text-center">
            2026-09-23
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TodayPage;
