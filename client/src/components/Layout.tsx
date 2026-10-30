import { Outlet, NavLink } from 'react-router-dom';
import {
  Users,
  BarChart3,
  User,
  BookOpen,
  Settings,
  Trophy as TrophyIcon,
  Calendar,
  Search,
  TrendingUp,
  Sparkles,
  FileText,
} from 'lucide-react';
import { useVersionCheck } from '@client/src/hooks/useVersionCheck';
import VersionBanner from '@client/src/components/VersionBanner';
import PWAPrompt from '@client/src/components/PWAPrompt';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { onLiveCountChange } from '@client/src/utils/live-count';

const BOTTOM_TABS = [
  { to: '/basketball/schedule', label: '赛程', icon: Calendar, end: false },
  { to: '/basketball/stats', label: '统计', icon: BarChart3, end: false },
  { to: '/basketball', label: '今日', icon: TrophyIcon, end: false, center: true },
  { to: '/', label: '足球', icon: TrophyIcon, end: true },
  { to: '/profile', label: '我的', icon: User, end: false },
];

const TOP_NAV_ITEMS = [
  { to: '/brand', label: '品牌首页', end: false },
  { to: '/', label: '足球数据', end: true },
  { to: '/basketball', label: '篮球数据', end: false },
  { to: '/beidan', label: '更多赛事', end: false },
  { to: '/stats/football', label: '数据统计', end: false },
   { to: '/performance/football', label: '模型表现', end: false },
   { to: '/basketball/review', label: '每日复盘', end: false },
   { to: '/teams', label: '球队档案', end: false },
  { to: '/rules', label: '模型规则', end: false },
];

const MOBILE_MENU_ITEMS = [
  { to: '/brand', label: '品牌首页', icon: Sparkles },
  { to: '/', label: '足球数据', icon: TrophyIcon },
  { to: '/basketball', label: '篮球数据', icon: TrophyIcon },
  { to: '/basketball/schedule', label: '篮球赛程', icon: Calendar },
  { to: '/basketball/stats', label: '篮球统计', icon: BarChart3 },
  { to: '/beidan', label: '更多赛事', icon: Calendar },
  { to: '/stats/football', label: '数据统计', icon: BarChart3 },
   { to: '/performance/football', label: '模型表现', icon: TrendingUp },
   { to: '/basketball/review', label: '每日复盘', icon: FileText },
   { to: '/teams', label: '球队档案', icon: Users },
  { to: '/rules', label: '模型规则', icon: BookOpen },
  { to: '/profile', label: '个人中心', icon: User },
];

const SITE_TITLE = '观察体育';

