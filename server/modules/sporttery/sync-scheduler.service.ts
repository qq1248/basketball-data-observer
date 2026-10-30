import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject } from '@nestjs/common';
import { syncTaskLogs, basketballMatches, matches } from '@server/database/schema';
import { desc, eq, sql, and, inArray, isNotNull, gt } from 'drizzle-orm';
import { SportteryService } from './sporttery.service';
import { SinaInjuryService } from './sina-injury.service';
import { BasketballDataDrivenPredictionService } from '../basketball-prediction/basketball-data-driven.service';
import { EloHistoryService } from '../elo/elo-history.service';
import { BasketballIntelService, type IntelData, parseIntelFromRow } from '../basketball/basketball-intel.service';
import { BasketballAutoCheckService } from '../basketball/basketball-auto-check.service';
import { FootballAutoCheckService } from './football-auto-check.service';

const SHANGHAI_TZ = 'Asia/Shanghai';

type TaskStatus = 'running' | 'success' | 'failed' | 'degraded';

interface TaskLatestStatus {
  taskName: string;
  description: string;
  cron: string;
  lastRunAt: string | null;
  lastStatus: TaskStatus | 'pending' | null;
  lastErrorMessage: string | null;
  lastRecordsUpdated: number;
  nextRunAt: string | null;
}

interface TaskDetails {
  footballUpdated?: number;
  basketballUpdated?: number;
  hitBackfilled?: number;
  reviewsGenerated?: number;
  leaguesCount?: number;
  dataSource?: string;
}

const TASK_DEFS: { name: string; description: string; cron: string; timeoutMs: number }[] = [
  { name: 'daily_full_sync', description: '每日全量数据更新（赛程+盘口+预测）', cron: '09:30 每日', timeoutMs: 2 * 60 * 60 * 1000 },
  { name: 'hit_backfill', description: '赛果回填（命中标记）', cron: '每30分钟', timeoutMs: 30 * 60 * 1000 },
  { name: 'odds_intel_update', description: '盘口变化 + 全维度情报更新', cron: '16:00 每日', timeoutMs: 60 * 60 * 1000 },
  { name: 'on_sale_capture', description: '开售即抓即预测', cron: '整点+7分 每小时', timeoutMs: 30 * 60 * 1000 },
  { name: 'base_sync', description: '基础同步（6小时）', cron: '每6小时', timeoutMs: 2 * 60 * 60 * 1000 },
  { name: 'daily_review', description: '每日赛果复盘', cron: '22:00 每日', timeoutMs: 60 * 60 * 1000 },
  { name: 'ghost_cleanup', description: '幽灵场次清理（过期business_date残留）', cron: '10:00 每日', timeoutMs: 30 * 60 * 1000 },
  { name: 'euroleague_injury_update', description: '欧篮联伤停报告更新', cron: '每日 08:00/14:00/20:00', timeoutMs: 30 * 60 * 1000 },
];

