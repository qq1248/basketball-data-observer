import { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { syncApi } from '@client/src/api';
import type { SyncHealthResponse } from '@shared/api.interface';

interface DataStatusBarProps {
  refreshKey?: number;
}

export function DataStatusBar({ refreshKey }: DataStatusBarProps) {
  const [health, setHealth] = useState<SyncHealthResponse | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      const h = await syncApi.getSyncHealth();
      setHealth(h);
      setLastError(null);
    } catch {
      setLastError('更新失败');
    }
  };

  useEffect(() => {
    void fetchHealth();
    const timer = window.setInterval(() => {
      void fetchHealth();
    }, 90000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      void fetchHealth();
    }
  }, [refreshKey]);

  if (!health && !lastError) return null;

  const formatTime = (iso: string | null): string => {
    if (!iso) return '从未';
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  };

  const fbSuccess = health?.lastSync.football.success;
  const bbSuccess = health?.lastSync.basketball.success;
  const anyOk = fbSuccess || bbSuccess;
  const scoreUnavailable =
    health?.lastSync.score.success === false &&
    health?.lastSync.score.statusCode === 503;

  const espnFootballOk = health?.sources.espnFootball.success;
  const espnBbOk = health?.sources.espnBasketball.success;
  const oddsOk = health?.sources.oddsApi.enabled && health?.sources.oddsApi.success;
  const extOk = health?.sources.sportteryExternal.enabled && health?.sources.sportteryExternal.success;

  const espnLatest = health?.sources.espnFootball.lastSyncAt;

  const dataSourceLabel = !health
    ? '连接中'
    : espnFootballOk || espnBbOk
      ? 'ESPN实时'
      : anyOk
          ? '官方数据源同步中'
        : '暂无免费实时源';

  const statusText = !health
    ? '连接中'
    : !anyOk && !espnFootballOk && !espnBbOk
      ? '暂无免费实时源，当前为历史数据'
      : scoreUnavailable && !(espnFootballOk || espnBbOk)
        ? '赛程数据同步中 · 比分接口暂不可用'
        : '多源数据自动同步中';

  return (
    <div className="w-full bg-[hsl(214_24%_94%)] border-b border-[hsl(214_20%_88%)] px-4 py-1.5 text-xs text-[hsl(215_10%_45%)] flex items-center justify-between">
      <div className="flex items-center gap-2">
        {anyOk ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(142_71%_45%)]" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-[hsl(40_80%_57%)]" />
        )}
         <span className="truncate">
           {statusText}
           {espnLatest && ` · 更新于 ${formatTime(espnLatest)}`}
         </span>
       </div>
       <div className="flex items-center gap-2 flex-shrink-0">
         {health && (
           <span className="hidden sm:inline-flex items-center gap-1 text-[10px]">
             <span className={`w-1.5 h-1.5 rounded-full ${espnFootballOk || espnBbOk ? 'bg-[hsl(142_71%_45%)]' : 'bg-[hsl(40_80%_57%)]'}`} />
             ESPN
             {health.sources.oddsApi.enabled && (
               <>
                 <span className={`w-1.5 h-1.5 rounded-full ml-1 ${oddsOk ? 'bg-[hsl(142_71%_45%)]' : 'bg-[hsl(40_80%_57%)]'}`} />
                 指数
               </>
             )}
             {health.sources.sportteryExternal.enabled && (
               <>
                 <span className={`w-1.5 h-1.5 rounded-full ml-1 ${extOk ? 'bg-[hsl(142_71%_45%)]' : 'bg-[hsl(40_80%_57%)]'}`} />
                 官方
               </>
             )}
           </span>
         )}
         <span className="text-[11px] flex items-center gap-1">
           <RefreshCw
             className={`w-3 h-3 ${anyOk || espnFootballOk || espnBbOk ? 'text-[hsl(142_71%_45%)]' : 'text-[hsl(40_80%_57%)]'}`}
           />
           {lastError ? lastError : health?.schedulerRunning ? `${dataSourceLabel}` : '已停止'}
         </span>
       </div>
    </div>
  );
}