const Layout = () => {
  const { hasNewVersion, newVersion, dismiss, applyUpdate } = useVersionCheck();
  const syncStore = useSyncStore();
  const isAdmin = syncStore.user?.role === 'admin';
  const authLoading = syncStore.authLoading;
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [liveCount, setLiveCountState] = useState(0);

  useEffect(() => {
    return onLiveCountChange((count) => setLiveCountState(count));
  }, []);

  useEffect(() => {
    document.title = SITE_TITLE;
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const checkMobileArena = () => {
      if (window.innerWidth < 768) {
        document.documentElement.setAttribute('data-mobile-arena', 'true');
      } else {
        document.documentElement.removeAttribute('data-mobile-arena');
      }
    };
    checkMobileArena();
    window.addEventListener('resize', checkMobileArena);
    return () => window.removeEventListener('resize', checkMobileArena);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <VersionBanner
        visible={hasNewVersion}
        newVersion={newVersion}
        onApply={applyUpdate}
        onDismiss={dismiss}
      />

      <header
        className={`sticky top-0 z-50 bg-[var(--background)]/95 backdrop-blur-xl border-b border-[var(--border)] transition-all duration-300 md:bg-white/90 md:backdrop-blur-md ${
          scrolled
            ? 'shadow-lg shadow-black/40 md:shadow-sm md:border-border/60'
            : 'md:border-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-12 md:h-16 flex items-center justify-between">
          <button
            onClick={() => navigate('/basketball')}
            className="flex items-center gap-2"
          >
            <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)]/15 flex items-center justify-center md:w-9 md:h-9 md:rounded-xl md:bg-nebula-crimson md:shadow-md md:shadow-nebula-crimson/20">
              <TrophyIcon className="w-5 h-5 text-[var(--accent-primary)] md:w-5 md:h-5 md:text-white" />
            </div>
            <span className="text-sm font-black tracking-tighter text-[var(--accent-primary)] md:text-base md:text-nebula-crimson">
              观察体育
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {TOP_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all ${
                    isActive
                      ? 'text-nebula-crimson bg-nebula-crimson/5'
                      : 'text-muted-foreground hover:text-foreground hover:bg-gray-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1 md:gap-2">
            {isAdmin && (
              <Link
                to="/admin"
                className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-nebula-crimson hover:bg-nebula-crimson/5 transition-colors"
                aria-label="后台管理"
              >
                <Settings className="w-4 h-4" />
              </Link>
            )}
            {authLoading && !isAdmin && (
              <div className="hidden md:block w-8 h-8 rounded-lg bg-muted/40 animate-pulse" />
            )}
            <Link
              to="/profile"
              className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-nebula-crimson hover:bg-nebula-crimson/5 transition-colors"
              aria-label="个人中心"
            >
              <User className="w-4 h-4" />
            </Link>

            <button
              onClick={() => navigate('/basketball')}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-[var(--accent-primary)]/60 hover:text-[var(--accent-primary)] transition-colors"
              aria-label="搜索"
            >
              <Search className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0">
          <main className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom)+16px)] md:pb-6">
          <PWAPrompt />
          <div className="max-w-full px-0 md:max-w-7xl md:mx-auto md:px-6">
            <Outlet />
          </div>

          <footer className="px-4 py-4 text-center border-t border-[var(--border)] md:hidden">
             <p className="text-xs text-[var(--accent-primary)]/70 font-semibold leading-relaxed mb-1">
              ⚠ 数据仅供参考，不构成任何投注建议
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
              理性观赛，健康生活。仅限数据研究与学习交流使用。
            </p>
          </footer>
        </main>

        <footer className="hidden md:block px-6 py-5 text-center border-t border-border">
          <p className="text-xs text-nebula-crimson/80 font-semibold leading-relaxed mb-1">
            ⚠ 数据仅供参考，不构成任何投注建议
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            观察体育 · 理性观赛 · 健康生活 · 仅限数据研究与学习交流使用
          </p>
        </footer>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--background)]/95 backdrop-blur-xl border-t border-[var(--border)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5 h-16 relative">
          {BOTTOM_TABS.map((item) => {
            const Icon = item.icon;
            if (item.center) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  replace
                  className="relative flex flex-col items-center justify-center w-full h-full"
                >
                  {({ isActive }) => (
                    <>
                      <div
                        className={`absolute -top-5 w-14 h-14 rounded-full bg-gradient-to-b from-[var(--accent-primary)] to-[var(--accent-primary-dark)] flex items-center justify-center shadow-lg transition-all duration-200 ease-out ${
                          isActive ? 'scale-105' : 'opacity-90 scale-100'
                        }`}
                        style={{
                          boxShadow: `0 8px 24px -4px var(--accent-glow), 0 0 0 4px var(--background)`,
                        }}
                      >
                        <Icon className="w-6 h-6 text-white" strokeWidth={2} fill="none" />
                        {liveCount > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#E11D48] text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none border-2 border-[var(--background)]">
                            {liveCount > 99 ? '99+' : liveCount}
                          </span>
                        )}
                      </div>
                      <span
                        className={`absolute bottom-1.5 text-[10px] font-medium whitespace-nowrap leading-tight transition-colors duration-200 ${
                          isActive ? 'text-[var(--accent-primary)]' : 'text-[var(--muted-foreground)]'
                        }`}
                      >
                        {item.label}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                replace
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-1 w-full h-full transition-all duration-200 ease-out ${
                    isActive ? 'text-[var(--accent-primary)]' : 'text-[var(--muted-foreground)]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`w-[22px] h-[22px] transition-all duration-200 ease-out ${
                        isActive ? '-translate-y-0.5' : ''
                      }`}
                      strokeWidth={1.8}
                    />
                    <span className="text-[10px] font-medium whitespace-nowrap leading-tight">
                      {item.label}
                    </span>
                    <span
                      className={`absolute bottom-1 w-4 h-0.5 rounded-full bg-[var(--accent-primary)] transition-all duration-200 ease-out ${
                        isActive ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
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

export default Layout;
