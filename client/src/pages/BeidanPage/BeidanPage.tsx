import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Calendar,
  CalendarDays,
  Trophy,
  RefreshCw,
  Target,
} from 'lucide-react';
import { matchesApi, favoritesApi, predictionRecordsApi } from '@client/src/api';
import { toast } from 'sonner';
import type { MatchItem } from '@shared/api.interface';
import type { GetMatchesParams } from '@client/src/api/matches';
import MatchCard from '../TodayPage/MatchCard';
import { ErrorState } from '@client/src/components/ui/error-state';
import { computeMatchStatus } from '@client/src/utils/format';

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

const BEIDAN_STATE_KEY = 'beidan_list_state';

interface BeidanListState {
  selectedDate: string;
  scrollTop: number;
}

function loadBeidanState(defaultDate: string): BeidanListState {
  try {
    const saved = sessionStorage.getItem(BEIDAN_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<BeidanListState>;
      return {
        selectedDate: parsed.selectedDate ?? defaultDate,
        scrollTop: parsed.scrollTop ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return { selectedDate: defaultDate, scrollTop: 0 };
}

function saveBeidanState(state: Partial<BeidanListState>): void {
  try {
    const existing = sessionStorage.getItem(BEIDAN_STATE_KEY);
    const prev: BeidanListState = existing
      ? (JSON.parse(existing) as BeidanListState)
      : { selectedDate: '', scrollTop: 0 };
    sessionStorage.setItem(BEIDAN_STATE_KEY, JSON.stringify({ ...prev, ...state }));
  } catch {
    // ignore
  }
}

const BeidanPage = () => {
  const navigate = useNavigate();
  const todayStr = getBeijingToday();
  const initialState = loadBeidanState(todayStr);
  const [selectedDate, setSelectedDateState] = useState<string>(initialState.selectedDate);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [dateStr, setDateStr] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateIso, setLastUpdateIso] = useState<string>(new Date().toISOString());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const dateList = getDateList();

  const setSelectedDate = useCallback((date: string) => {
    setSelectedDateState(date);
    saveBeidanState({ selectedDate: date });
  }, []);

  // 初次加载恢复滚动位置
  useEffect(() => {
    if (initialState.scrollTop > 0) {
      // 等待首屏渲染后再恢复滚动
      const timer = setTimeout(() => {
        window.scrollTo(0, initialState.scrollTop);
      }, 100);
      return () => clearTimeout(timer);
    }
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动时防抖保存 scrollTop
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveBeidanState({ scrollTop: window.scrollY });
      }, 150);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const sortedMatches = useMemo(() => {
    return [...matches].sort((a: MatchItem, b: MatchItem) => {
      const timeCmp = a.kickoffTime.localeCompare(b.kickoffTime);
      if (timeCmp !== 0) return timeCmp;
      return a.matchNo.localeCompare(b.matchNo);
    });
  }, [matches]);

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

  const refreshInterval = hasLiveMatch ? 60 : 300;

  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const params: GetMatchesParams = {
        date: selectedDate,
        source: 'beidan',
      };
      const response = await matchesApi.getMatches(params);
      setMatches(response.items ?? []);
      setDateStr(response.date ?? selectedDate);
      setLastUpdateIso(new Date().toISOString());
    } catch (err) {
      logger.error('加载北单赛事数据失败', err);
      if (!silent) setError('加载失败，请稍后重试');
    } finally {
      if (!silent) setLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void fetchMatches();
  }, [fetchMatches]);

  // 定时刷新
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      void fetchMatches(true);
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [loading, refreshInterval, fetchMatches]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    void fetchMatches(true);
    toast.success('已刷新北单赛事数据');
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
        <section className="relative overflow-hidden hero-dark-bg">
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-10 pb-14 md:pt-16 md:pb-20">
            <div className="h-4 w-40 bg-white/10 rounded animate-pulse mb-6" />
            <div className="h-12 md:h-20 w-72 md:w-96 bg-white/10 rounded-lg animate-pulse mb-4" />
            <div className="h-4 w-96 bg-white/10 rounded animate-pulse" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-background rounded-t-[2rem]" />
        </section>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 -mt-2 relative z-10 space-y-4">
          <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="space-y-4 pt-4">
            {[0, 1, 2].map((i: number) => (
              <div
                key={i}
                className="bg-white border border-gray-100 rounded-3xl p-5 space-y-4"
                style={{ boxShadow: '0 10px 40px -15px rgba(0, 0, 0, 0.08)' }}
              >
                <div className="flex justify-between">
                  <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
                </div>
                <div className="flex justify-between">
                  <div className="h-6 w-28 bg-gray-100 rounded animate-pulse" />
                  <div className="h-6 w-20 bg-gray-100 rounded animate-pulse" />
                  <div className="h-6 w-28 bg-gray-100 rounded animate-pulse" />
                </div>
                <div className="h-2 w-full bg-gray-100 rounded-full animate-pulse" />
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
        <section className="relative overflow-hidden hero-dark-bg">
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-10 pb-14 md:pt-16 md:pb-20">
            <div className="eyebrow eyebrow-line text-white/70 mb-6">
              FOOTBALL DATA
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
    <div className="bg-background min-h-screen">
      {/* Hero 深红品牌区块 */}
      <section className="relative overflow-hidden hero-dark-bg">
        <div className="absolute inset-0 grid-pattern opacity-30" />
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-10 pb-14 md:pt-16 md:pb-20">
          <div className="eyebrow eyebrow-line text-white/70 mb-6">
            FOOTBALL DATA · 北单赛事
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
            <div className="max-w-2xl">
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white leading-[1.05]">
                北单赛事
                <span className="block mt-1">数据参考</span>
              </h1>
              <p className="mt-4 text-sm md:text-base text-white/60 leading-relaxed max-w-lg">
                 覆盖让分赛果维度，基于独立预期净胜分模型计算概率，
                数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛。
              </p>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white/10 backdrop-blur border border-white/20 text-white text-sm font-semibold hover:bg-white/15 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新数据
            </button>
          </div>

          {/* 当日核心指标 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <div className="glass-card p-4 md:p-5">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Total Matches</div>
              <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white tabular-nums">
                {matches.length}
              </div>
              <div className="mt-1 text-xs text-white/50">场比赛</div>
            </div>
            <div className="glass-card p-4 md:p-5">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Handicap</div>
              <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-white tabular-nums">
                {matches.filter((m: MatchItem) => m.handicapRecommendation && m.handicapRecommendation !== '观望').length}
              </div>
              <div className="mt-1 text-xs text-white/50">让分参考</div>
            </div>
            <div className="glass-card p-4 md:p-5">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">High Confidence</div>
              <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-[#FFA07A] tabular-nums">
                {matches.filter((m: MatchItem) => m.confidence >= 65).length}
              </div>
              <div className="mt-1 text-xs text-white/50">高信心场次</div>
            </div>
            <div className="glass-card p-4 md:p-5">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Live Now</div>
              <div className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-[#CD5C5C] tabular-nums">
                {hasLiveMatch ? '进行中' : '0'}
              </div>
              <div className="mt-1 text-xs text-white/50">实时比分</div>
            </div>
          </div>
        </div>
        {/* 底部过渡弧 */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-background rounded-t-[2rem]" />
      </section>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 -mt-2 relative z-10">
        {/* 顶部标题区 */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              北单赛程
            </h1>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            北单让分赛果 · 数据来源：足球赛事数据 · 数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛
          </p>
        </div>

        {/* 日期选择器 */}
        <div className="mb-6">
          <div className="eyebrow eyebrow-line mb-3">
            Match Calendar
          </div>
          <div className="overflow-x-auto scrollbar-hide -mx-4 md:mx-0 px-4 md:px-0 pb-1">
            <div className="flex gap-2 min-w-min">
              {dateList.map((d) => {
                const isSelected = selectedDate === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDate(d.date)}
                    className={`flex-shrink-0 flex flex-col items-center justify-center w-16 py-3 rounded-2xl border-2 transition-all duration-300 text-xs cursor-pointer ${
                      isSelected
                        ? 'bg-nebula-crimson text-white border-nebula-crimson shadow-lg shadow-nebula-crimson/30 scale-105'
                        : 'bg-white text-gray-500 border-gray-100 hover:border-nebula-crimson/30 hover:shadow-md'
                    }`}
                  >
                    <span className={`text-xl font-black leading-none ${
                      d.isToday && !isSelected ? 'text-nebula-crimson' : ''
                    }`}>
                      {d.day}
                    </span>
                    <span className={`text-[10px] mt-1.5 font-semibold ${
                      isSelected ? 'text-white/80' : 'text-gray-400'
                    }`}>
                      {d.weekday}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 日期标题 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black tracking-tight text-foreground">
              {dateStr ? formatDate(dateStr) : ''}
            </h2>
            <span className="text-sm text-gray-400 font-medium">
              共 <span className="text-nebula-crimson font-bold">{matches.length}</span> 场比赛
            </span>
          </div>
        </div>

        {/* 无数据空态 */}
        {!loading && matches.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-center metric-card">
            <CalendarDays className="w-14 h-14 text-gray-200 mb-4" />
            <p className="text-lg font-bold text-foreground mb-1">
              今日暂无北单赛事
            </p>
            <p className="text-sm text-gray-400 mt-2">
              北单比赛数据可能尚未更新或当日已全部完赛，请稍后再试或切换日期查看
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
              <Trophy className="w-4 h-4" />
              <span>数据来源：足球赛事数据</span>
            </div>
          </div>
        )}

        {/* 比赛列表 */}
        {matches.length > 0 && (
          <div className="space-y-4">
            {sortedMatches.map((match: MatchItem) => {
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
                  onToggleFavorite={handleToggleFavorite}
                  onViewDetail={(id: string) => navigate(`/match/${id}`)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default BeidanPage;
