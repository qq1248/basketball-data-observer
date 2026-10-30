import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, NavLink, useLocation } from 'react-router-dom';
import {
  Trophy,
  Dumbbell,
  CalendarDays,
  Activity,
  Database,
  TrendingUp,
  Users,
  BookOpen,
  HelpCircle,
  ChevronRight,
  Zap,
  Target,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Home,
  User,
  LineChart,
  Info,
} from 'lucide-react';
import QRCode from 'qrcode';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { syncApi, statisticsApi, versionApi, matchesApi, basketballApi } from '@client/src/api';
import type { SyncHealthResponse } from '@shared/api.interface';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { ErrorState } from '@client/src/components/ui/error-state';

interface HomeOverviewData {
  footballToday: number;
  basketballToday: number;
  beidanToday: number;
  footballLive: number;
  basketballLive: number;
  footballHitRate: number | null;
  basketballHitRate: number | null;
  syncHealth: SyncHealthResponse | null;
  modelVersion: string;
  lastUpdate: string;
}

  const BrandPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [qrLoaded, setQrLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<HomeOverviewData>({
    footballToday: 0,
    basketballToday: 0,
    beidanToday: 0,
    footballLive: 0,
    basketballLive: 0,
    footballHitRate: null,
    basketballHitRate: null,
    syncHealth: null,
    modelVersion: '',
    lastUpdate: '',
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      resolveAppUrl('/'),
      {
        width: 180,
        margin: 1,
        color: {
          dark: '#0B1220',
          light: '#FFFFFF',
        },
      },
      (err: unknown) => {
        if (!err) setQrLoaded(true);
      }
    );
  }, []);

  const loadOverview = useCallback(() => {
    const today = new Date();
    const beijingMs = today.getTime() + 8 * 60 * 60 * 1000;
    const dateStr = new Date(beijingMs).toISOString().slice(0, 10);

    setLoading(true);
    setError(null);

    Promise.allSettled([
      syncApi.getSyncHealth(),
      statisticsApi.getStatsOverview().catch(() => null),
      statisticsApi.getBasketballStatsOverview().catch(() => null),
      versionApi.getVersion().catch(() => null),
      // 拉当日全量用于统计 live 场次数（pageSize 放大覆盖当日全部）
      matchesApi.getMatches({ date: dateStr, pageSize: 200, page: 1 }).catch(() => null),
      basketballApi.getBasketballMatches({ date: dateStr, pageSize: 200, page: 1 }).catch(() => null),
      // 北单当日场次（与足篮球入口口径一致：今日 total）
      matchesApi.getMatches({ date: dateStr, source: 'beidan', pageSize: 1, page: 1 }).catch(() => null),
    ]).then((results) => {
      const [syncResult, fbStatsResult, bbStatsResult, versionResult, fbListResult, bbListResult, beidanListResult] = results;

      const data: HomeOverviewData = {
        footballToday: 0,
        basketballToday: 0,
        beidanToday: 0,
        footballLive: 0,
        basketballLive: 0,
        footballHitRate: null,
        basketballHitRate: null,
        syncHealth: null,
        modelVersion: '',
        lastUpdate: new Date().toISOString(),
      };

      if (syncResult.status === 'fulfilled') {
        data.syncHealth = syncResult.value;
        data.footballToday = syncResult.value.footballCount ?? 0;
        data.basketballToday = syncResult.value.basketballCount ?? 0;
        if (syncResult.value.footballDataFreshAt) {
          data.lastUpdate = syncResult.value.footballDataFreshAt;
        }
      }
      if (fbStatsResult.status === 'fulfilled' && fbStatsResult.value) {
        data.footballHitRate = fbStatsResult.value.winDrawWinHitRate ?? null;
      }
      if (bbStatsResult.status === 'fulfilled' && bbStatsResult.value?.overview) {
        data.basketballHitRate = bbStatsResult.value.overview.wdwHitRate ?? null;
      }
      if (versionResult.status === 'fulfilled' && versionResult.value) {
        data.modelVersion = `v${versionResult.value.version}`;
      }
      if (fbListResult.status === 'fulfilled' && fbListResult.value) {
        data.footballToday = fbListResult.value.total ?? data.footballToday;
        const items = fbListResult.value.items ?? [];
        data.footballLive = items.filter(
          (m: { matchStatus: string }) => m.matchStatus === 'live'
        ).length;
      }
      if (bbListResult.status === 'fulfilled' && bbListResult.value) {
        data.basketballToday = bbListResult.value.total ?? data.basketballToday;
        const items = bbListResult.value.items ?? [];
        data.basketballLive = items.filter(
          (m: { matchStatus: string }) => m.matchStatus === 'live'
        ).length;
      }
      if (beidanListResult.status === 'fulfilled' && beidanListResult.value) {
        data.beidanToday = beidanListResult.value.total ?? 0;
      }

       setOverview(data);
       // 判定是否为完全加载失败：核心数据源 syncHealth 和赛事列表均失败
       const allCoreFailed =
         syncResult.status === 'rejected' &&
         fbListResult.status === 'rejected' &&
         bbListResult.status === 'rejected';
       if (allCoreFailed) setError('数据加载失败，请稍后重试');
     }).catch((err: unknown) => {
       logger.error('[brand] 加载概览数据失败', err);
       setError('数据加载失败，请稍后重试');
     }).finally(() => {
       setLoading(false);
     });
   }, []);

   useEffect(() => {
     loadOverview();
   }, [loadOverview]);

  const bottomTabs = [
    { to: '/brand', label: '首页', icon: Home, end: true },
    { to: '/', label: '足球', icon: Trophy, end: true },
    { to: '/basketball', label: '篮球', icon: Dumbbell, end: false },
    { to: '/profile', label: '我的', icon: User, end: false },
  ];

  const topNavItems = [
    { to: '/brand', label: '品牌首页', end: true },
    { to: '/', label: '足球数据', end: true },
    { to: '/basketball', label: '篮球数据', end: false },
    { to: '/beidan', label: '更多赛事', end: false },
    { to: '/stats/football', label: '数据统计', end: false },
    { to: '/performance/football', label: '模型表现', end: false },
    { to: '/rules', label: '模型规则', end: false },
  ];

  const entries = [
    {
      label: '足球数据',
      sub: '赛事 · 指数 · 球队分析',
      icon: Trophy,
      path: '/',
      count: overview.footballToday,
      live: overview.footballLive,
      accent: 'from-yellow-400 to-amber-500',
      glow: 'shadow-amber-500/20',
    },
    {
      label: '篮球数据',
      sub: 'WNBA · CBA · NBA',
      icon: Dumbbell,
      path: '/basketball',
      count: overview.basketballToday,
      live: overview.basketballLive,
      accent: 'from-orange-400 to-red-500',
      glow: 'shadow-orange-500/20',
    },
    {
      label: '更多赛事',
      sub: '北单等更多赛事数据',
      icon: CalendarDays,
      path: '/beidan',
      count: overview.beidanToday,
      live: 0,
      accent: 'from-emerald-400 to-teal-500',
      glow: 'shadow-emerald-500/20',
    },
  ];

  const quickEntries = [
    { label: '球队档案', icon: Users, path: '/teams' },
    { label: '数据统计', icon: BarChart3, path: '/stats/football' },
    { label: '模型规则', icon: BookOpen, path: '/rules' },
    { label: '模型表现', icon: TrendingUp, path: '/performance/football' },
    { label: '帮助中心', icon: HelpCircle, path: '/help' },
    { label: '关于我们', icon: Activity, path: '/about' },
  ];

  const syncSources = [
    {
      key: 'football',
      label: '足球数据',
      data: overview.syncHealth?.lastSync?.football,
      freshAt: overview.syncHealth?.footballDataFreshAt,
    },
    {
      key: 'basketball',
      label: '篮球数据',
      data: overview.syncHealth?.lastSync?.basketball,
      freshAt: overview.syncHealth?.basketballDataFreshAt,
    },
    {
      key: 'score',
      label: '比分更新',
      data: overview.syncHealth?.lastSync?.score,
      freshAt: null,
    },
  ];

  const formatRelativeTime = (iso: string | null | undefined): string => {
    if (!iso) return '--';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    return formatBeijingTime(iso, 'date-time');
  };

  const todayDisplay = (() => {
    const now = new Date();
    const beijingMs = now.getTime() + 8 * 60 * 60 * 1000;
    const d = new Date(beijingMs);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}月${day}日 ${weekday}`;
  })();

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-amber-500/[0.08] blur-[100px]" />
        <div className="absolute top-[30%] right-0 w-[400px] h-[300px] rounded-full bg-blue-500/[0.06] blur-[80px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[400px] rounded-full bg-amber-600/[0.05] blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* 桌面端顶部导航栏 */}
      <header className="hidden md:block fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#0B0F1A]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/brand')}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Zap className="w-5 h-5 text-slate-900" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-base font-black tracking-tight bg-gradient-to-r from-yellow-300 to-amber-500 bg-clip-text text-transparent">
                观察体育
              </div>
              <div className="text-[10px] text-white/40 tracking-widest">OBSERVE SPORTS</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {topNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'text-amber-400 bg-amber-400/10'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <User className="w-4 h-4" />
              <span>我的</span>
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-1.5 rounded-lg text-sm font-bold text-slate-900 bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 transition-all shadow-lg shadow-amber-500/20"
            >
              进入数据中心
            </button>
          </div>
        </div>
      </header>

      <div className="relative md:max-w-4xl lg:max-w-5xl mx-auto px-4 md:px-8 pt-5 md:pt-24 pb-28 md:pb-12 min-h-screen flex flex-col">
        {/* 顶部状态栏（移动端） */}
        <div className="md:hidden flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-slate-900" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight">观察体育</div>
              <div className="text-[10px] text-white/40 tracking-wider">OBSERVE SPORTS</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-medium text-emerald-400">实时</span>
          </div>
        </div>

        {/* Hero 品牌区 */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-400/20 bg-amber-400/5">
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold bg-gradient-to-r from-yellow-300 to-amber-400 bg-clip-text text-transparent">
              Professional Sports Data
            </span>
          </div>
          <h1 className="mt-4 text-5xl font-black tracking-tight leading-none">
            <span className="bg-gradient-to-br from-yellow-300 via-amber-400 to-amber-600 bg-clip-text text-transparent">
              观察体育
            </span>
          </h1>
          <p className="mt-2.5 text-xs text-white/50 leading-relaxed">
            足篮球赛事数据统计与分析参考平台
          </p>
          <div className="mt-1.5 flex items-center justify-center gap-3 text-[10px] text-white/30">
            <span>{todayDisplay}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <RefreshCw className="w-2.5 h-2.5" />
              {loading ? '加载中' : formatRelativeTime(overview.lastUpdate)}更新
            </span>
          </div>
        </div>

         {/* 核心数据指标面板 */}
         {!loading && error ? (
           <div className="mt-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm">
             <ErrorState
               size="sm"
               message={error}
               onRetry={loadOverview}
               className="text-white"
             />
           </div>
         ) : (
         <div className="mt-6 grid grid-cols-4 gap-2">
          {[
            {
              label: '今日赛事',
              value: loading ? '--' : overview.footballToday + overview.basketballToday,
              unit: '场',
              icon: Target,
              accent: 'text-amber-400',
              bg: 'bg-amber-400/10',
            },
            {
              label: '进行中',
              value: loading ? '--' : overview.footballLive + overview.basketballLive,
              unit: '场',
              icon: Activity,
              accent: 'text-emerald-400',
              bg: 'bg-emerald-400/10',
            },
            {
              label: '足球胜率',
              value: loading ? '--' : (overview.footballHitRate != null ? `${Math.round(overview.footballHitRate * 100)}` : '--'),
              unit: '%',
              icon: TrendingUp,
              accent: 'text-yellow-400',
              bg: 'bg-yellow-400/10',
            },
            {
              label: '篮球胜率',
              value: loading ? '--' : (overview.basketballHitRate != null ? `${Math.round(overview.basketballHitRate * 100)}` : '--'),
              unit: '%',
              icon: BarChart3,
              accent: 'text-orange-400',
              bg: 'bg-orange-400/10',
            },
           ].map((stat) => {
             const Icon = stat.icon;
             return (
               <div
                 key={stat.label}
                 className="rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm p-3 flex flex-col items-center"
               >
                 <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center mb-2`}>
                   <Icon className={`w-3.5 h-3.5 ${stat.accent}`} strokeWidth={2} />
                 </div>
                 <div className="flex items-baseline gap-0.5">
                   {loading ? (
                     <Skeleton className="w-8 h-5 bg-white/10" />
                   ) : (
                     <span className={`text-lg font-black ${stat.accent}`}>{stat.value}</span>
                   )}
                   <span className="text-[10px] text-white/40">{stat.unit}</span>
                 </div>
                 <div className="mt-0.5 text-[10px] text-white/40">{stat.label}</div>
               </div>
             );
           })}
         </div>
         )}

        {/* 三大核心入口 */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-3.5 rounded-full bg-gradient-to-b from-amber-400 to-amber-600" />
              <h2 className="text-sm font-black tracking-tight">数据中心</h2>
            </div>
            <span className="text-[10px] text-white/30">点击进入</span>
          </div>
          <div className="space-y-3">
            {entries.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.label}
                  onClick={() => navigate(entry.path)}
                  className="group w-full relative p-4 rounded-2xl bg-white/[0.04] backdrop-blur-md border border-white/[0.08] hover:border-amber-400/30 hover:bg-white/[0.06] transition-all duration-300 text-left overflow-hidden"
                >
                  <div
                    className={`absolute top-0 right-0 w-32 h-32 rounded-full bg-gradient-to-br ${entry.accent} opacity-[0.08] blur-2xl group-hover:opacity-[0.15] transition-opacity`}
                    style={{ transform: 'translate(30%, -30%)' }}
                  />
                  <div className="relative flex items-center gap-3.5">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${entry.accent}/20 to-transparent flex items-center justify-center flex-shrink-0`}>
                      <Icon className="w-6 h-6 text-amber-400" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-white tracking-tight">
                          {entry.label}
                        </span>
                        {entry.live > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-[10px] font-medium text-emerald-400">
                            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                            LIVE {entry.live}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-white/40 leading-snug">
                        {entry.sub}
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                        <span className="text-white/60">
                          今日 <span className="font-bold text-amber-400">{loading ? '--' : entry.count}</span> 场
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center group-hover:bg-amber-400/20 group-hover:scale-110 transition-all">
                      <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-amber-400 transition-colors" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 数据同步状态 */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-3.5 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />
              <h2 className="text-sm font-black tracking-tight">数据同步</h2>
            </div>
            {overview.syncHealth?.schedulerRunning && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                调度运行中
              </span>
            )}
          </div>
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm divide-y divide-white/[0.06]">
            {syncSources.map((src) => {
              const ok = src.data?.success;
              const isLoading = loading || !src.data;
              return (
                <div key={src.key} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isLoading ? 'bg-white/5' : ok ? 'bg-emerald-500/10' : 'bg-red-500/10'
                    }`}>
                      {isLoading ? (
                        <Skeleton className="w-4 h-4 rounded-full bg-white/10" />
                      ) : ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={2} />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-400" strokeWidth={2} />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white/80">{src.label}</div>
                      <div className="text-[10px] text-white/40 mt-0.5 max-w-[180px] truncate">
                        {isLoading
                          ? '同步中...'
                          : ok
                          ? `最近更新：${formatRelativeTime(src.freshAt || src.data?.at)}`
                          : '同步异常，正在重试'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {!isLoading && 'inserted' in src.data && src.data.inserted != null && (
                      <div className="text-[11px] font-bold text-amber-400">
                        +{src.data.inserted + (src.data.updated ?? 0)}
                      </div>
                    )}
                    <div className="text-[10px] text-white/30">
                      {ok ? '正常' : isLoading ? '--' : '异常'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 快捷入口 */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-3.5 rounded-full bg-gradient-to-b from-blue-400 to-blue-600" />
              <h2 className="text-sm font-black tracking-tight">快捷入口</h2>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {quickEntries.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.label}
                  onClick={() => navigate(entry.path)}
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.06] transition-all"
                >
                  <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center group-hover:bg-amber-400/15 transition-colors">
                    <Icon className="w-4 h-4 text-white/60 group-hover:text-amber-400 transition-colors" strokeWidth={1.8} />
                  </div>
                  <span className="text-[11px] text-white/60 group-hover:text-white/80 transition-colors">
                    {entry.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 模型版本信息 */}
        {overview.modelVersion && (
          <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-white/25">
            <Database className="w-3 h-3" />
            <span>预测模型 {overview.modelVersion}</span>
            <span>·</span>
            <span>{overview.syncHealth?.source === 'hybrid' ? '混合源' : overview.syncHealth?.source === 'sporttery-live' ? '官方源' : '外部源'}</span>
          </div>
        )}

        {/* 分享二维码 */}
        <div className="mt-6 flex-1 flex flex-col items-center justify-start">
          <div className="w-[240px] bg-white rounded-2xl shadow-2xl shadow-amber-500/10 p-4 flex flex-col items-center">
            <div className="w-[180px] h-[180px] bg-white rounded-lg flex items-center justify-center relative">
              {!qrLoaded && (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <div className="w-5 h-5 border-2 border-slate-200 border-t-amber-400 rounded-full animate-spin" />
                  <span className="text-[10px]">生成分享码中...</span>
                </div>
              )}
              <canvas
                ref={canvasRef}
                style={{
                  width: '180px',
                  height: '180px',
                  imageRendering: 'pixelated',
                  opacity: qrLoaded ? 1 : 0,
                  transition: 'opacity 0.3s ease',
                }}
              />
            </div>
            <div className="mt-3 text-center">
              <div className="text-sm font-black tracking-tight bg-gradient-to-r from-yellow-500 to-amber-600 bg-clip-text text-transparent">
                观察体育
              </div>
              <div className="mt-0.5 text-[9px] text-slate-400 tracking-widest">
                OBSERVE SPORTS
              </div>
            </div>
            <div className="mt-2.5 w-full pt-2.5 border-t border-slate-100 text-center">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                扫码查看 · 足篮球赛事数据参考
              </p>
            </div>
          </div>
        </div>



        {/* 底部免责声明 */}
        <div className="mt-6 mb-2 text-center">
          <p className="text-[10px] text-white/25 leading-relaxed">
            数据与模型分析仅供参考，不构成任何决策建议。
          </p>
          <p className="text-[10px] text-white/20 leading-relaxed mt-0.5">
            请理性看待体育赛事，理性观赛。
          </p>
        </div>
      </div>

      {/* 移动端底部 Tab 导航 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.08] bg-[#0B0F1A]/95 backdrop-blur-xl safe-area-bottom shadow-[0_-4px_24px_rgba(0_0_0_0.3)]">
        <div className="grid grid-cols-4 h-16">
          {bottomTabs.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                replace
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-1 w-full h-full transition-all duration-300 ${
                    isActive ? 'text-amber-400' : 'text-white/40'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-5 h-5 transition-all ${isActive ? 'scale-110' : ''}`} strokeWidth={1.8} />
                    <span className="text-[10px] font-semibold whitespace-nowrap leading-tight">{item.label}</span>
                    <span
                      className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full transition-all ${
                        isActive ? 'bg-amber-400 scale-100' : 'bg-transparent scale-0'
                      }`}
                    />
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default BrandPage;
