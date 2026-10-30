import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Heart,
  HeartOff,
  Eye,
  Star,
  Clock,
  ChevronRight,
  StarOff,
  Target,
  TrendingUp,
  BarChart3,
  User as UserIcon,
  Trophy,
  Shield,
  Info,
  Moon,
  Sun,
  BookOpen,
  HelpCircle,
  LogOut,
  LineChart,
  Users,
  Settings,
  RefreshCw,
  KeyRound,
  MessageCircle,
} from 'lucide-react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { Input } from '@client/src/components/ui/input';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  predictionRecordsApi,
  statisticsApi,
  basketballApi,
} from '@client/src/api';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import type { GuestRecord } from '@client/src/hooks/useGuestStore';
import AuthModal from '@client/src/components/AuthModal';
import { ChangelogDialog } from '@client/src/components/ChangelogDialog';
import { toast } from 'sonner';
import type {
  PredictionRecordItem,
} from '@shared/api.interface';
import { useTheme } from '@client/src/hooks/useTheme';
import { useAccentTheme } from '@client/src/contexts/ThemeContext';
import { ThemeSelector } from '@client/src/components/ThemeSelector';

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  viewed: { label: '浏览', className: 'bg-muted text-muted-foreground' },
  favorited: { label: '收藏', className: 'bg-amber-50 text-accent border border-accent/20' },
  hit: { label: '符合', className: 'bg-hit-bg text-success border border-success/20' },
  missed: { label: '未中', className: 'bg-miss-bg text-miss-text border border-miss-text/20' },
};

const formatTime = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
  } catch {
    return isoStr;
  }
};

type ListKey =
  | 'favorites'
  | 'followedTeams'
  | 'records'
  | 'hitStats'
  | 'accountSync'
  | 'settings'
  | 'help'
  | 'rules'
  | 'about'
  | 'changelog'
  | 'footballStats'
  | 'basketballStats'
  | 'basketballBacktest'
  | 'teams'
  | 'admin'
  | 'changePassword'
  | 'support'
  | 'footballPerformance'
  | 'basketballPerformance';

interface ListItem {
  key: ListKey;
  icon: React.ElementType;
  label: string;
  desc?: string;
  color: string;
  badge?: string;
  right?: React.ReactNode;
}