@Injectable()
export class SyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private isRunning = new Map<string, boolean>();
  private taskEnabled = new Map<string, boolean>();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private nextRunAt = new Map<string, Date>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sportteryService: SportteryService,
    private readonly sinaInjuryService: SinaInjuryService,
    private readonly dataDrivenService: BasketballDataDrivenPredictionService,
    private readonly eloHistoryService: EloHistoryService,
    private readonly autoCheckService: BasketballAutoCheckService,
    private readonly footballAutoCheckService: FootballAutoCheckService,
  ) {
    for (const t of TASK_DEFS) {
      this.isRunning.set(t.name, false);
      this.taskEnabled.set(t.name, true);
    }
  }

  onModuleInit(): void {
    this.logger.log(
      'Sync scheduler initialized as fallback (idempotent skip when platform cron ran in same period)',
    );
    void this.cleanupHungTasks('startup');
    this.scheduleAll();
    void this.sportteryService.runStartupInjuryBackfill();
  }

  private scheduleAll(): void {
    this.scheduleDaily('daily_full_sync', 9, 30);
    this.scheduleDaily('daily_review', 22, 0);
    this.scheduleDaily('ghost_cleanup', 10, 0);
    this.scheduleDaily('odds_intel_update', 16, 0);
    this.scheduleEveryThirtyMinutes('hit_backfill');
    this.scheduleEverySixHours('base_sync');
    this.scheduleHourlyAt7('on_sale_capture');
    this.schedulePreGameInjuryRefresh();
    this.scheduleEuroLeagueInjuryUpdate();
  }

  private setNextRun(taskName: string, date: Date): void {
    this.nextRunAt.set(taskName, date);
  }

  private scheduleDaily(taskName: string, hour: number, minute: number): void {
    const next = this.getNextDailyRun(hour, minute);
    this.setNextRun(taskName, next);
    const delay = next.getTime() - Date.now();
    this.logger.log(`${taskName} next run: ${next.toISOString()} (${Math.round(delay / 60000)} min)`);
    const timer = setTimeout(() => {
      void this.runTask(taskName, 'cron');
      this.scheduleDaily(taskName, hour, minute);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(taskName, timer);
  }

  private scheduleEveryThirtyMinutes(taskName: string): void {
    const now = new Date();
    const next = new Date(now);
    const curMin = next.getMinutes();
    const nextMin = curMin < 30 ? 30 : 60;
    next.setMinutes(nextMin, 0, 0);
    if (nextMin === 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(0);
    }
    this.setNextRun(taskName, next);
    const delay = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      void this.runTask(taskName, 'cron');
      this.scheduleEveryThirtyMinutes(taskName);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(taskName, timer);
  }

  private scheduleEuroLeagueInjuryUpdate(): void {
    const taskName = 'euroleague_injury_update';
    const slots = [8, 14, 20];
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SHANGHAI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string): string => {
      const p = parts.find((x) => x.type === type);
      return p?.value ?? '00';
    };
    const shYear = Number(get('year'));
    const shMonth = Number(get('month')) - 1;
    const shDay = Number(get('day'));
    const shHour = Number(get('hour'));
    const shMin = Number(get('minute'));
    const shSec = Number(get('second'));
    const nowShanghai = new Date(shYear, shMonth, shDay, shHour, shMin, shSec, 0);

    let next: Date | undefined;
    for (const h of slots) {
      const candidate = new Date(shYear, shMonth, shDay, h, 0, 0, 0);
      if (candidate > nowShanghai) {
        next = candidate;
        break;
      }
    }
    if (!next) {
      next = new Date(shYear, shMonth, shDay + 1, slots[0], 0, 0, 0);
    }

    this.setNextRun(taskName, next);
    const delay = next.getTime() - now.getTime();
    this.logger.log(`${taskName} next run: ${next.toISOString()} (${Math.round(delay / 60000)} min)`);
    const timer = setTimeout(() => {
      void this.runTask(taskName, 'cron');
      this.scheduleEuroLeagueInjuryUpdate();
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(taskName, timer);
  }

  private schedulePreGameInjuryRefresh(): void {
    const run = (): void => {
      void this.executePreGameInjuryRefresh().catch((err: unknown) => {
        this.logger.warn(`pre-game injury refresh failed: ${this.errorMessage(err)}`);
      });
    };
    run();
    const timer = setInterval(run, 10 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    this.logger.log('Pre-game injury refresh scheduled: every 10 min for matches within 60min of kickoff');
  }

  private async executeEuroLeagueInjuryUpdate(): Promise<{ updated: number; source: string }> {
    try {
      const result = await (this.sportteryService as unknown as {
        updateEuroLeagueInjuries: () => Promise<{ updated: number; failed: number }>;
      }).updateEuroLeagueInjuries();
      return { updated: result.updated, source: 'euroleague-official' };
    } catch (err) {
      this.logger.warn(`EuroLeague injury update failed: ${this.errorMessage(err)}`);
      return { updated: 0, source: 'euroleague-official' };
    }
  }

  private async executePreGameInjuryRefresh(): Promise<void> {
    try {
      const result = await (this.sportteryService as unknown as {
        refreshPreGameInjuries: (windowMinutes: number) => Promise<{ updated: number; failed: number; skipped: number }>;
      }).refreshPreGameInjuries(60);
      if (result.updated > 0) {
        this.logger.log(`[pregame-injury] ${result.updated} matches refreshed, triggering recalc`);
        void this.recalcBasketballPredictions('pregame_injury_refresh');
      }
    } catch (err) {
      this.logger.warn(`[pregame-injury] refresh failed: ${this.errorMessage(err)}`);
    }
  }

  private scheduleEverySixHours(taskName: string): void {
    const now = new Date();
    const next = new Date(now);
    const curHour = next.getHours();
    const slots = [0, 6, 12, 18];
    let nextHour = slots.find((h) => h > curHour);
    if (nextHour === undefined) {
      nextHour = slots[0];
      next.setDate(next.getDate() + 1);
    }
    next.setHours(nextHour, 0, 0, 0);
    this.setNextRun(taskName, next);
    const delay = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      void this.runTask(taskName, 'cron');
      this.scheduleEverySixHours(taskName);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(taskName, timer);
  }

  private scheduleHourlyAt7(taskName: string): void {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(7, 0, 0);
    if (next <= now) {
      next.setHours(next.getHours() + 1);
    }
    this.setNextRun(taskName, next);
    const delay = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      void this.runTask(taskName, 'cron');
      this.scheduleHourlyAt7(taskName);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(taskName, timer);
  }

  private getNextDailyRun(hour: number, minute: number): Date {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SHANGHAI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string): string => {
      const p = parts.find((x) => x.type === type);
      return p?.value ?? '00';
    };
    const shYear = Number(get('year'));
    const shMonth = Number(get('month')) - 1;
    const shDay = Number(get('day'));
    const shHour = Number(get('hour'));
    const shMin = Number(get('minute'));
    const shSec = Number(get('second'));

    const todayTarget = new Date(shYear, shMonth, shDay, hour, minute, 0, 0);
    const nowShanghai = new Date(shYear, shMonth, shDay, shHour, shMin, shSec, 0);

    if (nowShanghai < todayTarget) {
      return todayTarget;
    }
    return new Date(shYear, shMonth, shDay + 1, hour, minute, 0, 0);
  }

  private platformToTaskNameMap: Record<string, string> = {
    daily_wnba_full_sync: 'daily_full_sync',
    hourly_onsale_capture: 'on_sale_capture',
    daily_review: 'daily_review',
  };

  private async shouldSkipDueToPlatform(taskName: string): Promise<boolean> {
    const now = new Date();
    let lookbackMs = 60 * 60 * 1000;
    if (taskName === 'daily_full_sync' || taskName === 'daily_review') {
      lookbackMs = 24 * 60 * 60 * 1000;
    } else if (taskName === 'base_sync') {
      lookbackMs = 6 * 60 * 60 * 1000;
    } else if (taskName === 'hit_backfill') {
      lookbackMs = 30 * 60 * 1000;
    }
    const since = new Date(now.getTime() - lookbackMs);

    const platformTriggers = Object.entries(this.platformToTaskNameMap)
      .filter(([, t]) => t === taskName)
      .map(([p]) => p);

    if (platformTriggers.length === 0) return false;

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(syncTaskLogs)
      .where(
        sql`${syncTaskLogs.taskName} in (${sql.join(platformTriggers.map(t => sql`${t}`), sql`, `)})
          AND ${syncTaskLogs.trigger} = ${'platform-cron'}
          AND ${syncTaskLogs.status} = ${'success'}
          AND ${syncTaskLogs.startedAt} >= ${since.toISOString()}`,
      );

    const count = Number(result[0]?.count ?? 0);
    if (count > 0) {
      this.logger.log(
        `[IdempotentSkip] ${taskName}: platform-cron already ran successfully within the current period, skipping fallback`,
      );
      return true;
    }
    return false;
  }

  async runTask(taskName: string, trigger: 'cron' | 'manual' = 'manual'): Promise<{ ok: boolean; message: string }> {
    if (trigger === 'cron' && !this.taskEnabled.get(taskName)) {
      this.logger.log(`[TaskDisabled] ${taskName} is disabled, skipping`);
      return { ok: true, message: `${taskName} is disabled, skipped` };
    }

    const [existingRunning] = await this.db
      .select({
        id: syncTaskLogs.id,
        startedAt: syncTaskLogs.startedAt,
      })
      .from(syncTaskLogs)
      .where(sql`${syncTaskLogs.taskName} = ${taskName} AND ${syncTaskLogs.status} = 'running'`)
      .limit(1);

    if (existingRunning) {
      const def = TASK_DEFS.find((t) => t.name === taskName);
      const timeoutMs = def?.timeoutMs ?? 2 * 60 * 60 * 1000;
      const runningMs = Date.now() - new Date(existingRunning.startedAt).getTime();

      if (runningMs > timeoutMs) {
        this.logger.warn(
          `[Watchdog] ${taskName} running=${Math.round(runningMs / 60000)}min > ${Math.round(timeoutMs / 60000)}min, terminating hung task id=${existingRunning.id}`,
        );
        await this.terminateRunningTask(existingRunning.id, 'watchdog timeout');
      } else {
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
          await tx.insert(syncTaskLogs).values({
            taskName,
            taskType: 'scheduled',
            trigger,
            status: 'skipped',
            startedAt: new Date(),
            finishedAt: new Date(),
            errorMessage: `skipped: another ${taskName} is already running (id=${existingRunning.id})`,
          });
        });
        return { ok: false, message: `${taskName} is already running, skipped` };
      }
    }

    if (trigger === 'cron') {
      const shouldSkip = await this.shouldSkipDueToPlatform(taskName);
      if (shouldSkip) {
        return { ok: true, message: `${taskName} skipped: platform-cron already ran this period` };
      }
    }

    this.isRunning.set(taskName, true);
    const startedAt = new Date();

    let logId: string | undefined;
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
        const [inserted] = await tx.insert(syncTaskLogs).values({
          taskName,
          taskType: 'scheduled',
          trigger,
          status: 'running',
          startedAt,
        }).returning({ id: syncTaskLogs.id });
        logId = inserted?.id;
      });

      let status: TaskStatus = 'success';
      let recordsUpdated = 0;
      let dataSource = '';
      const details: TaskDetails = {};

      try {
        switch (taskName) {
          case 'daily_full_sync': {
            const { fbUpdated, bbUpdated, source } = await this.executeFullSync();
            recordsUpdated = fbUpdated + bbUpdated;
            dataSource = source;
            details.footballUpdated = fbUpdated;
            details.basketballUpdated = bbUpdated;
            details.dataSource = source;
            void this.recalcBasketballPredictions('daily_full_sync');
            break;
          }
          case 'hit_backfill': {
            const { fbHit, bbHit } = await this.executeHitBackfill();
            recordsUpdated = fbHit + bbHit;
            details.hitBackfilled = fbHit + bbHit;
            dataSource = 'espn+qiumibao';
            break;
          }
          case 'odds_intel_update': {
            const { updated, source } = await this.executeOddsIntelUpdate();
            recordsUpdated = updated;
            dataSource = source;
            details.dataSource = source;
            void this.recalcBasketballPredictions('odds_intel_update');
            break;
          }
          case 'on_sale_capture': {
            const { updated, source } = await this.executeOnSaleCapture();
            recordsUpdated = updated;
            dataSource = source;
            details.dataSource = source;
            void this.recalcBasketballPredictions('on_sale_capture');
            break;
          }
          case 'base_sync': {
            const { fbUpdated, bbUpdated, source } = await this.executeBaseSync();
            recordsUpdated = fbUpdated + bbUpdated;
            dataSource = source;
            details.footballUpdated = fbUpdated;
            details.basketballUpdated = bbUpdated;
            details.dataSource = source;
            void this.recalcBasketballPredictions('base_sync');
            break;
          }
          case 'daily_review': {
            const { hitBackfilled, source, reviewsGenerated } = await this.executeDailyReview();
            recordsUpdated = hitBackfilled + reviewsGenerated;
            dataSource = source;
            details.hitBackfilled = hitBackfilled;
            details.reviewsGenerated = reviewsGenerated;
            details.dataSource = source;
            break;
          }
          case 'ghost_cleanup': {
            const removed = await this.executeGhostCleanup();
            recordsUpdated = removed;
            dataSource = 'housekeeping';
            break;
          }
          case 'euroleague_injury_update': {
            const result = await this.executeEuroLeagueInjuryUpdate();
            recordsUpdated = result.updated;
            dataSource = 'euroleague-official';
            details.basketballUpdated = result.updated;
            details.dataSource = dataSource;
            void this.recalcBasketballPredictions('euroleague_injury_update');
            break;
          }
          default:
            throw new Error(`Unknown task: ${taskName}`);
        }
      } catch (err) {
        status = 'failed';
        const errMsg = this.errorMessage(err);
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
          await tx.update(syncTaskLogs).set({
            status: 'failed',
            finishedAt: new Date(),
            durationMs: Math.round((Date.now() - startedAt.getTime())),
            errorMessage: errMsg,
          }).where(eq(syncTaskLogs.id, logId!));
        });
        this.logger.error(`Task ${taskName} failed: ${errMsg}`);
        this.isRunning.set(taskName, false);
        return { ok: false, message: errMsg };
      }

      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
        await tx.update(syncTaskLogs).set({
          status,
          finishedAt: new Date(),
          durationMs: Math.round((Date.now() - startedAt.getTime())),
          recordsUpdated,
          dataSource,
          details: details as Record<string, unknown>,
        }).where(eq(syncTaskLogs.id, logId!));
      });

      this.logger.log(
        `Task ${taskName} completed: status=${status}, updated=${recordsUpdated}, source=${dataSource}`,
      );

      if (status === 'success') {
        void this.runPostSyncAutoCheck(taskName);
      }

      if (status === 'success' && (taskName === 'daily_full_sync' || taskName === 'base_sync')) {
        void (async () => {
          await this.sportteryService.runPostSyncInjuryBackfill(taskName);
          try {
            const sinaResult = await this.sinaInjuryService.backfillSinaInjuries();
            this.logger.log(
              `[post-sync] Sina injury backfill done: matched=${sinaResult.matchedMatches}, inserted=${sinaResult.inserted}`,
            );
          } catch (err) {
            this.logger.warn(`[post-sync] Sina injury backfill failed: ${this.errorMessage(err)}`);
          }
          void this.recalcBasketballPredictions('injury_backfill');
        })();
      }

      return { ok: true, message: `${status}, updated ${recordsUpdated} records` };
    } catch (logErr) {
      this.logger.error(`Failed to write task log for ${taskName}: ${this.errorMessage(logErr)}`);
      return { ok: false, message: `log error: ${this.errorMessage(logErr)}` };
    } finally {
      this.isRunning.set(taskName, false);
    }
  }

  private async executeFullSync(): Promise<{ fbUpdated: number; bbUpdated: number; source: string }> {
    let fbUpdated = 0;
    let bbUpdated = 0;
    let source = 'sporttery+espn+qiumibao';

    try {
      const fbResult = await (this.sportteryService as unknown as {
        syncFootball: () => Promise<{ inserted: number; updated: number; skipped: number }>;
      }).syncFootball();
      fbUpdated = fbResult.inserted + fbResult.updated;
    } catch (err) {
      this.logger.warn(`Football sync in full_sync failed: ${this.errorMessage(err)}`);
    }

    try {
      const bbResult = await (this.sportteryService as unknown as {
        syncBasketball: () => Promise<{ inserted: number; updated: number; skipped: number }>;
      }).syncBasketball();
      bbUpdated = bbResult.inserted + bbResult.updated;
    } catch (err) {
      this.logger.warn(`Basketball sync in full_sync failed: ${this.errorMessage(err)}`);
    }

    try {
      await (this.sportteryService as unknown as {
        runEspnLiveSync: () => Promise<void>;
      }).runEspnLiveSync();
    } catch (err) {
      this.logger.warn(`ESPN live sync in full_sync failed: ${this.errorMessage(err)}`);
    }

    // Stale-upcoming backstop: force-recheck ESPN basketball matches that
    // are past kickoff but still showing upcoming (e.g. WNBA Finals series
    // games that fell out of the scoreboard date window).
    try {
      const fixResult = await (this.sportteryService as unknown as {
        fixStaleUpcomingEspnBasketballMatches: () => Promise<{ checked: number; fixed: number; failed: number }>;
      }).fixStaleUpcomingEspnBasketballMatches();
      if (fixResult.checked > 0) {
        this.logger.log(
          `Stale upcoming ESPN basketball fix: checked=${fixResult.checked} fixed=${fixResult.fixed} failed=${fixResult.failed}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Stale upcoming ESPN basketball fix failed: ${this.errorMessage(err)}`);
    }

    // NBL live 场次终场 backstop：NBL 官方源只推 live 比赛，结束后从列表消失导致卡在 live
    try {
      const nblFixResult = await (this.sportteryService as unknown as {
        fixStaleLiveNblBasketballMatches: () => Promise<{ checked: number; fixed: number }>;
      }).fixStaleLiveNblBasketballMatches();
      if (nblFixResult.checked > 0) {
        this.logger.log(
          `NBL live finish fix: checked=${nblFixResult.checked} fixed=${nblFixResult.fixed}`,
        );
      }
    } catch (err) {
      this.logger.warn(`NBL live finish fix failed: ${this.errorMessage(err)}`);
    }

    // 通用小联赛 live 场次终场 backstop：球美宝源小联赛开赛已久仍卡在 live
    try {
      const minorFixResult = await (this.sportteryService as unknown as {
        fixStaleLiveMinorLeagueBasketballMatches: () => Promise<{ checked: number; fixed: number }>;
      }).fixStaleLiveMinorLeagueBasketballMatches();
      if (minorFixResult.checked > 0) {
        this.logger.log(
          `Minor league live finish fix: checked=${minorFixResult.checked} fixed=${minorFixResult.fixed}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Minor league live finish fix failed: ${this.errorMessage(err)}`);
    }

    void this.recalcBasketballPredictions('espn_enrichment');

    return { fbUpdated, bbUpdated, source };
  }

  private async executeHitBackfill(): Promise<{ fbHit: number; bbHit: number }> {
    let fbHit = 0;
    let bbHit = 0;

    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dateStr = sevenDaysAgo.toISOString().slice(0, 10);

    try {
      const fb = await (this.sportteryService as unknown as {
        backfillFootballHits: (startDate?: string) => Promise<{ checked: number; updated: number; errors: number }>;
      }).backfillFootballHits(dateStr);
      fbHit = fb.updated;
    } catch (err) {
      this.logger.warn(`Football hit backfill failed: ${this.errorMessage(err)}`);
    }

    try {
      const bb = await (this.sportteryService as unknown as {
        backfillBasketballHits: (startDate?: string) => Promise<{ checked: number; updated: number; errors: number }>;
      }).backfillBasketballHits(dateStr);
      bbHit = bb.updated;
    } catch (err) {
      this.logger.warn(`Basketball hit backfill failed: ${this.errorMessage(err)}`);
    }

    return { fbHit, bbHit };
  }

  private async executeOddsIntelUpdate(): Promise<{ updated: number; source: string }> {
    let updated = 0;
    const sources: string[] = [];

    try {
      await (this.sportteryService as unknown as {
        runOddsApiSync: () => Promise<void>;
      }).runOddsApiSync();
      sources.push('odds-api');
    } catch (err) {
      this.logger.warn(`Odds API sync in 16:00 update failed: ${this.errorMessage(err)}`);
    }

    try {
      await (this.sportteryService as unknown as {
        runEspnSummarySync: () => Promise<void>;
      }).runEspnSummarySync();
      sources.push('espn-summary');
    } catch (err) {
      this.logger.warn(`ESPN summary sync failed: ${this.errorMessage(err)}`);
    }

    const bbResult = await this.db.execute(sql`
      UPDATE basketball_matches
      SET _updated_at = CURRENT_TIMESTAMP
      WHERE match_status IN ('upcoming', 'live')
        AND kickoff_time >= CURRENT_DATE
        AND kickoff_time < CURRENT_DATE + INTERVAL '3 days'
        AND is_official_locked = false
    `);
    updated = Number((bbResult as unknown as { rowCount: number }).rowCount ?? 0);
    sources.push('qiumibao');

    return { updated, source: sources.join('+') || 'none' };
  }

  private async executeOnSaleCapture(): Promise<{ updated: number; source: string }> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*) as count FROM basketball_matches
      WHERE match_status = 'upcoming'
        AND kickoff_time >= CURRENT_TIMESTAMP
        AND kickoff_time < CURRENT_TIMESTAMP + INTERVAL '48 hours'
    `);
    const rows = (result as unknown as { rows?: { count: string | number }[] }).rows ?? [];
    const upcoming = Number(rows[0]?.count ?? 0);

    let bbInserted = 0;
    let bbUpdated = 0;
    let source = 'espn+qiumibao';

    try {
      const bbResult = await (this.sportteryService as unknown as {
        syncBasketball: () => Promise<{ inserted: number; updated: number; skipped: number }>;
      }).syncBasketball();
      bbInserted = bbResult.inserted;
      bbUpdated = bbResult.updated;
      source = 'sporttery+espn+qiumibao';
    } catch (err) {
      this.logger.warn(`Sporttery basketball sync in on-sale capture failed: ${this.errorMessage(err)}`);
    }

    try {
      await (this.sportteryService as unknown as {
        runEspnLiveSync: () => Promise<void>;
      }).runEspnLiveSync();
    } catch (err) {
      this.logger.warn(`ESPN live in on-sale capture failed: ${this.errorMessage(err)}`);
    }

    return { updated: upcoming + bbInserted + bbUpdated, source };
  }

  private async executeBaseSync(): Promise<{ fbUpdated: number; bbUpdated: number; source: string }> {
    return this.executeFullSync();
  }

  private async executeDailyReview(): Promise<{ hitBackfilled: number; source: string; reviewsGenerated: number }> {
    const { fbHit, bbHit } = await this.executeHitBackfill();

    try {
      await (this.sportteryService as unknown as {
        runEspnSummarySync: () => Promise<void>;
      }).runEspnSummarySync();
    } catch (err) {
      this.logger.warn(`ESPN summary in daily review failed: ${this.errorMessage(err)}`);
    }

    // 生成当日复盘摘要
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SHANGHAI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string): string => {
      const p = parts.find((x) => x.type === type);
      return p?.value ?? '00';
    };
    const todayStr = `${get('year')}-${get('month')}-${get('day')}`;

    let reviewsGenerated = 0;
    try {
      const bbReview = await this.generateDailyReview('basketball', todayStr);
      reviewsGenerated += bbReview;
    } catch (err) {
      this.logger.warn(`Basketball daily review generation failed: ${this.errorMessage(err)}`);
    }

    try {
      const fbReview = await this.generateDailyReview('football', todayStr);
      reviewsGenerated += fbReview;
    } catch (err) {
      this.logger.warn(`Football daily review generation failed: ${this.errorMessage(err)}`);
    }

    return {
      hitBackfilled: fbHit + bbHit,
      source: 'espn+qiumibao+odds-api',
      reviewsGenerated,
    };
  }

  async generateDailyReview(
    sport: 'basketball' | 'football',
    dateStr: string,
  ): Promise<number> {
    interface FinishedRow {
      matchNo: string;
      league: string | null;
      homeTeam: string;
      awayTeam: string;
      homeScore: number | null;
      awayScore: number | null;
      handicapRecommendation: string;
      handicapLineNum: number | null;
      totalDirection: string | null;
      totalLineNum: number | null;
      hitWdw: boolean | null;
      hitHandicap: boolean | null;
      hitOverunder: boolean | null;
    }

    interface RowWithSource extends FinishedRow {
      source: string;
    }

    let allRows: RowWithSource[] = [];

    if (sport === 'basketball') {
      const rows = await this.db
        .select({
          matchNo: basketballMatches.matchNo,
          league: basketballMatches.league,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          homeScore: basketballMatches.homeScore,
          awayScore: basketballMatches.awayScore,
          handicapRecommendation: basketballMatches.handicapRecommendation,
          handicapLineNum: basketballMatches.handicapLineNum,
          totalDirection: basketballMatches.totalDirection,
          totalLineNum: basketballMatches.totalLineNum,
          hitWdw: basketballMatches.hitWdw,
          hitHandicap: basketballMatches.hitHandicap,
          hitOverunder: basketballMatches.hitOverunder,
          source: basketballMatches.source,
        })
        .from(basketballMatches)
        .where(
          and(
            eq(basketballMatches.businessDate, dateStr),
            eq(basketballMatches.matchStatus, 'finished'),
          ),
        );
      allRows = rows.map((r) => ({
        matchNo: r.matchNo,
        league: r.league,
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        handicapRecommendation: r.handicapRecommendation,
        handicapLineNum: r.handicapLineNum !== null ? Number(r.handicapLineNum) : null,
        totalDirection: r.totalDirection,
        totalLineNum: r.totalLineNum !== null ? Number(r.totalLineNum) : null,
        hitWdw: r.hitWdw,
        hitHandicap: r.hitHandicap,
        hitOverunder: r.hitOverunder,
        source: r.source ?? 'sporttery',
      })) as RowWithSource[];
    } else {
      const rows = await this.db
        .select({
          matchNo: matches.matchNo,
          league: matches.league,
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
          homeScore: matches.homeScore,
          awayScore: matches.awayScore,
          handicapRecommendation: matches.handicapRecommendation,
          handicap: matches.handicap,
          totalDirection: matches.totalPick,
          totalLineNum: matches.totalGoals,
          hitWdw: matches.hitWdw,
          hitHandicap: matches.hitHandicap,
          hitOverunder: matches.hitOverunder,
          source: matches.source,
        })
        .from(matches)
        .where(
          and(
            eq(matches.businessDate, dateStr),
            eq(matches.matchStatus, 'finished'),
          ),
        );
      allRows = rows.map((r) => {
        let hdcLine: number | null = null;
        const hdcStr = (r as { handicap: string | null }).handicap;
        if (hdcStr) {
          const parsed = parseFloat(hdcStr);
          if (!isNaN(parsed)) hdcLine = parsed;
        }
        return {
          matchNo: r.matchNo,
          league: r.league,
          homeTeam: r.homeTeam,
          awayTeam: r.awayTeam,
          homeScore: r.homeScore,
          awayScore: r.awayScore,
          handicapRecommendation: r.handicapRecommendation,
          handicapLineNum: hdcLine,
          totalDirection: r.totalDirection,
          totalLineNum: r.totalLineNum !== null ? Number(r.totalLineNum) : null,
          hitWdw: r.hitWdw,
          hitHandicap: r.hitHandicap,
          hitOverunder: r.hitOverunder,
          source: r.source ?? 'sporttery',
        };
      }) as RowWithSource[];
    }

    if (allRows.length === 0) {
      this.logger.log(`[daily-review] ${sport} ${dateStr}: 0 finished matches, skip review generation`);
      return 0;
    }

    const sourceGroups = new Map<string, RowWithSource[]>();
    for (const row of allRows) {
      if (!sourceGroups.has(row.source)) sourceGroups.set(row.source, []);
      sourceGroups.get(row.source)!.push(row);
    }

    let totalGenerated = 0;

    for (const [source, finishedRows] of sourceGroups) {
      const totalMatches = finishedRows.length;

    // 统计命中
    let wdwHit = 0;
    let wdwTotal = 0;
    let handicapHit = 0;
    let handicapTotal = 0;
    let overunderHit = 0;
    let overunderTotal = 0;

    // 按联赛分组
    const leagueMap = new Map<string, {
      total: number;
      hdcHit: number;
      hdcTotal: number;
      ouHit: number;
      ouTotal: number;
    }>();

    // 异常场次
    const anomalyMatches: {
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      handicapDir: string;
      handicapLine: number;
      actualSpread: number;
      hit: boolean;
      totalDir: string;
      totalLine: number;
      actualTotal: number;
      totalHit: boolean;
      deviationNote: string;
    }[] = [];

    for (const row of finishedRows) {
      const league = row.league ?? '未知';
      if (!leagueMap.has(league)) {
        leagueMap.set(league, { total: 0, hdcHit: 0, hdcTotal: 0, ouHit: 0, ouTotal: 0 });
      }
      const lg = leagueMap.get(league)!;
      lg.total += 1;

      // WDW
      if (row.hitWdw !== null && row.hitWdw !== undefined) {
        wdwTotal += 1;
        if (row.hitWdw) wdwHit += 1;
      }

      // Handicap
      if (row.hitHandicap !== null && row.hitHandicap !== undefined) {
        handicapTotal += 1;
        lg.hdcTotal += 1;
        if (row.hitHandicap) {
          handicapHit += 1;
          lg.hdcHit += 1;
        }
      }

      // Over/Under
      if (row.hitOverunder !== null && row.hitOverunder !== undefined) {
        overunderTotal += 1;
        lg.ouTotal += 1;
        if (row.hitOverunder) {
          overunderHit += 1;
          lg.ouHit += 1;
        }
      }

      // 异常场次判定
      const homeScore = row.homeScore ?? 0;
      const awayScore = row.awayScore ?? 0;
      const actualSpread = homeScore - awayScore;
      const actualTotal = homeScore + awayScore;

      const hdcLineNum = row.handicapLineNum ?? 0;
      const totalLineNum = row.totalLineNum ?? 0;

      const handicapDir = row.handicapRecommendation ?? '';
      const totalDir = row.totalDirection ?? '';
      const hdcHit = Boolean(row.hitHandicap);
      const ouHit = Boolean(row.hitOverunder);

      // 让分偏差：实际分差 vs 让分线
      // handicapLineNum 是主队视角（负=主队让分，正=主队受让）
      // 实际净胜分 = home - away
      // 让分后净胜 = actualSpread + hdcLineNum（主队让分后）
      // 预测方向：让分主胜=主队让分后赢；让分客胜=主队让分后输
      const spreadDeviation = Math.abs(actualSpread + hdcLineNum); // 让分后净胜分的绝对值 = 偏差幅度
      const totalDeviation = Math.abs(actualTotal - totalLineNum);

      const isHdcAnomaly = !hdcHit
        && handicapDir !== ''
        && !handicapDir.includes('观望')
        && spreadDeviation > 10;
      const isOuAnomaly = totalDeviation > 15 && totalDir !== '' && !totalDir.includes('观望');

      if (isHdcAnomaly || isOuAnomaly) {
        const notes: string[] = [];
        if (isHdcAnomaly) notes.push(`让分爆冷+偏差${spreadDeviation.toFixed(1)}分`);
        if (isOuAnomaly) notes.push(`大小分偏差${totalDeviation.toFixed(1)}分`);
        if (isHdcAnomaly && isOuAnomaly) notes.unshift('双向爆冷');

        anomalyMatches.push({
          matchNo: row.matchNo,
          league,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          handicapDir,
          handicapLine: hdcLineNum,
          actualSpread,
          hit: hdcHit,
          totalDir,
          totalLine: totalLineNum,
          actualTotal,
          totalHit: ouHit,
          deviationNote: notes.join('，'),
        });
      }
    }

    // 计算命中率
    const calcRate = (hit: number, total: number): number | null => {
      if (total === 0) return null;
      return Math.round((hit / total) * 10000) / 100;
    };

    const wdwRate = calcRate(wdwHit, wdwTotal);
    const handicapRate = calcRate(handicapHit, handicapTotal);
    const overunderRate = calcRate(overunderHit, overunderTotal);

    // 按联赛排序（总场次降序）
    const byLeague = Array.from(leagueMap.entries())
      .map(([league, data]) => ({
        league,
        total: data.total,
        hdcHit: data.hdcHit,
        hdcRate: data.hdcTotal > 0 ? Math.round((data.hdcHit / data.hdcTotal) * 10000) / 100 : 0,
        ouHit: data.ouHit,
        ouRate: data.ouTotal > 0 ? Math.round((data.ouHit / data.ouTotal) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // 按偏差幅度排序异常场次
    anomalyMatches.sort((a, b) => {
      const aDev = Math.abs(a.actualSpread + a.handicapLine) + Math.abs(a.actualTotal - a.totalLine);
      const bDev = Math.abs(b.actualSpread + b.handicapLine) + Math.abs(b.actualTotal - b.totalLine);
      return bDev - aDev;
    });

    // 生成 summary
    const sportLabel = sport === 'basketball' ? '篮球' : '足球';
    const sourceLabel = source === 'sporttery' ? '竞彩' : source === 'beidan' ? '北单' : source;
    const summaryParts: string[] = [`${sourceLabel}${totalMatches}场`];
    if (handicapTotal > 0) {
      const label = handicapRate !== null && handicapRate < 40 ? '异常低'
        : handicapRate !== null && handicapRate >= 65 ? '优秀'
        : '正常';
      summaryParts.push(`让分${handicapHit}/${handicapTotal} ${handicapRate?.toFixed(1)}% ${label}`);
    }
    if (overunderTotal > 0) {
      const label = overunderRate !== null && overunderRate >= 65 ? '优秀'
        : overunderRate !== null && overunderRate < 40 ? '异常低'
        : '正常';
      summaryParts.push(`大小分${overunderHit}/${overunderTotal} ${overunderRate?.toFixed(1)}% ${label}`);
    }
    if (anomalyMatches.length > 0) {
      const top = anomalyMatches[0];
      summaryParts.push(`最大偏差场：${top.homeTeam}vs${top.awayTeam}，${top.deviationNote}`);
    }
    const summary = summaryParts.join('。');

    // UPSERT 写入 daily_review
      const result = await this.db.execute(sql`
        INSERT INTO daily_review (
          review_date, sport, source, total_matches,
          wdw_hit, wdw_total, wdw_rate,
          handicap_hit, handicap_total, handicap_rate,
          overunder_hit, overunder_total, overunder_rate,
          by_league, anomaly_matches, summary,
          _updated_at
        ) VALUES (
          ${dateStr}::date,
          ${sport}::varchar,
          ${source}::varchar,
          ${totalMatches}::int,
          ${wdwTotal > 0 ? wdwHit : null}::int,
          ${wdwTotal > 0 ? wdwTotal : null}::int,
          ${wdwRate !== null ? wdwRate : null}::numeric(5,2),
          ${handicapTotal > 0 ? handicapHit : null}::int,
          ${handicapTotal > 0 ? handicapTotal : null}::int,
          ${handicapRate !== null ? handicapRate : null}::numeric(5,2),
          ${overunderTotal > 0 ? overunderHit : null}::int,
          ${overunderTotal > 0 ? overunderTotal : null}::int,
          ${overunderRate !== null ? overunderRate : null}::numeric(5,2),
          ${JSON.stringify(byLeague)}::jsonb,
          ${JSON.stringify(anomalyMatches)}::jsonb,
          ${summary}::text,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (review_date, sport, source) DO UPDATE SET
          total_matches = EXCLUDED.total_matches,
          wdw_hit = EXCLUDED.wdw_hit,
          wdw_total = EXCLUDED.wdw_total,
          wdw_rate = EXCLUDED.wdw_rate,
          handicap_hit = EXCLUDED.handicap_hit,
          handicap_total = EXCLUDED.handicap_total,
          handicap_rate = EXCLUDED.handicap_rate,
          overunder_hit = EXCLUDED.overunder_hit,
          overunder_total = EXCLUDED.overunder_total,
          overunder_rate = EXCLUDED.overunder_rate,
          by_league = EXCLUDED.by_league,
          anomaly_matches = EXCLUDED.anomaly_matches,
          summary = EXCLUDED.summary,
          _updated_at = CURRENT_TIMESTAMP
      `);

      const rowCount = Number((result as unknown as { rowCount: number }).rowCount ?? 0);
      totalGenerated += rowCount;

      this.logger.log(
        `[daily-review] ${sport}/${source} ${dateStr}: ${totalMatches} matches, ` +
        `hdc=${handicapHit}/${handicapTotal} (${handicapRate?.toFixed(1)}%), ` +
        `ou=${overunderHit}/${overunderTotal} (${overunderRate?.toFixed(1)}%), ` +
        `anomalies=${anomalyMatches.length}, upsert=${rowCount}`,
      );
    }

    return totalGenerated;
  }

  private async recalcBasketballPredictions(trigger: string): Promise<{ recalculated: number; skipped: number; errors: number }> {
    await this.ensureBasketballInjuriesBeforeRecalc(trigger);

    const sources = ['qiumibao', 'sporttery', 'espn'];
    let totalRecalc = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const src of sources) {
      try {
        const rows = await this.db
          .select({
            id: basketballMatches.id,
             matchNo: basketballMatches.matchNo,
             league: basketballMatches.league,
             homeTeam: basketballMatches.homeTeam,
             awayTeam: basketballMatches.awayTeam,
             matchStatus: basketballMatches.matchStatus,
             predEngineVersion: basketballMatches.predEngineVersion,
             handicapLineNum: basketballMatches.handicapLineNum,
             totalLineNum: basketballMatches.totalLineNum,
             homeWinOdds: basketballMatches.homeWinOdds,
             awayWinOdds: basketballMatches.awayWinOdds,
             teamStats: basketballMatches.teamStats,
              keyPlayers: basketballMatches.keyPlayers,
              injuries: basketballMatches.injuries,
              recentForm: basketballMatches.recentForm,
              h2hHistory: basketballMatches.h2hHistory,
              intelSummary: basketballMatches.intelSummary,
              intel: basketballMatches.intel,
              handicapOverride: basketballMatches.handicapOverride,
              totalOverride: basketballMatches.totalOverride,
            })
            .from(basketballMatches)
            .where(
              and(
                eq(basketballMatches.source, src),
                eq(basketballMatches.matchStatus, 'upcoming'),
                eq(basketballMatches.isPredictionFrozen, false),
                sql`coalesce(prediction_locked_until, '1970-01-01'::timestamptz) < now()`,
              ),
            );

        const v11Rows = rows.filter((r) => r.predEngineVersion?.startsWith('v11'));
        const ddRows = rows.filter((r) =>
          !r.predEngineVersion ||
          r.predEngineVersion.startsWith('data-driven') ||
          r.predEngineVersion.startsWith('v10') ||
          r.predEngineVersion.startsWith('v9') ||
          r.predEngineVersion.startsWith('v8') ||
          r.predEngineVersion.startsWith('v7'),
        );

        if (ddRows.length > 0) {
          const ddUpcoming = await this.dataDrivenService.predictAllUpcomingBySource(src);
          if (ddUpcoming.length > 0) {
            const result = await this.dataDrivenService.applyPredictions(ddUpcoming, { force: true });
            totalRecalc += result.updated;
            totalSkipped += result.skippedLocked;
            totalErrors += result.errors;
          }
          const ddLive = await this.dataDrivenService.predictLiveBySource(src);
          if (ddLive.length > 0) {
            const liveResult = await this.dataDrivenService.applyPredictions(ddLive, { force: true });
            totalRecalc += liveResult.updated;
            totalSkipped += liveResult.skippedLocked;
            totalErrors += liveResult.errors;
          }

          const upgradeRows = ddRows.filter((r) => this.isV11UpgradeEligible(r));
          if (upgradeRows.length > 0) {
             const upgradeResult = await this.recalcV11Basketball(upgradeRows, trigger);
            totalRecalc += upgradeResult.updated;
            totalErrors += upgradeResult.errors;
            this.logger.log(
              `[recalc-prediction][${trigger}] V11 auto-upgrade ${upgradeResult.updated}/${upgradeRows.length} ` +
              `upgraded from data-driven/lower, errors=${upgradeResult.errors} (source=${src})`,
            );
          }
          const skippedUpgrade = ddRows.length - upgradeRows.length;
          if (skippedUpgrade > 0) {
            this.logger.log(
              `[recalc-prediction][${trigger}] V11 auto-upgrade skipped ${skippedUpgrade} ` +
              `data-insufficient matches (kept data-driven/lower) (source=${src})`,
            );
          }
        }

        if (v11Rows.length > 0) {
          const v11Result = await this.recalcV11Basketball(v11Rows, trigger);
          totalRecalc += v11Result.updated;
          totalErrors += v11Result.errors;
          this.logger.log(
            `[recalc-prediction][${trigger}] V11 ${v11Result.updated}/${v11Rows.length} recalculated, errors=${v11Result.errors} (source=${src})`,
          );
        }
      } catch (err: unknown) {
        totalErrors += 1;
        this.logger.warn(`[recalc-prediction][${trigger}] source=${src} failed: ${this.errorMessage(err)}`);
      }
    }

    if (totalRecalc > 0 || totalErrors > 0) {
      this.logger.log(
        `[recalc-prediction][${trigger}] recalculated=${totalRecalc} skipped=${totalSkipped} errors=${totalErrors}`,
      );
    }

    // Step consistency: Ensure handicap recommendation aligns with predicted margin + line
    // Catches cases where line sign flipped (e.g. EuroLeague) but recommendation stayed stale
    try {
      const table = basketballMatches;
      const consistencyResult = await this.db
        .update(table)
        .set({
          handicapRecommendation: sql<string>`case
            when (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) > 0.1 then '让分主胜'
            else '让分客胜'
          end`,
          handicapPick: sql<string>`case
            when (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) > 0.1 then '让分主胜'
            else '让分客胜'
          end`,
          modelRules: sql<string[]>`array_append(${table.modelRules}, '让分推荐自洽修复：sync后对齐至预期比分与新线值')`,
        })
        .where(and(
          isNotNull(table.handicapLineNum),
          sql`${table.handicapLineNum} <> 0`,
          isNotNull(table.predictedHomeScore),
          isNotNull(table.predictedAwayScore),
          gt(table.predictedHomeScore, 0),
          gt(table.predictedAwayScore, 0),
          sql`${table.handicapRecommendation} is not null`,
          sql`${table.handicapRecommendation} <> ''`,
           sql`${table.handicapRecommendation} not like '%观望%'`,
           sql`${table.handicapOverride} is null`,
           eq(table.isPredictionFrozen, false),
          sql`(
            (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) > 0.1
            and ${table.handicapRecommendation} = '让分客胜'
          ) or (
            (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) < -0.1
            and ${table.handicapRecommendation} = '让分主胜'
          )`,
        ))
        .returning({ id: table.id });
      if (consistencyResult.length > 0) {
        this.logger.log(
          `[recalc-prediction][${trigger}] auto-fixed ${consistencyResult.length} handicap recommendation inconsistencies`,
        );
      }
    } catch (err: unknown) {
      this.logger.warn(`[recalc-prediction][${trigger}] consistency fix failed: ${this.errorMessage(err)}`);
    }

    return { recalculated: totalRecalc, skipped: totalSkipped, errors: totalErrors };
  }

  private async ensureBasketballInjuriesBeforeRecalc(trigger: string): Promise<void> {
    try {
      await (this.sportteryService as unknown as {
        prefetchMissingBasketballInjuries: () => Promise<{ updated: number; failed: number; skipped: number }>;
      }).prefetchMissingBasketballInjuries();
    } catch (err) {
      this.logger.warn(`[injury-gate] trigger=${trigger}: injury prefetch failed: ${this.errorMessage(err)}`);
    }
    if (trigger === 'daily_full_sync' || trigger === 'base_sync' || trigger === 'injury_backfill') {
      try {
        await this.executeEuroLeagueInjuryUpdate();
      } catch (err) {
        this.logger.warn(`[injury-gate] euroleague prefetch failed: ${this.errorMessage(err)}`);
      }
    }
  }

  private async recalcV11Basketball(
    rows: Array<{
      id: string;
      matchNo: string | null;
      league: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      handicapLineNum: string | number | null;
      totalLineNum: string | number | null;
      homeWinOdds: string | number | null;
      awayWinOdds: string | number | null;
      teamStats: unknown;
      keyPlayers: unknown;
      injuries: unknown;
      recentForm: unknown;
      h2hHistory: unknown;
      intelSummary: string | null;
      intel: string | null;
      handicapOverride: unknown;
      totalOverride: unknown;
    }>,
    trigger: string,
  ): Promise<{ updated: number; errors: number }> {
    let updated = 0;
    let errors = 0;
    let skippedDebounced = 0;

    const eloTeams: Array<{ teamName: string }> = [];
    const emptyStatsTeams: Array<{ teamName: string; league: string }> = [];
    for (const r of rows) {
      if (r.homeTeam) eloTeams.push({ teamName: r.homeTeam });
      if (r.awayTeam) eloTeams.push({ teamName: r.awayTeam });
      const league = r.league || 'default';
      if (r.homeTeam && !this.hasTeamStats(r.teamStats, 'home')) {
        emptyStatsTeams.push({ teamName: r.homeTeam, league });
      }
      if (r.awayTeam && !this.hasTeamStats(r.teamStats, 'away')) {
        emptyStatsTeams.push({ teamName: r.awayTeam, league });
      }
    }
    const eloMap = await this.eloHistoryService.getTeamRatings('basketball', eloTeams);
    const histStatsMap = await this.computeHistoricalTeamStats(emptyStatsTeams);

    for (const row of rows) {
      try {
        const hwOdds = Number(row.homeWinOdds) || 0;
        const awOdds = Number(row.awayWinOdds) || 0;
        const handicapVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
        const hasLine = Math.abs(handicapVal) > 0;
        let hw = hwOdds;
        let aw = awOdds;
        if ((hw <= 0 || aw <= 0) && hasLine) {
          const midLine = Math.abs(handicapVal);
          const baseWinRate = 0.5 + midLine / 30;
          const clamped = Math.max(0.15, Math.min(0.85, baseWinRate));
          hw = handicapVal < 0 ? 1 / (clamped * 1.06) : 1 / ((1 - clamped) * 1.06);
          aw = handicapVal < 0 ? 1 / ((1 - clamped) * 1.06) : 1 / (clamped * 1.06);
        }

        const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
        const rowLeague = row.league || 'default';
        const totalValid = totalLineNum > 0;
        const totalLineForPred = totalValid ? String(totalLineNum) : undefined;
        const handicapStrForPred = hasLine ? String(handicapVal) : '';

        let homePpg: number | undefined;
        let awayPpg: number | undefined;
        let homeOppg: number | undefined;
        let awayOppg: number | undefined;
        let homeGames = 0;
        let awayGames = 0;
        if (row.teamStats && typeof row.teamStats === 'object') {
          const ts = row.teamStats as Record<string, unknown>;
          const hs = ts.home as Record<string, unknown> | null;
          const as = ts.away as Record<string, unknown> | null;
          if (hs) {
            const rawVal = hs.pointsPerGame != null && hs.pointsPerGame !== '' ? hs.pointsPerGame : hs.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) homePpg = n;
          }
          if (as) {
            const rawVal = as.pointsPerGame != null && as.pointsPerGame !== '' ? as.pointsPerGame : as.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) awayPpg = n;
          }
        }
        if (!homePpg && row.homeTeam) {
          const stat = histStatsMap.get(row.homeTeam);
          if (stat && stat.ppg > 0) {
            homePpg = stat.ppg;
            homeOppg = stat.oppg;
            homeGames = stat.games;
          }
        }
        if (!awayPpg && row.awayTeam) {
          const stat = histStatsMap.get(row.awayTeam);
          if (stat && stat.ppg > 0) {
            awayPpg = stat.ppg;
            awayOppg = stat.oppg;
            awayGames = stat.games;
          }
        }

        const intelText = row.intelSummary ?? (typeof row.intel === 'string' ? row.intel : '');
        const prediction = (this.sportteryService as unknown as {
          generateBasketballPrediction: (
            hw: number,
            aw: number,
            handicapStr: string,
            totalLineStr?: string,
            league?: string,
            stage?: string,
            options?: Record<string, unknown>,
          ) => {
            homeWinProb: number;
            awayWinProb: number;
            predictionDirection: string;
            confidence: number;
            handicapRecommendation: string;
            handicapCoverProb: number;
            handicapPickProb: number;
            totalDirection: string;
            overProb: number;
            underProb: number;
            totalPickProb: number;
            modelRules: string[];
            predictedHomeScore: number;
            predictedAwayScore: number;
            predictedTotal: number;
            handicapConfidence: string;
            ouConfidence: string;
            ouDiffVsLine: number;
            predEngineVersion: string;
          } | null;
        }).generateBasketballPrediction(
          hw, aw, handicapStrForPred, totalLineForPred, rowLeague, '',
          {
            homePpg,
            awayPpg,
             intelData: parseIntelFromRow({
               homeTeam: row.homeTeam ?? '',
               awayTeam: row.awayTeam ?? '',
               h2hHistory: row.h2hHistory,
               injuries: row.injuries,
               keyPlayers: row.keyPlayers,
               recentForm: row.recentForm,
               teamNews: intelText,
             }),
            eloHome: row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined,
            eloAway: row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined,
            eloGap:
              row.homeTeam && row.awayTeam && eloMap.get(row.homeTeam) && eloMap.get(row.awayTeam)
                ? eloMap.get(row.homeTeam)!.rating - eloMap.get(row.awayTeam)!.rating
                : undefined,
            teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
             homeOppg,
             awayOppg,
          },
        );

        if (prediction) {
          const existing = await this.db
            .select({
              handicapRecommendation: basketballMatches.handicapRecommendation,
              totalDirection: basketballMatches.totalDirection,
              confidence: basketballMatches.confidence,
              handicapPickProb: basketballMatches.handicapPickProb,
              handicapCoverProb: basketballMatches.handicapCoverProb,
              totalPickProb: basketballMatches.totalPickProb,
              kickoffTime: basketballMatches.kickoffTime,
            })
            .from(basketballMatches)
            .where(eq(basketballMatches.id, row.id))
            .limit(1);

          const nowMs = Date.now();
          const kickoffMs = existing[0]?.kickoffTime
            ? new Date(existing[0].kickoffTime as Date).getTime()
            : 0;
          const hoursToKickoff = kickoffMs > nowMs ? (kickoffMs - nowMs) / (1000 * 60 * 60) : 0;
          const isPreGameWindow = hoursToKickoff > 0 && hoursToKickoff <= 6;

          if (existing[0]) {
            const cur = existing[0];
            const sameHandicapDir = cur.handicapRecommendation === prediction.handicapRecommendation;
            const sameTotalDir = cur.totalDirection === prediction.totalDirection;
            const hcProbDiff = Math.abs(
              (cur.handicapPickProb ?? 0) - (prediction.handicapPickProb ?? 0),
            );
            const totalProbDiff = Math.abs(
              (cur.totalPickProb ?? 0) - (prediction.totalPickProb ?? 0),
            );
            const confDiff = Math.abs((cur.confidence ?? 0) - (prediction.confidence ?? 0));

            const hcDirFlipped = !sameHandicapDir
              && cur.handicapRecommendation
              && !String(cur.handicapRecommendation).includes('观望')
              && prediction.handicapRecommendation
              && !prediction.handicapRecommendation.includes('观望');
            const totalDirFlipped = !sameTotalDir
              && cur.totalDirection
              && !String(cur.totalDirection).includes('观望')
              && prediction.totalDirection
              && !prediction.totalDirection.includes('观望');

            if (isPreGameWindow) {
              if (
                sameHandicapDir &&
                sameTotalDir &&
                hcProbDiff < 5 &&
                totalProbDiff < 5 &&
                confDiff < 5
              ) {
                this.logger.log(
                  `[pred-debounce] ${row.matchNo}: skip write (dir stable, hcΔ${hcProbDiff.toFixed(1)}% totalΔ${totalProbDiff.toFixed(1)}% confΔ${confDiff.toFixed(1)}%, kickoff in ${hoursToKickoff.toFixed(1)}h)`,
                );
                skippedDebounced += 1;
                continue;
              }
            }

            if (hcDirFlipped && hcProbDiff < 10) {
              this.logger.log(
                `[pred-dir-guard] ${row.matchNo}: skip handicap flip (hcΔ${hcProbDiff.toFixed(1)}% < 10pp threshold, ${cur.handicapRecommendation} -> ${prediction.handicapRecommendation})`,
              );
              prediction.handicapRecommendation = String(cur.handicapRecommendation);
              prediction.handicapPickProb = cur.handicapPickProb != null ? Number(cur.handicapPickProb) : 50;
              prediction.handicapCoverProb = cur.handicapCoverProb != null ? Number(cur.handicapCoverProb) : 50;
              prediction.confidence = cur.confidence != null ? Number(cur.confidence) : 55;
            }
            if (totalDirFlipped && totalProbDiff < 10) {
              this.logger.log(
                `[pred-dir-guard] ${row.matchNo}: skip total flip (totalΔ${totalProbDiff.toFixed(1)}% < 10pp threshold, ${cur.totalDirection} -> ${prediction.totalDirection})`,
              );
              prediction.totalDirection = String(cur.totalDirection);
              const totalPickProbVal = cur.totalPickProb != null ? Number(cur.totalPickProb) : 50;
              prediction.totalPickProb = totalPickProbVal;
              prediction.overProb = prediction.totalDirection === '大分'
                ? totalPickProbVal
                : 100 - totalPickProbVal;
              prediction.underProb = prediction.totalDirection === '小分'
                ? totalPickProbVal
                : 100 - totalPickProbVal;
            }
          }

          const patch: Record<string, unknown> = {
            homeWinProb: prediction.homeWinProb,
            awayWinProb: prediction.awayWinProb,
            predictionDirection: prediction.predictionDirection,
            confidence: prediction.confidence,
            handicapRecommendation: prediction.handicapRecommendation,
            handicapPick: prediction.handicapRecommendation,
            handicapCoverProb: prediction.handicapCoverProb,
            handicapPickProb: prediction.handicapPickProb,
            totalDirection: prediction.totalDirection,
            overProb: prediction.overProb,
            underProb: prediction.underProb,
            totalPick: prediction.totalDirection,
            totalPickProb: prediction.totalPickProb,
            modelRules: prediction.modelRules,
            predictedHomeScore: prediction.predictedHomeScore,
            predictedAwayScore: prediction.predictedAwayScore,
            predictedTotal: String(prediction.predictedTotal),
            handicapConfidence: prediction.handicapConfidence,
            ouConfidence: prediction.ouConfidence,
            ouDiffVsLine: String(prediction.ouDiffVsLine),
            predEngineVersion: prediction.predEngineVersion,
            predGeneratedAt: new Date(),
          };
          (this.sportteryService as unknown as {
            finalizeBasketballPick: (patch: Record<string, unknown>, a: null, b: null, league: string) => void;
          }).finalizeBasketballPick(patch, null, null, rowLeague);

          const hcOverride = row.handicapOverride as Record<string, unknown> | null;
          const baseRules = (prediction.modelRules || []).filter((r: string) => !r.startsWith('人工修正'));
          if (hcOverride) {
            patch.handicapRecommendation = String(hcOverride.recommendation ?? prediction.handicapRecommendation);
            patch.handicapPick = String(hcOverride.recommendation ?? prediction.handicapRecommendation);
            patch.handicapPickProb = Number(hcOverride.pickProb ?? prediction.handicapPickProb);
            patch.handicapConfidence = String(hcOverride.confidence ?? prediction.handicapConfidence);
            const reason = hcOverride.reason ? `（${String(hcOverride.reason)}）` : '';
            const overrideRules = [...baseRules];
            overrideRules.push(`人工修正：让分${String(hcOverride.recommendation)} ${Number(hcOverride.pickProb)}%${reason}`);
            patch.modelRules = overrideRules;
          }

          const ouOverride = row.totalOverride as Record<string, unknown> | null;
          if (ouOverride) {
            patch.totalDirection = String(ouOverride.direction ?? prediction.totalDirection);
            patch.totalPick = String(ouOverride.direction ?? prediction.totalDirection);
            patch.totalPickProb = Number(ouOverride.pickProb ?? prediction.totalPickProb);
            patch.ouConfidence = String(ouOverride.confidence ?? prediction.ouConfidence);
            const prob = Number(ouOverride.pickProb ?? 50);
            const dir = String(ouOverride.direction ?? '观望');
            patch.overProb = dir === '大分' ? prob : (100 - prob);
            patch.underProb = dir === '小分' ? prob : (100 - prob);
            const currentRules = (hcOverride ? patch.modelRules : baseRules) as string[];
            const reason = ouOverride.reason ? `（${String(ouOverride.reason)}）` : '';
            currentRules.push(`人工修正：大小分${dir} ${prob}%${reason}`);
            patch.modelRules = currentRules;
          }

          (this.sportteryService as unknown as {
            appendBasketballPredictionHistory: (patch: Record<string, unknown>, trig: string) => void;
          }).appendBasketballPredictionHistory(patch, trigger);

          await this.db.update(basketballMatches)
            .set(patch)
            .where(eq(basketballMatches.id, row.id));
          updated += 1;
        }
      } catch (err: unknown) {
        errors += 1;
        this.logger.warn(
          `[recalc-prediction] V11 recalc failed for ${row.matchNo}: ${this.errorMessage(err)}`,
        );
      }
    }

    if (skippedDebounced > 0) {
      this.logger.log(
        `[pred-debounce] total ${skippedDebounced} matches skipped (pre-game 6h window, stable direction <5% drift)`,
      );
    }

    return { updated, errors };
  }

  private async executeGhostCleanup(): Promise<number> {
    const bbResult = await this.db.execute(sql`
      DELETE FROM basketball_matches
      WHERE match_status = 'upcoming'
        AND source = 'sporttery'
        AND source_match_id IS NULL
        AND business_date < CURRENT_DATE - INTERVAL '2 days'
    `);
    const bbRemoved = Number((bbResult as unknown as { rowCount: number }).rowCount ?? 0);

    const fbResult = await this.db.execute(sql`
      DELETE FROM matches
      WHERE match_status = 'upcoming'
        AND source = 'sporttery'
        AND source_match_id IS NULL
        AND business_date < CURRENT_DATE - INTERVAL '2 days'
    `);
    const fbRemoved = Number((fbResult as unknown as { rowCount: number }).rowCount ?? 0);

    const total = bbRemoved + fbRemoved;
    if (total > 0) {
      this.logger.log(`[ghost-cleanup] removed ${total} stale matches (bb=${bbRemoved}, fb=${fbRemoved})`);
    }
    return total;
  }

  setTaskEnabled(taskName: string, enabled: boolean): boolean {
    if (!TASK_DEFS.some((t) => t.name === taskName)) {
      return false;
    }
    this.taskEnabled.set(taskName, enabled);
    return true;
  }

  async getAllTaskStatuses(): Promise<Array<TaskLatestStatus & { enabled: boolean; isRunning: boolean }>> {
    const statuses = await this.getStatus();
    return statuses.map((s) => ({
      ...s,
      enabled: this.taskEnabled.get(s.taskName) ?? true,
      isRunning: this.isRunning.get(s.taskName) ?? false,
    }));
  }

  async getStatus(): Promise<TaskLatestStatus[]> {
    const latestLogs = await this.db
      .select({
        taskName: syncTaskLogs.taskName,
        status: syncTaskLogs.status,
        startedAt: syncTaskLogs.startedAt,
        errorMessage: syncTaskLogs.errorMessage,
        recordsUpdated: syncTaskLogs.recordsUpdated,
      })
      .from(syncTaskLogs)
      .where(sql`
        id IN (
          SELECT DISTINCT ON (task_name) id
          FROM sync_task_logs
          ORDER BY task_name, started_at DESC
        )
      `)
      .orderBy(desc(syncTaskLogs.startedAt));

    const logMap = new Map<string, typeof latestLogs[number]>();
    for (const log of latestLogs) {
      logMap.set(log.taskName, log);
    }

    return TASK_DEFS.map((def) => {
      const log = logMap.get(def.name);
      const next = this.nextRunAt.get(def.name);
      return {
        taskName: def.name,
        description: def.description,
        cron: def.cron,
        lastRunAt: log?.startedAt?.toISOString() ?? null,
        lastStatus: (log?.status as TaskStatus | undefined) ?? null,
        lastErrorMessage: log?.errorMessage ?? null,
        lastRecordsUpdated: log?.recordsUpdated ?? 0,
        nextRunAt: next ? next.toISOString() : null,
      };
    });
  }

  async getRecentLogs(limit = 30): Promise<{
    id: string;
    taskName: string;
    trigger: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    durationMs: number | null;
    recordsUpdated: number;
    dataSource: string | null;
    errorMessage: string | null;
  }[]> {
    const rows = await this.db
      .select({
        id: syncTaskLogs.id,
        taskName: syncTaskLogs.taskName,
        trigger: syncTaskLogs.trigger,
        status: syncTaskLogs.status,
        startedAt: syncTaskLogs.startedAt,
        finishedAt: syncTaskLogs.finishedAt,
        durationMs: syncTaskLogs.durationMs,
        recordsUpdated: syncTaskLogs.recordsUpdated,
        dataSource: syncTaskLogs.dataSource,
        errorMessage: syncTaskLogs.errorMessage,
      })
      .from(syncTaskLogs)
      .orderBy(desc(syncTaskLogs.startedAt))
      .limit(limit);
    return rows;
  }

  private async cleanupHungTasks(reason: string): Promise<void> {
    try {
      const now = new Date();
      const hungIds: string[] = [];

      for (const def of TASK_DEFS) {
        const result = await this.db
          .select({
            id: syncTaskLogs.id,
            startedAt: syncTaskLogs.startedAt,
          })
          .from(syncTaskLogs)
          .where(
            sql`${syncTaskLogs.taskName} = ${def.name} AND ${syncTaskLogs.status} = 'running'`,
          )
          .limit(1);

        if (result[0]) {
          const runningMs = now.getTime() - new Date(result[0].startedAt).getTime();
          if (runningMs > def.timeoutMs) {
            hungIds.push(result[0].id);
            this.logger.warn(
              `[Watchdog:${reason}] ${def.name} hung for ${Math.round(runningMs / 60000)}min, terminating id=${result[0].id}`,
            );
          }
        }
      }

      for (const id of hungIds) {
        await this.terminateRunningTask(id, `watchdog cleanup (${reason})`);
      }

      if (hungIds.length > 0) {
        this.logger.log(`[Watchdog:${reason}] Cleaned up ${hungIds.length} hung task(s)`);
      }
    } catch (err) {
      this.logger.error(`[Watchdog:${reason}] cleanup failed: ${this.errorMessage(err)}`);
    }
  }

  private async terminateRunningTask(id: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      await tx
        .update(syncTaskLogs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: `manually terminated: ${reason}`,
        })
        .where(eq(syncTaskLogs.id, id));
    });
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  private hasTeamStats(teamStats: unknown, side: 'home' | 'away'): boolean {
    if (!teamStats || typeof teamStats !== 'object') return false;
    const ts = teamStats as Record<string, unknown>;
    const sideData = ts[side] as Record<string, unknown> | null | undefined;
    if (!sideData) return false;
    const rawVal = sideData.pointsPerGame != null && sideData.pointsPerGame !== ''
      ? sideData.pointsPerGame
      : sideData.ppg;
    const n = Number(rawVal);
    return !Number.isNaN(n) && n > 0;
  }

  private isV11UpgradeEligible(row: {
    teamStats: unknown;
    recentForm: unknown;
    h2hHistory: unknown;
    injuries: unknown;
    intelSummary: string | null;
    intel: string | null;
  }): boolean {
    if (this.hasTeamStats(row.teamStats, 'home') && this.hasTeamStats(row.teamStats, 'away')) {
      return true;
    }
    if (row.recentForm && typeof row.recentForm === 'object') {
      const rf = row.recentForm as Record<string, unknown>;
      const hasHome = Array.isArray(rf.home) && rf.home.length > 0;
      const hasAway = Array.isArray(rf.away) && rf.away.length > 0;
      if (hasHome && hasAway) return true;
    }
    if (row.h2hHistory && Array.isArray(row.h2hHistory) && row.h2hHistory.length > 0) {
      return true;
    }
    if (row.injuries && typeof row.injuries === 'object') {
      const inj = row.injuries as Record<string, unknown>;
      const hasHome = Array.isArray(inj.home) && inj.home.length > 0;
      const hasAway = Array.isArray(inj.away) && inj.away.length > 0;
      if (hasHome || hasAway) return true;
    }
    const intelText = row.intelSummary ?? row.intel;
    if (intelText && intelText.length > 20) return true;
    return false;
  }

  private async computeHistoricalTeamStats(
    teams: Array<{ teamName: string; league: string }>,
  ): Promise<Map<string, { ppg: number; oppg: number; games: number }>> {
    const result = new Map<string, { ppg: number; oppg: number; games: number }>();
    const uniqueTeams = Array.from(new Map(teams.map(t => [t.teamName, t.league])).entries());
    if (uniqueTeams.length === 0) return result;

    for (const [teamName, league] of uniqueTeams) {
      try {
        const rows = await this.db.execute(sql<{ for_sum: string; against_sum: string; game_count: string }>`
          SELECT
            SUM(for_sum)::text AS for_sum,
            SUM(against_sum)::text AS against_sum,
            SUM(game_count)::text AS game_count
          FROM (
            SELECT
              SUM(home_score) AS for_sum,
              SUM(away_score) AS against_sum,
              COUNT(*) AS game_count
            FROM basketball_matches
            WHERE match_status = 'finished'
              AND home_score IS NOT NULL
              AND away_score IS NOT NULL
              AND home_team = ${teamName}
            UNION ALL
            SELECT
              SUM(away_score) AS for_sum,
              SUM(home_score) AS against_sum,
              COUNT(*) AS game_count
            FROM basketball_matches
            WHERE match_status = 'finished'
              AND home_score IS NOT NULL
              AND away_score IS NOT NULL
              AND away_team = ${teamName}
          ) sub
        `);

        const row = rows?.[0];
        if (row && row.game_count && Number(row.game_count) > 0) {
          const games = Number(row.game_count);
          const ppg = Number(row.for_sum) / games;
          const oppg = Number(row.against_sum) / games;
          if (ppg > 0 && oppg > 0) {
            result.set(teamName, { ppg: Math.round(ppg * 10) / 10, oppg: Math.round(oppg * 10) / 10, games });
          }
        }
      } catch (err: unknown) {
        this.logger.warn(`[hist-stats] failed for ${teamName}(${league}): ${this.errorMessage(err)}`);
      }
    }

    return result;
  }

  private async runPostSyncAutoCheck(taskName: string): Promise<void> {
    try {
      const report = await this.autoCheckService.runCheck('sync', taskName);
      this.logger.log(
        `[post-sync] basketball auto-check done: issues=${report.totalIssues}, ` +
        `auto_fixed=${report.autoFixed}, needs_manual=${report.needsManual}, duration=${report.durationMs}ms`,
      );
      if (report.totalIssues > 0) {
        const highSeverity = report.issues.filter((i) => i.severity === 'high').length;
        if (highSeverity > 0) {
          this.logger.warn(
            `[post-sync] basketball auto-check found ${highSeverity} high-severity issues, ` +
            `please review report id=${report.id}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`[post-sync] basketball auto-check failed: ${this.errorMessage(err)}`);
    }

    try {
      const fbReport = await this.footballAutoCheckService.runCheck('sync', taskName);
      this.logger.log(
        `[post-sync] football auto-check done: issues=${fbReport.totalIssues}, ` +
        `auto_fixed=${fbReport.autoFixed}, needs_manual=${fbReport.needsManual}, duration=${fbReport.durationMs}ms`,
      );
      if (fbReport.totalIssues > 0) {
        const highSeverity = fbReport.issues.filter((i) => i.severity === 'high').length;
        if (highSeverity > 0) {
          this.logger.warn(
            `[post-sync] football auto-check found ${highSeverity} high-severity issues, ` +
            `please review report id=${fbReport.id}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`[post-sync] football auto-check failed: ${this.errorMessage(err)}`);
    }
  }
}
