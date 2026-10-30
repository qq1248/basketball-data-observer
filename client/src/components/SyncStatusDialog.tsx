import { useState, useEffect } from 'react';
import { Activity, Wifi, Clock, Database, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { syncApi } from '@client/src/api';
import type { SyncHealthResponse } from '@shared/api.interface';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';

interface SyncStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SourceStatus({
  label,
  enabled,
  success,
  lastSyncAt,
  extraInfo,
}: {
  label: string;
  enabled: boolean;
  success: boolean;
  lastSyncAt: string | null;
  extraInfo?: string;
}) {
  if (!enabled) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
        <XCircle className="w-3.5 h-3.5" />
        <span>{label}（未启用）</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      {success ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-home-win flex-shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {lastSyncAt ? `最近同步 ${formatBeijingTime(lastSyncAt, 'datetime')}` : '暂无同步记录'}
          {extraInfo && ` · ${extraInfo}`}
        </div>
      </div>
    </div>
  );
}

export function SyncStatusDialog({ open, onOpenChange }: SyncStatusDialogProps) {
  const [health, setHealth] = useState<SyncHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await syncApi.getSyncHealth();
      setHealth(data);
    } catch {
      setError('获取同步状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchStatus();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="w-5 h-5 text-primary" />
            数据同步状态
          </DialogTitle>
        </DialogHeader>

        {loading && !health && (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <div className="inline-block w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-2" />
            <div>加载中...</div>
          </div>
        )}

        {error && !health && (
          <div className="text-center py-8 text-xs text-destructive">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
            <div>{error}</div>
          </div>
        )}

        {health && (
          <div className="space-y-4">
            {/* 调度器状态 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">调度器状态</h3>
              </div>
              <div className="flex items-center gap-2">
                {health.schedulerRunning ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-home-win opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-home-win" />
                    </span>
                    <span className="text-sm font-medium text-home-win">运行中</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">已停止</span>
                  </>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                   {health.source === 'hybrid' ? '混合模式' : health.source === 'external' ? '外部源' : '官方直连'}
                </span>
              </div>
            </div>

            {/* 数据源 — 足球 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">足球数据源</h3>
              </div>
              <div className="space-y-3">
                <SourceStatus
                  label="ESPN 足球（实时节奏）"
                  enabled={health.sources.espnFootball.enabled}
                  success={health.sources.espnFootball.success}
                  lastSyncAt={health.sources.espnFootball.lastSyncAt}
                  extraInfo={`${health.sources.espnFootball.leaguesSynced}个联赛 · ${health.sources.espnFootball.rhythm === 'live' ? '直播节奏' : health.sources.espnFootball.rhythm === 'upcoming' ? '赛前节奏' : '空闲'}`}
                />
                <SourceStatus
                  label="OddsAPI 指数"
                  enabled={health.sources.oddsApi.enabled}
                  success={health.sources.oddsApi.success}
                  lastSyncAt={health.sources.oddsApi.lastSyncAt}
                  extraInfo={
                    health.sources.oddsApi.remaining !== null
                      ? `剩余配额 ${health.sources.oddsApi.remaining}`
                      : health.sources.oddsApi.quotaThrottled
                        ? '配额限流中'
                        : `${health.sources.oddsApi.sportsSynced}个运动`
                  }
                />
                <SourceStatus
                   label="官方数据源直连"
                  enabled={health.sources.sportteryExternal.enabled}
                  success={health.sources.sportteryExternal.success}
                  lastSyncAt={health.sources.sportteryExternal.lastSyncAt}
                  extraInfo={
                    health.sources.sportteryExternal.directStatus === 'auto'
                      ? '自动模式'
                      : health.sources.sportteryExternal.directStatus === 'degraded'
                        ? '降级模式'
                        : '连接失败'
                  }
                />
              </div>
              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">足球总数</span>
                <span className="font-mono font-semibold text-foreground">{health.footballCount} 场</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">最后同步</span>
                <span className="font-mono text-foreground/80">
                  {health.lastSync.football.at
                    ? formatBeijingTime(health.lastSync.football.at, 'datetime')
                    : '从未'}
                  {health.lastSync.football.success
                    ? ' ✓'
                    : health.lastSync.football.statusCode
                      ? ` (${health.lastSync.football.statusCode})`
                      : ' ✗'}
                </span>
              </div>
            </div>

            {/* 数据源 — 篮球 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="w-4 h-4 text-basketball-orange" />
                <h3 className="text-sm font-semibold text-foreground">篮球数据源</h3>
              </div>
              <div className="space-y-3">
                <SourceStatus
                  label="ESPN 篮球（实时节奏）"
                  enabled={health.sources.espnBasketball.enabled}
                  success={health.sources.espnBasketball.success}
                  lastSyncAt={health.sources.espnBasketball.lastSyncAt}
                  extraInfo={`${health.sources.espnBasketball.leaguesSynced}个联赛 · ${health.sources.espnBasketball.rhythm === 'live' ? '直播节奏' : health.sources.espnBasketball.rhythm === 'upcoming' ? '赛前节奏' : '空闲'}`}
                />
                 <SourceStatus
                   label="OddsAPI 指数"
                   enabled={health.sources.oddsApi.enabled}
                   success={health.sources.oddsApi.success}
                   lastSyncAt={health.sources.oddsApi.lastSyncAt}
                   extraInfo={
                     health.sources.oddsApi.remaining !== null
                       ? `剩余配额 ${health.sources.oddsApi.remaining}`
                       : health.sources.oddsApi.quotaThrottled
                         ? '配额限流中'
                         : '指数同步中'
                   }
                 />
                 <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-muted/30 border border-dashed border-border">
                   <div className="flex items-center gap-2">
                     <span className="w-2 h-2 rounded-full bg-gray-300" />
                     <span className="text-muted-foreground">欧篮联 / 西篮联</span>
                   </div>
                   <span className="text-gray-400">待接入</span>
                 </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">篮球总数</span>
                <span className="font-mono font-semibold text-foreground">{health.basketballCount} 场</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">最后同步</span>
                <span className="font-mono text-foreground/80">
                  {health.lastSync.basketball.at
                    ? formatBeijingTime(health.lastSync.basketball.at, 'datetime')
                    : '从未'}
                  {health.lastSync.basketball.success
                    ? ' ✓'
                    : health.lastSync.basketball.statusCode
                      ? ` (${health.lastSync.basketball.statusCode})`
                      : ' ✗'}
                </span>
              </div>
            </div>

            {/* 比分同步 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">实时比分</h3>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">最后同步</span>
                <span className="font-mono text-foreground/80">
                  {health.lastSync.score.at
                    ? formatBeijingTime(health.lastSync.score.at, 'datetime')
                    : '从未'}
                  {health.lastSync.score.success
                    ? ' ✓'
                    : health.lastSync.score.statusCode === 503
                      ? ' (503 暂不可用)'
                      : health.lastSync.score.statusCode
                        ? ` (${health.lastSync.score.statusCode})`
                        : ' ✗'}
                </span>
              </div>
            </div>

            {/* 今日分布 */}
            {health.adaptive && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">今日赛事分布</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="text-center p-2 rounded-lg bg-muted/30">
                    <div className="text-muted-foreground mb-1">足球</div>
                    <div className="font-mono">
                      <span className="text-accent font-semibold">{health.adaptive.todayFbLiveCount}</span>
                      <span className="text-muted-foreground/60"> 直播 / </span>
                      <span className="text-foreground">{health.adaptive.todayFbUpcomingCount}</span>
                      <span className="text-muted-foreground/60"> 未赛 / </span>
                      <span className="text-home-win">{health.adaptive.todayFbFinishedCount}</span>
                      <span className="text-muted-foreground/60"> 完赛</span>
                    </div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/30">
                    <div className="text-muted-foreground mb-1">篮球</div>
                    <div className="font-mono">
                      <span className="text-accent font-semibold">{health.adaptive.todayBbLiveCount}</span>
                      <span className="text-muted-foreground/60"> 直播 / </span>
                      <span className="text-foreground">{health.adaptive.todayBbUpcomingCount}</span>
                      <span className="text-muted-foreground/60"> 未赛 / </span>
                      <span className="text-home-win">{health.adaptive.todayBbFinishedCount}</span>
                      <span className="text-muted-foreground/60"> 完赛</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground/60 text-center">
             数据仅供参考，不构成任何决策建议
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
