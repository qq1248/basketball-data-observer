import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import { SyncStatusDialog } from '@client/src/components/SyncStatusDialog';

interface LiveStatusBarProps {
  lastUpdateIso: string;
  refreshInterval: number;
  onRefresh: () => void;
  label?: string;
  syncError?: boolean;
}

export function LiveStatusBar({ lastUpdateIso, refreshInterval, onRefresh, label = '多源数据自动同步中 · 更新于', syncError = false }: LiveStatusBarProps) {
  const syncStore = useSyncStore();
  const isLoggedIn = !!syncStore.user;
  const [countdown, setCountdown] = useState<number>(refreshInterval);
  const [spinning, setSpinning] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUpdateRef = useRef<string>(lastUpdateIso);
  const displayLabel = syncError ? '同步失败 · 重试中 · 更新于' : label;
  const displayTime = formatBeijingTime(lastUpdateIso, 'time-seconds');

  // Reset countdown when interval or lastUpdateIso changes
  useEffect(() => {
    setCountdown(refreshInterval);
  }, [refreshInterval]);

  useEffect(() => {
    if (lastUpdateIso !== lastUpdateRef.current) {
      lastUpdateRef.current = lastUpdateIso;
      setCountdown(refreshInterval);
    }
  }, [lastUpdateIso, refreshInterval]);

  // Countdown timer: decrements every 1s, triggers refresh when hits 0
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onRefresh();
          return refreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
    timerRef.current = timer;
    return () => {
      clearInterval(timer);
      timerRef.current = null;
    };
  }, [refreshInterval, onRefresh]);

  // Manual refresh with visual feedback
  const [buttonState, setButtonState] = useState<'idle' | 'loading' | 'success'>('idle');
  const successTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const wrappedRefresh = useCallback(() => {
    if (buttonState === 'loading') return;
    setButtonState('loading');
    setSpinning(true);
    setCountdown(refreshInterval);
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    Promise.resolve(onRefresh())
      .then(() => {
        setButtonState('success');
        setSpinning(false);
        idleTimerRef.current = window.setTimeout(() => {
          setButtonState('idle');
        }, 1500);
      })
      .catch(() => {
        setButtonState('idle');
        setSpinning(false);
      });
  }, [onRefresh, refreshInterval, buttonState]);

  // Calculate staleness based on ISO timestamp
  const getStaleness = (): 'fresh' | 'warn' | 'stale' => {
    try {
      const now = new Date();
      const updateDate = new Date(lastUpdateIso);
      const diffMin = (now.getTime() - updateDate.getTime()) / 60000;
      if (diffMin > 5) return 'stale';
      if (diffMin > 2) return 'warn';
      return 'fresh';
    } catch {
      return 'fresh';
    }
  };

  const staleness = getStaleness();
  const dotColor =
    staleness === 'fresh'
      ? 'bg-home-win'
      : staleness === 'warn'
        ? 'bg-accent'
        : 'bg-destructive';

  const progressPct = Math.max(0, Math.min(100, ((refreshInterval - countdown) / refreshInterval) * 100));

  return (
    <>
      <div className="w-full bg-card/60 border-b border-border px-3 md:px-4 py-2 text-xs">
        <div className="flex items-center gap-2 md:gap-3 justify-between">
          {/* Left: update time + status dot */}
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 flex-shrink-0 hover:opacity-80 transition-opacity min-w-0"
            title="点击查看同步状态"
          >
            <span
              className={`relative flex h-2 w-2 flex-shrink-0 ${staleness === 'fresh' ? '' : ''}`}
            >
              {staleness === 'fresh' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-home-win opacity-60" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
            </span>
             <span className={`font-mono whitespace-nowrap truncate ${syncError ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                {displayLabel} {displayTime}
              </span>
          </button>

          {/* Middle + Right: countdown + refresh button */}
          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            {/* Auto refresh progress (md+ only) */}
            <div className="hidden md:flex items-center gap-2">
              <span className="text-muted-foreground/80 whitespace-nowrap">自动刷新</span>
              <div className="relative w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-primary/40 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <span className="font-mono text-foreground/70 whitespace-nowrap text-right">
              {countdown}s后
            </span>

            {/* Right: refresh button */}
            {isLoggedIn ? (
              <button
                onClick={wrappedRefresh}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-muted transition-colors flex-shrink-0 text-xs font-medium text-foreground/80 hover:text-foreground border border-border/60"
                aria-label="立即刷新"
                title="立即刷新"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}
                />
                <span className="hidden sm:inline">
                  {buttonState === 'loading' ? '刷新中...' : buttonState === 'success' ? '已更新' : '立即刷新'}
                </span>
                <span className="sm:hidden">刷新</span>
              </button>
            ) : (
              <span className="text-xs text-muted-foreground flex-shrink-0 px-2 py-1 hidden sm:inline">
                登录后可刷新
              </span>
            )}
          </div>
        </div>
      </div>
      <SyncStatusDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