const ProfilePage = () => {
  const navigate = useNavigate();
  const { isLight: isLightTheme, toggleTheme } = useTheme();
  const { theme: accentTheme, themes: accentThemes } = useAccentTheme();

  const syncStore = useSyncStore();
  const selfUser = syncStore.user;
  const selfAuthLoading = syncStore.authLoading;
  const isLoggedIn = !!selfUser;
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [favLoading] = useState(false);
  const [favError] = useState<string | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [records, setRecords] = useState<PredictionRecordItem[]>([]);
  const [followedLoading] = useState(false);
  const [followedError] = useState<string | null>(null);
  const [hitStatsLoading, setHitStatsLoading] = useState(false);
  const [hitStatsError] = useState<string | null>(null);
  const [hitStats, setHitStats] = useState<{
    totalMatches: number;
    winDrawWinHitRate: number;
    handicapHitRate: number;
    overUnderHitRate: number;
    byLeague: { league: string; count: number; hitRate: number }[];
  } | null>(null);

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [recordLeagueFilter, setRecordLeagueFilter] = useState<string>('all');
  const [recordDateFilter, setRecordDateFilter] = useState<string>('all');

  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [changePwdSaving, setChangePwdSaving] = useState(false);
  const [changePwdForm, setChangePwdForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [ssoTipOpen, setSsoTipOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

  const favoriteIds = syncStore.favorites;
  const followedTeamNames = syncStore.followedTeams;

  const hitRateFromLocal = useMemo(() => {
    const localRecords: GuestRecord[] = syncStore.records;
    const actionable = localRecords.filter((r: GuestRecord) =>
      r.actionType === 'hit' || r.actionType === 'missed',
    );
    if (actionable.length === 0) return '0%';
    const hits = actionable.filter((r: GuestRecord) => r.actionType === 'hit').length;
    return `${((hits / actionable.length) * 100).toFixed(1)}%`;
  }, [syncStore.records]);

  const isAdmin = selfUser?.role === 'admin';

  const loadPageData = async () => {
    if (!isLoggedIn) {
      setRecords([]);
      setHitStats(null);
      return;
    }

    setRecLoading(true);
    setHitStatsLoading(true);
    setRecError(null);

    const results = await Promise.allSettled([
      predictionRecordsApi.getPredictionRecords(),
      statisticsApi.getStatsOverview(),
      basketballApi.getBasketballStats(),
    ]);

    const [recordsResult, footballResult, basketballResult] = results;

    // 预测记录
    if (recordsResult.status === 'fulfilled') {
      setRecords(recordsResult.value.items);
    } else {
      logger.warn('加载预测记录失败，降级为空', recordsResult.reason);
      setRecords([]);
    }

    // 准确统计（足球 + 篮球合并）
    const footballStats =
      footballResult.status === 'fulfilled'
        ? footballResult.value
        : {
            totalMatches: 0,
            winDrawWinHitRate: 0,
            handicapHitRate: 0,
            overUnderHitRate: 0,
            byLeague: [],
          };
    const basketballStats =
      basketballResult.status === 'fulfilled'
        ? basketballResult.value
        : { overview: { finishedMatches: 0 } };

    if (footballResult.status === 'rejected') {
      logger.warn('加载足球统计失败，降级为 0', footballResult.reason);
    }
    if (basketballResult.status === 'rejected') {
      logger.warn('加载篮球统计失败，降级为 0', basketballResult.reason);
    }

    const totalMatches = footballStats.totalMatches + basketballStats.overview.finishedMatches;
    setHitStats({
      totalMatches,
      winDrawWinHitRate: footballStats.winDrawWinHitRate,
      handicapHitRate: footballStats.handicapHitRate,
      overUnderHitRate: footballStats.overUnderHitRate,
      byLeague: footballStats.byLeague,
    });

    setRecLoading(false);
    setHitStatsLoading(false);
  };

  useEffect(() => {
    void loadPageData();
  }, [isLoggedIn]);

  const handleRemoveFavorite = (e: React.MouseEvent, matchId: string) => {
    e.stopPropagation();
    syncStore.removeFavorite(matchId);
  };

  const handleRemoveFollowedTeam = (teamName: string) => {
    syncStore.unfollowTeam(teamName);
    toast.success('已取消关注');
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await syncStore.logout();
      toast.success('已退出登录，本地数据已保留');
    } catch (err) {
      logger.error('退出登录失败', err);
      toast.error('退出登录失败');
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleAuthSuccess = async () => {
    // AuthModal 内部 useAuth 已设 user，但 syncStore 需触发合并
    try {
      await syncStore.fetchMe();
      await syncStore.mergeGuestToCloud();
      toast.success('登录成功，数据已同步');
    } catch (err) {
      logger.error('登录后同步失败', err);
    }
  };

  const filteredRecords = useMemo(() => {
    let result = records;
    if (recordLeagueFilter !== 'all') {
      result = result.filter((r) => r.match.league === recordLeagueFilter);
    }
    if (recordDateFilter !== 'all') {
      const today = new Date();
      if (recordDateFilter === '7d') {
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        result = result.filter(
          (r) => new Date(r.viewedAt || r.createdAt) >= sevenDaysAgo,
        );
      } else if (recordDateFilter === '30d') {
        const thirtyDaysAgo = new Date(
          today.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        result = result.filter(
          (r) => new Date(r.viewedAt || r.createdAt) >= thirtyDaysAgo,
        );
      }
    }
    return result;
  }, [records, recordLeagueFilter, recordDateFilter]);

  const recordLeagues = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      set.add(r.match.league);
    }
    return Array.from(set);
  }, [records]);

  const toggleSection = (key: string) => {
    setExpandedSection(expandedSection === key ? null : key);
  };

  const myDataItems: ListItem[] = [
    {
      key: 'favorites',
      icon: Star,
      label: '我的收藏',
      desc: favoriteIds.length > 0 ? `${favoriteIds.length} 场比赛` : '暂无收藏',
      color: 'text-accent',
    },
    {
      key: 'followedTeams',
      icon: Heart,
      label: '关注球队',
      desc: followedTeamNames.length > 0 ? `${followedTeamNames.length} 支球队` : '暂无关注',
      color: 'text-away-win',
    },
    {
      key: 'records',
      icon: Clock,
      label: '浏览记录',
      desc: syncStore.records.length > 0 ? `${syncStore.records.length} 场比赛` : '暂无浏览',
      color: 'text-muted-foreground',
    },
  ];

  const analysisItems: ListItem[] = [
    { key: 'hitStats', icon: BarChart3, label: '我的模型准确率', desc: '赛果方向/让分/进球数', color: 'text-home-win' },
  ];

  const dataAnalysisItems: ListItem[] = [
    { key: 'footballStats', icon: BarChart3, label: '足球数据', color: 'text-primary' },
    { key: 'basketballStats', icon: BarChart3, label: '篮球数据', color: 'text-home-win' },
    { key: 'footballPerformance', icon: TrendingUp, label: '足球表现', desc: '模型命中率追踪', color: 'text-primary' },
    { key: 'basketballPerformance', icon: TrendingUp, label: '篮球表现', desc: '模型命中率追踪', color: 'text-home-win' },
    { key: 'basketballBacktest', icon: LineChart, label: '篮球回测', color: 'text-accent' },
    { key: 'teams', icon: Users, label: '球队库', color: 'text-muted-foreground' },
  ];

  const helpRulesItems: ListItem[] = [
    { key: 'rules', icon: BookOpen, label: '模型规则', color: 'text-primary' },
    { key: 'help', icon: HelpCircle, label: '使用帮助', color: 'text-muted-foreground' },
    { key: 'support', icon: MessageCircle, label: '意见反馈', color: 'text-muted-foreground' },
  ];

  const adminItems: ListItem[] = [
    { key: 'admin', icon: Settings, label: '后台管理', desc: '用户与数据管理', color: 'text-muted-foreground' },
  ];

  const settingsItems: ListItem[] = [
    {
      key: 'accountSync',
      icon: RefreshCw,
      label: '账号同步',
      desc: selfUser
        ? `已同步（${selfUser.email}）`
        : '游客模式 · 本地数据未上传',
      color: 'text-primary',
      right: (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (selfUser) {
              void handleLogout();
            } else {
              setAuthModalOpen(true);
            }
          }}
          className="flex-shrink-0 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          {selfUser ? '退出登录' : '登录 / 注册'}
        </button>
      ),
    },
    {
      key: 'settings',
      icon: isLightTheme ? Sun : Moon,
      label: '主题模式',
      desc: isLightTheme ? '浅色主题' : '深色主题',
      color: 'text-primary',
      right: (
        <button
           onClick={(e) => {
             e.stopPropagation();
             toggleTheme();
           }}
          className="relative h-6 w-11 rounded-full bg-muted transition-colors hover:bg-muted/80 flex-shrink-0"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground shadow transition-all duration-200 ${
              isLightTheme ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      ),
    },
     { key: 'about', icon: Info, label: '关于应用', color: 'text-muted-foreground' },
     { key: 'changelog', icon: RefreshCw, label: '更新日志', desc: `v13.0`, color: 'text-muted-foreground' },
    ...(selfUser
      ? [
          {
            key: 'changePassword' as const,
            icon: KeyRound,
            label: '修改密码',
            desc: '修改登录密码',
            color: 'text-muted-foreground',
          },
        ]
      : []),
  ];

  const isSsoAccount = (): boolean => {
    if (!selfUser?.email) return false;
    const email = selfUser.email;
    return email.startsWith('platform_') || email.endsWith('@sso.local');
  };

  const handleChangePwdSubmit = async () => {
    const { currentPassword, newPassword, confirmPassword } = changePwdForm;
    if (!currentPassword) {
      toast.error('请输入当前密码');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast.error('新密码必须包含字母和数字');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setChangePwdSaving(true);
    try {
      await axiosForBackend.post('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      toast.success('密码修改成功');
      setChangePwdOpen(false);
      setChangePwdForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '修改失败';
      logger.error('修改密码失败', err);
      toast.error(message);
    } finally {
      setChangePwdSaving(false);
    }
  };

  const handleItemClick = (key: ListKey) => {
    switch (key) {
      case 'changePassword':
        if (isSsoAccount()) {
          setSsoTipOpen(true);
        } else {
          setChangePwdOpen(true);
        }
        break;
      case 'favorites':
      case 'followedTeams':
      case 'records':
      case 'hitStats':
        toggleSection(key);
        break;
      case 'accountSync':
        // 账号同步项点击打开登录弹窗或退出（right 按钮已处理）
        if (!selfUser) setAuthModalOpen(true);
        break;
      case 'settings':
        toggleSection('settings');
        break;
      case 'help':
        navigate('/help');
        break;
      case 'rules':
        navigate('/rules');
        break;
      case 'about':
        navigate('/about');
        break;
      case 'changelog':
        setChangelogOpen(true);
        break;
      case 'footballStats':
        navigate('/stats/football');
        break;
      case 'basketballStats':
        navigate('/basketball/stats');
        break;
      case 'basketballBacktest':
        navigate('/basketball/backtest');
        break;
       case 'teams':
         navigate('/teams');
         break;
       case 'footballPerformance':
         navigate('/performance/football');
         break;
       case 'basketballPerformance':
         navigate('/performance');
         break;
       case 'admin':
        navigate('/admin');
        break;
      case 'support':
        navigate('/support');
        break;
      default:
        break;
    }
  };

  return (
    <div className="min-h-screen bg-background md:bg-background pb-32 overflow-x-hidden md:overflow-x-visible bg-[var(--background)] md:bg-transparent">
      {/* 深红品牌 Hero 区块 / 移动端 Arena Night 风格 */}
      <section className="relative overflow-hidden bg-nebula-crimson md:bg-nebula-crimson text-[var(--foreground)] md:text-white bg-gradient-to-b from-[var(--secondary)] to-[var(--background)] md:bg-none md:from-transparent md:to-transparent">
        <div className="absolute inset-0 opacity-20 crimson-dots hidden md:block" />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl hidden md:block" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-red-900/50 blur-3xl hidden md:block" />
        <div className="relative px-4 md:px-6 pt-6 pb-8 max-w-2xl mx-auto">
          <div className="eyebrow eyebrow-line text-white/80 mb-5 hidden md:block">PERSONAL CENTER</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-primary)]/70 mb-4 md:hidden">PROFILE</div>
          <h1 className="text-xl md:text-3xl lg:text-4xl font-black tracking-tight text-[var(--foreground)] md:text-white mb-6">个人中心</h1>
          {/* 用户信息 glass-card / 移动端深色卡片 */}
          <div className="glass-card p-5 md:p-5 rounded-2xl md:rounded-none bg-[var(--card)]/60 md:bg-transparent border border-[var(--border)] md:border-white/10 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--accent-primary)]/30 md:border-white/20 bg-[var(--secondary)] md:bg-white/10 flex-shrink-0 backdrop-blur-sm">
                  {selfAuthLoading ? (
                    <div className="h-16 w-16 animate-pulse bg-white/20" />
                  ) : selfUser ? (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-primary-dark)]/20 md:from-white/20 md:to-white/5 text-[var(--accent-primary)] md:text-white text-xl font-black font-mono">
                      {selfUser.email.charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    <UserIcon className="h-7 w-7 text-[var(--accent-primary)]/60 md:text-white/60" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-[var(--foreground)] md:text-white truncate">
                    {selfAuthLoading
                      ? '加载中...'
                      : selfUser
                        ? (selfUser.email.split('@')[0] || '用户')
                        : '游客'}
                  </h2>
                  <p className="text-sm text-[var(--muted-foreground)] md:text-white/60 font-medium mt-1 truncate">
                    {selfAuthLoading
                      ? ''
                      : selfUser
                        ? selfUser.email
                        : '游客模式 · 数据仅保存在本地'}
                  </p>
                </div>
              </div>
              {!selfAuthLoading && (
                selfUser ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLogout}
                    disabled={logoutLoading}
                    className="flex-shrink-0 h-8 text-xs border-[var(--border)] md:border-white/20 text-[var(--foreground)] md:text-white hover:bg-[var(--secondary)] md:hover:bg-white/10 hover:text-[var(--foreground)] md:hover:text-white"
                    data-ai-section-type="button"
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1" />
                    退出
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setAuthModalOpen(true)}
                    className="flex-shrink-0 h-8 text-xs bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-dark)] font-black md:bg-white md:text-nebula-crimson md:hover:bg-white/90"
                    data-ai-section-type="button"
                  >
                    登录同步数据 →
                  </Button>
                )
              )}
            </div>

            {/* 账号同步说明 */}
            {!selfUser && !selfAuthLoading && (
              <div className="mt-4 rounded-xl bg-[var(--secondary)] md:bg-white/5 border border-[var(--border)] md:border-white/10 p-3">
                <p className="text-[11px] text-[var(--muted-foreground)] md:text-white/70 leading-relaxed">
                  💡 登录后跨设备同步收藏、关注和设置，游客模式数据仅保存在本地
                </p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-4 gap-2">
              <StatItem
                value={syncStore.records.length}
                label="浏览"
                icon={Eye}
              />
              <StatItem
                value={favoriteIds.length}
                label="收藏"
                icon={Star}
              />
              <StatItem
                value={followedTeamNames.length}
                label="关注"
                icon={Heart}
              />
              <StatItem
                value={hitRateFromLocal}
                 label="符合"
                icon={Target}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="px-4 pt-6 md:px-6 max-w-2xl mx-auto">

      {/* 后台管理入口（仅admin） */}
      {isAdmin && (
        <div className="mb-3 bg-[var(--card)] md:bg-card border border-[var(--border)] md:border-border rounded-2xl md:rounded-xl overflow-hidden">
          <button
            onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors active:bg-[var(--accent-primary)]/5 md:hover:bg-muted/30"
          >
            <div className="w-10 h-10 rounded-xl md:w-8 md:h-8 md:rounded-lg flex items-center justify-center bg-[var(--secondary)] md:bg-primary/10 flex-shrink-0 text-[var(--accent-primary)] md:text-primary">
              <Settings className="w-5 h-5 md:w-4 md:h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--foreground)] md:text-foreground font-medium flex items-center gap-2">
                后台管理
              </div>
              <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">用户/数据管理</div>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)] md:text-muted-foreground flex-shrink-0" />
          </button>
        </div>
      )}

      <ListGroup title="我的数据" items={myDataItems} onItemClick={handleItemClick} />
      {expandedSection === 'favorites' && (
        <ExpandPanel>
          <FavoritesList
             items={favoriteIds}
             loading={favLoading}
             error={favError}
            onNavigate={(id) => navigate(`/match/${id}`)}
            onRemove={handleRemoveFavorite}
           />
        </ExpandPanel>
      )}
      {expandedSection === 'followedTeams' && (
        <ExpandPanel>
          <FollowedTeamsList
             items={followedTeamNames}
             loading={followedLoading}
             error={followedError}
             onRemove={handleRemoveFollowedTeam}
           />
        </ExpandPanel>
      )}
      {expandedSection === 'records' && (
        <ExpandPanel>
          <div className="mb-3 flex flex-wrap gap-2">
            <Select value={recordDateFilter} onValueChange={setRecordDateFilter}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue placeholder="时间" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="7d">近7天</SelectItem>
                <SelectItem value="30d">近30天</SelectItem>
              </SelectContent>
            </Select>
            <Select value={recordLeagueFilter} onValueChange={setRecordLeagueFilter}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="联赛" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部联赛</SelectItem>
                {recordLeagues.map((league) => (
                  <SelectItem key={league} value={league}>{league}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <RecordsList
            items={filteredRecords}
            loading={recLoading}
            error={recError}
            onRetry={loadPageData}
            onNavigate={(id, league) => {
              const isBasketball = league && /NBA|WNBA|篮球|篮联|NBL|CBA|欧篮|西篮|德篮|日篮|菲篮|韩篮|澳篮/i.test(league);
              navigate(isBasketball ? `/basketball/detail/${id}` : `/match/${id}`);
            }}
          />
        </ExpandPanel>
      )}

      <ListGroup title="数据分析" items={analysisItems} onItemClick={handleItemClick} />
      {expandedSection === 'hitStats' && (
        <ExpandPanel>
          <HitStatsPanel
            loading={hitStatsLoading}
            error={hitStatsError}
            data={hitStats}
            onRetry={loadPageData}
          />
        </ExpandPanel>
      )}
       <div className="mb-5 mt-6">
          <div className="eyebrow eyebrow-line mb-2 hidden md:block">ALL FEATURES</div>
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-[var(--foreground)] md:text-foreground mb-5">全部功能</h2>
         <ListGroup title="数据分析" items={dataAnalysisItems} onItemClick={handleItemClick} />
         <ListGroup title="帮助与规则" items={helpRulesItems} onItemClick={handleItemClick} />
         {isAdmin && (
           <ListGroup title="管理工具" items={adminItems} onItemClick={handleItemClick} />
         )}
       </div>
      {/* 帮助与规则入口 */}
       <button
         onClick={() => handleItemClick('help')}
         className="w-full mb-4 rounded-2xl border border-[var(--accent-primary)]/20 md:border-nebula-crimson/20 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-dark)] md:from-nebula-crimson md:to-red-900 p-5 text-left transition-all duration-300 hover:from-[var(--accent-primary-dark)] md:hover:from-red-900 hover:to-[var(--accent-primary-dark)] md:hover:to-nebula-crimson shadow-lg shadow-[var(--accent-glow)] md:shadow-nebula-crimson/20 active:scale-[0.98] md:active:scale-100"
         data-ai-section-type="button"
       >
         <div className="flex items-center gap-4">
           <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0 backdrop-blur-sm">
             <HelpCircle className="w-6 h-6 text-white" />
           </div>
           <div className="flex-1 min-w-0">
             <div className="text-base font-bold md:font-black tracking-tight text-white flex items-center gap-2">
               使用帮助
             </div>
             <div className="text-xs text-white/70 mt-1">
               常见问题 · 使用指南
             </div>
           </div>
           <ChevronRight className="w-5 h-5 text-white/60 flex-shrink-0" />
         </div>
       </button>

       {/* 主题风格选择 */}
       <div className="mb-4">
         <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] px-4 py-3 md:hidden">主题风格</div>
         <div className="metric-card overflow-hidden bg-[var(--card)] md:bg-card rounded-2xl md:rounded-xl border border-[var(--border)] md:border-border px-4 py-4 md:px-5 md:py-4">
           <div className="hidden md:block">
             <h3 className="text-sm font-semibold text-foreground mb-3">主题风格</h3>
             <ThemeSelector />
           </div>
           <div className="md:hidden">
             <div className="flex items-center justify-between mb-3">
               <div>
                 <div className="text-sm text-[var(--foreground)] font-medium">主题风格</div>
                 <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">切换你喜欢的配色</div>
               </div>
               <div className="flex items-center gap-1.5">
                 <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accentThemes.find((t) => t.id === accentTheme)?.color }} />
                 <span className="text-xs text-[var(--accent-primary)] font-medium">
                   {accentThemes.find((t) => t.id === accentTheme)?.name}
                 </span>
               </div>
             </div>
             <ThemeSelector />
           </div>
         </div>
       </div>

       <ListGroup title="设置与帮助" items={settingsItems} onItemClick={handleItemClick} />

      <div className="mt-8 rounded-2xl bg-nebula-crimson/5 md:bg-nebula-crimson/5 bg-[var(--card)] border border-nebula-crimson/10 md:border-nebula-crimson/10 border-[var(--border)] p-5 text-center">
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)] md:text-gray-500">
             数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛
          </p>
        </div>
      {/* 登录/注册弹窗 */}
      <AuthModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        onSuccess={handleAuthSuccess}
      />

      {/* 更新日志弹窗 */}
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />

      {/* 修改密码弹窗 */}
      <Dialog open={changePwdOpen} onOpenChange={setChangePwdOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>请输入当前密码和新密码</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                当前密码
              </label>
              <Input
                type="password"
                value={changePwdForm.currentPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setChangePwdForm({ ...changePwdForm, currentPassword: e.target.value })
                }
                placeholder="请输入当前密码"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                新密码
              </label>
              <Input
                type="password"
                value={changePwdForm.newPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setChangePwdForm({ ...changePwdForm, newPassword: e.target.value })
                }
                placeholder="至少 8 位，包含字母和数字"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                确认新密码
              </label>
              <Input
                type="password"
                value={changePwdForm.confirmPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setChangePwdForm({ ...changePwdForm, confirmPassword: e.target.value })
                }
                placeholder="请再次输入新密码"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChangePwdOpen(false)}
              disabled={changePwdSaving}
              data-ai-section-type="button"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleChangePwdSubmit}
              disabled={changePwdSaving}
              className="bg-[hsl(210_100%_16%)] text-white hover:bg-[hsl(210_100%_20%)]"
              data-ai-section-type="button"
            >
              {changePwdSaving ? '提交中...' : '确认修改'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* SSO 账号提示弹窗 */}
      <Dialog open={ssoTipOpen} onOpenChange={setSsoTipOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>无法修改密码</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            该账号为快捷登录账号，无需设置密码
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setSsoTipOpen(false)}
              className="bg-[hsl(210_100%_16%)] text-white hover:bg-[hsl(210_100%_20%)]"
              data-ai-section-type="button"
            >
              知道了
            </Button>
          </div>
        </DialogContent>
       </Dialog>
      </div>
    </div>
  );
};

const StatItem = ({ value, label, icon: Icon }: { value: number | string; label: string; icon: React.ElementType }) => (
  <div className="rounded-xl bg-white/10 md:bg-white/10 bg-[var(--secondary)] backdrop-blur-sm border border-[var(--border)] md:border-white/15 p-3 text-center">
    <div className="text-xl font-black text-[var(--foreground)] tabular-nums">{value}</div>
    <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-[var(--accent-primary)]/70 md:text-white/60 uppercase tracking-wider font-semibold">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </div>
  </div>
);

const ListGroup = ({
  title,
  items,
  onItemClick,
}: {
  title: string;
  items: ListItem[];
  onItemClick: (key: ListKey) => void;
}) => (
  <div className="mb-4">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 px-1 hidden md:block">{title}</h3>
    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] px-4 py-3 md:hidden">{title}</div>
    <div className="metric-card overflow-hidden bg-[var(--card)] md:bg-card rounded-2xl md:rounded-xl border border-[var(--border)] md:border-border">
      {items.map((item, idx) => (
        <button
          key={item.key}
          onClick={() => onItemClick(item.key)}
          className={`w-full flex items-center gap-3 px-4 md:px-5 py-4 text-left transition-colors duration-150 active:bg-[var(--accent-primary)]/5 md:hover:bg-nebula-crimson/5 relative group ${
             idx < items.length - 1 ? 'border-b border-[var(--border)] md:border-gray-100' : ''
          }`}
        >
          <span className="absolute left-0 top-0 bottom-0 w-1 bg-nebula-crimson scale-y-0 group-hover:scale-y-100 transition-transform origin-top duration-300 hidden md:block" />
           <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--secondary)] md:bg-gray-50 flex-shrink-0 ${item.color}`}>
             <item.icon className="w-5 h-5 md:w-4 md:h-4 text-[var(--accent-primary)]/70 md:inherit" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--foreground)] md:text-gray-800 font-medium md:font-semibold flex items-center gap-2">
              {item.label}
              {item.badge && (
                 <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-primary)] md:bg-nebula-crimson text-white font-bold md:font-black">
                  {item.badge}
                </span>
              )}
            </div>
            {item.desc && <div className="text-xs text-[var(--muted-foreground)] md:text-gray-400 mt-0.5">{item.desc}</div>}
          </div>
          {item.right ?? <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)] md:text-gray-300 flex-shrink-0 md:group-hover:text-nebula-crimson transition-colors" />}
        </button>
      ))}
    </div>
  </div>
);

const ExpandPanel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-4 -mt-1 rounded-b-2xl border border-t-0 border-[var(--border)] md:border-gray-200 bg-[var(--background)] md:bg-gray-50/50 px-4 py-4 animate-in fade-in slide-in-from-top-2 duration-200">
    {children}
  </div>
);

const FavoritesList = ({
  items,
  loading,
  error,
  onNavigate,
  onRemove,
}: {
  items: string[];
  loading: boolean;
  error: string | null;
  onNavigate: (id: string) => void;
  onRemove: (e: React.MouseEvent, id: string) => void;
}) => {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-destructive mb-2">{error}</p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-6">
        <StarOff className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">暂无收藏</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {items.map((matchId) => (
        <div
          key={matchId}
          onClick={() => onNavigate(matchId)}
          className="group cursor-pointer rounded-lg border border-border/60 bg-card p-3 transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Star className="w-4 h-4 text-accent fill-accent flex-shrink-0" />
            <span className="text-sm font-medium text-foreground truncate font-mono">{matchId.slice(0, 8)}...</span>
          </div>
          <button
            onClick={(e) => onRemove(e, matchId)}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <StarOff className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
};

const FollowedTeamsList = ({
  items,
  loading,
  error,
  onRemove,
}: {
  items: string[];
  loading: boolean;
  error: string | null;
  onRemove: (name: string) => void;
}) => {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-destructive mb-2">{error}</p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-6">
        <HeartOff className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">暂无关注球队</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 max-h-60 overflow-y-auto">
      {items.map((teamName) => (
        <div key={teamName} className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted flex-shrink-0">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-sm text-foreground truncate">{teamName}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => onRemove(teamName)} className="text-xs h-7">
            <HeartOff className="w-3 h-3 mr-1" />
            取消
          </Button>
        </div>
      ))}
    </div>
  );
};

const RecordsList = ({
  items,
  loading,
  error,
  onRetry,
  onNavigate,
}: {
  items: PredictionRecordItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigate: (id: string, league?: string) => void;
}) => {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-6">
        <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">暂无记录</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 max-h-72 overflow-y-auto">
      {items.map((rec) => {
        const m = rec.match;
        const action = ACTION_LABELS[rec.actionType] ?? ACTION_LABELS.viewed;
        return (
          <div
            key={rec.id}
            onClick={() => onNavigate(m.id, m.league)}
            className="group flex cursor-pointer items-center justify-between rounded-lg border border-border/60 bg-card p-2.5 transition-all"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${action.className}`}>
                {action.label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {m.homeTeam} vs {m.awayTeam}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {formatTime(rec.viewedAt || rec.createdAt)} · {m.league}
                </div>
              </div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </div>
        );
      })}
    </div>
  );
};

const HitStatsPanel = ({
  loading,
  error,
  data,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  data: {
    totalMatches: number;
    winDrawWinHitRate: number;
    handicapHitRate: number;
    overUnderHitRate: number;
    byLeague: { league: string; count: number; hitRate: number }[];
  } | null;
  onRetry: () => void;
}) => {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">我的模型准确率</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border/60 bg-card p-3 animate-pulse">
              <div className="h-3 w-12 bg-muted rounded mb-2" />
              <div className="h-6 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
      </div>
    );
  }
  if (!data) return null;
  return (
     <div className="space-y-4">
       <div className="eyebrow eyebrow-line mb-1">PERFORMANCE</div>
       <h3 className="text-xl font-black tracking-tight text-foreground">我的模型准确率</h3>
       <div className="grid grid-cols-2 gap-3">
         <StatCard label="总场次" value={`${data.totalMatches}`} unit="场" icon={BarChart3} color="text-[var(--accent-primary)] md:text-nebula-crimson" />
         <StatCard label="赛果方向" value={`${data.winDrawWinHitRate.toFixed(1)}%`} icon={Target} color="text-[var(--accent-primary)] md:text-nebula-crimson" />
          <StatCard label="让分模型准确" value={`${data.handicapHitRate.toFixed(1)}%`} icon={TrendingUp} color="text-[var(--accent-primary)] md:text-nebula-crimson" />
         <StatCard label="进球数" value={`${data.overUnderHitRate.toFixed(1)}%`} icon={Trophy} color="text-[var(--accent-primary)] md:text-nebula-crimson" />
       </div>
       <div className="metric-card p-4">
         <h4 className="text-sm font-black text-foreground mb-3">联赛分布</h4>
         <div className="space-y-3">
          {data.byLeague.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-2">暂无联赛数据</p>
          ) : (
            data.byLeague.map((item) => (
              <div key={item.league} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-foreground">{item.league}</span>
                  <span className="text-muted-foreground">
                    <span className="font-mono">{item.count}场</span>
                    <span className="mx-1 text-muted-foreground/40">|</span>
                    <span className="font-mono text-home-win">{item.hitRate.toFixed(1)}%</span>
                  </span>
                </div>
                 <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                   <div className="h-full rounded-full progress-gradient transition-all duration-[1.5s] ease-out" style={{ width: `${item.hitRate}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ElementType;
  color: string;
}) => (
  <div className="metric-card p-4 bg-[var(--card)] md:bg-transparent rounded-xl md:rounded-none border border-[var(--border)] md:border-0">
    <div className="text-[10px] text-[var(--muted-foreground)] md:text-gray-400 uppercase tracking-wider font-medium">{label}</div>
    <div className="mt-2 flex items-baseline gap-1">
      <span className={`text-2xl font-black tabular-nums ${color}`}>{value}</span>
      {unit && <span className="text-[10px] text-[var(--muted-foreground)] md:text-gray-400">{unit}</span>}
    </div>
  </div>
);

export default ProfilePage;
