import { Logger } from '@nestjs/common';
import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject } from '@nestjs/common';
import { syncTaskLogs, basketballMatches } from '@server/database/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { SportteryService } from './sporttery.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { BasketballDataDrivenPredictionService } from '../basketball-prediction/basketball-data-driven.service';
import { EloHistoryService } from '../elo/elo-history.service';
import { BasketballIntelService, parseIntelFromRow } from '../basketball/basketball-intel.service';

@Automation()
export class SyncAutomationTasksService {
  private readonly logger = new Logger(SyncAutomationTasksService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sportteryService: SportteryService,
    private readonly syncSchedulerService: SyncSchedulerService,
    private readonly dataDrivenService: BasketballDataDrivenPredictionService,
    private readonly eloHistoryService: EloHistoryService,
  ) {}

  @BindTrigger('daily_wnba_full_sync')
  async dailyWnbaFullSync(): Promise<void> {
    this.logger.log('[Automation] daily_wnba_full_sync started');
    const logId = await this.startLog('daily_wnba_full_sync', 'platform-cron');
    if (!logId) {
      this.logger.log('[Automation] daily_wnba_full_sync skipped: already running');
      return;
    }
    let fbUpdated = 0;
    let bbUpdated = 0;
    const sources: string[] = [];

    try {
      try {
        const result = await (this.sportteryService as unknown as {
          syncFootball: () => Promise<{ inserted: number; updated: number; skipped: number }>;
        }).syncFootball();
        fbUpdated = result.inserted + result.updated;
        sources.push('sporttery-fb');
      } catch (err) {
        this.logger.warn(`[Automation] Football sync failed: ${this.errorMessage(err)}`);
      }

      try {
        const result = await (this.sportteryService as unknown as {
          syncBasketball: () => Promise<{ inserted: number; updated: number; skipped: number }>;
        }).syncBasketball();
        bbUpdated = result.inserted + result.updated;
        sources.push('sporttery-bb');
      } catch (err) {
        this.logger.warn(`[Automation] Basketball sync failed: ${this.errorMessage(err)}`);
      }

      try {
        await (this.sportteryService as unknown as {
          runEspnLiveSync: () => Promise<void>;
        }).runEspnLiveSync();
        sources.push('espn-live');
      } catch (err) {
        this.logger.warn(`[Automation] ESPN live sync failed: ${this.errorMessage(err)}`);
      }

      try {
        await (this.sportteryService as unknown as {
          runOddsApiSync: () => Promise<void>;
        }).runOddsApiSync();
        sources.push('odds-api');
      } catch (err) {
        this.logger.warn(`[Automation] Odds API sync failed: ${this.errorMessage(err)}`);
      }

      try {
        await (this.sportteryService as unknown as {
          runEspnSummarySync: () => Promise<void>;
        }).runEspnSummarySync();
        sources.push('espn-summary');
      } catch (err) {
        this.logger.warn(`[Automation] ESPN summary sync failed: ${this.errorMessage(err)}`);
      }

      await this.finishLog(logId, 'success', fbUpdated + bbUpdated, sources.join('+'));
      this.logger.log(
        `[Automation] daily_wnba_full_sync done: fb=${fbUpdated} bb=${bbUpdated} sources=${sources.join('+')}`,
      );
      void this.recalcBasketballPredictions('daily_wnba_full_sync');
    } catch (err) {
      const msg = this.errorMessage(err);
      await this.finishLog(logId, 'failed', 0, '', msg);
      this.logger.error(`[Automation] daily_wnba_full_sync failed: ${msg}`);
      throw err;
    }
  }

  @BindTrigger('hourly_onsale_capture')
  async hourlyOnsaleCapture(): Promise<void> {
    this.logger.log('[Automation] hourly_onsale_capture started');
    const logId = await this.startLog('hourly_onsale_capture', 'platform-cron');
    if (!logId) {
      this.logger.log('[Automation] hourly_onsale_capture skipped: already running');
      return;
    }
    let updated = 0;
    const sources: string[] = [];

    try {
      try {
        await (this.sportteryService as unknown as {
          runEspnLiveSync: () => Promise<void>;
        }).runEspnLiveSync();
        sources.push('espn-live');
      } catch (err) {
        this.logger.warn(`[Automation] ESPN live in hourly capture failed: ${this.errorMessage(err)}`);
      }

      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const dateStr = sevenDaysAgo.toISOString().slice(0, 10);
        const fb = await this.sportteryService.backfillFootballHits(dateStr);
        const bb = await this.sportteryService.backfillBasketballHits(dateStr);
        updated = fb.updated + bb.updated;
        sources.push('hit-backfill');
      } catch (err) {
        this.logger.warn(`[Automation] Hit backfill in hourly capture failed: ${this.errorMessage(err)}`);
      }

      await this.finishLog(logId, 'success', updated, sources.join('+'));
      this.logger.log(
        `[Automation] hourly_onsale_capture done: updated=${updated} sources=${sources.join('+')}`,
      );
      void this.recalcBasketballPredictions('hourly_onsale_capture');
    } catch (err) {
      const msg = this.errorMessage(err);
      await this.finishLog(logId, 'failed', 0, '', msg);
      this.logger.error(`[Automation] hourly_onsale_capture failed: ${msg}`);
      throw err;
    }
  }

  @BindTrigger('daily_review')
  async dailyReview(): Promise<void> {
    this.logger.log('[Automation] daily_review started');
    const logId = await this.startLog('daily_review', 'platform-cron');
    if (!logId) {
      this.logger.log('[Automation] daily_review skipped: already running');
      return;
    }
    let hitBackfilled = 0;
    const sources: string[] = [];

    try {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const dateStr = sevenDaysAgo.toISOString().slice(0, 10);
        const fb = await this.sportteryService.backfillFootballHits(dateStr);
        const bb = await this.sportteryService.backfillBasketballHits(dateStr);
        hitBackfilled = fb.updated + bb.updated;
        sources.push('hit-backfill');
      } catch (err) {
        this.logger.warn(`[Automation] Hit backfill in daily review failed: ${this.errorMessage(err)}`);
      }

      try {
        await (this.sportteryService as unknown as {
          runEspnSummarySync: () => Promise<void>;
        }).runEspnSummarySync();
        sources.push('espn-summary');
      } catch (err) {
        this.logger.warn(`[Automation] ESPN summary in daily review failed: ${this.errorMessage(err)}`);
      }

      let reviewsGenerated = 0;
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const get = (type: string): string => parts.find((x) => x.type === type)?.value ?? '00';
      const todayStr = `${get('year')}-${get('month')}-${get('day')}`;
      try {
        const bbReview = await this.syncSchedulerService.generateDailyReview('basketball', todayStr);
        reviewsGenerated += bbReview;
      } catch (err) {
        this.logger.warn(`Basketball daily review generation failed: ${this.errorMessage(err)}`);
      }
      try {
        const fbReview = await this.syncSchedulerService.generateDailyReview('football', todayStr);
        reviewsGenerated += fbReview;
      } catch (err) {
        this.logger.warn(`Football daily review generation failed: ${this.errorMessage(err)}`);
      }

      await this.finishLog(logId, 'success', hitBackfilled, sources.join('+'));
      this.logger.log(
        `[Automation] daily_review done: hitBackfilled=${hitBackfilled} reviewsGenerated=${reviewsGenerated} sources=${sources.join('+')}`,
      );
    } catch (err) {
      const msg = this.errorMessage(err);
      await this.finishLog(logId, 'failed', 0, '', msg);
      this.logger.error(`[Automation] daily_review failed: ${msg}`);
      throw err;
    }
  }

  private async recalcBasketballPredictions(trigger: string): Promise<number> {
    const sources = ['qiumibao', 'sporttery', 'espn'];
    let totalRecalc = 0;
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
            injuries: basketballMatches.injuries,
            recentForm: basketballMatches.recentForm,
            h2hHistory: basketballMatches.h2hHistory,
            intelSummary: basketballMatches.intelSummary,
            intel: basketballMatches.intel,
          })
          .from(basketballMatches)
          .where(
            and(
              eq(basketballMatches.source, src),
              eq(basketballMatches.matchStatus, 'upcoming'),
              eq(basketballMatches.isPredictionFrozen, false),
            ),
          );

        const v11Rows = rows.filter((r) => r.predEngineVersion === 'v11.0-unified');
        const ddRows = rows.filter((r) =>
          !r.predEngineVersion ||
          r.predEngineVersion.startsWith('data-driven') ||
          r.predEngineVersion.startsWith('v10') ||
          r.predEngineVersion.startsWith('v9') ||
          r.predEngineVersion.startsWith('v8') ||
          r.predEngineVersion.startsWith('v7'),
        );

        if (ddRows.length > 0) {
          const preds = await this.dataDrivenService.predictAllUpcomingBySource(src);
          if (preds.length > 0) {
            const result = await this.dataDrivenService.applyPredictions(preds, { force: true });
            totalRecalc += result.updated;
          }
          const livePreds = await this.dataDrivenService.predictLiveBySource(src);
          if (livePreds.length > 0) {
            const liveResult = await this.dataDrivenService.applyPredictions(livePreds, { force: true });
            totalRecalc += liveResult.updated;
          }
        }

        if (v11Rows.length > 0) {
          const v11Updated = await this.recalcV11Basketball(v11Rows);
          totalRecalc += v11Updated;
          this.logger.log(
            `[Automation][recalc][${trigger}] V11 ${v11Updated}/${v11Rows.length} recalculated (source=${src})`,
          );
        }
      } catch (err: unknown) {
        this.logger.warn(`[Automation][recalc][${trigger}] source=${src} failed: ${this.errorMessage(err)}`);
      }
    }
    if (totalRecalc > 0) {
      this.logger.log(`[Automation][recalc][${trigger}] recalculated=${totalRecalc}`);
    }
    return totalRecalc;
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
      injuries: unknown;
      recentForm: unknown;
      h2hHistory: unknown;
      intelSummary: string | null;
      intel: string | null;
    }>,
  ): Promise<number> {
    let updated = 0;

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
          }
        }
        if (!awayPpg && row.awayTeam) {
          const stat = histStatsMap.get(row.awayTeam);
          if (stat && stat.ppg > 0) {
            awayPpg = stat.ppg;
            awayOppg = stat.oppg;
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
            predEngineVersion: 'v11.0-unified',
            predGeneratedAt: new Date(),
          };
          (this.sportteryService as unknown as {
            finalizeBasketballPick: (patch: Record<string, unknown>, a: null, b: null, league: string) => void;
            appendBasketballPredictionHistory: (patch: Record<string, unknown>, trig: string) => void;
          }).finalizeBasketballPick(patch, null, null, rowLeague);
          (this.sportteryService as unknown as {
            appendBasketballPredictionHistory: (patch: Record<string, unknown>, trig: string) => void;
          }).appendBasketballPredictionHistory(patch, 'automation_v11_recalc');
          await this.db.update(basketballMatches)
            .set(patch)
            .where(eq(basketballMatches.id, row.id));
          updated += 1;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `[Automation][recalc] V11 failed for ${row.matchNo}: ${this.errorMessage(err)}`,
        );
      }
    }
    return updated;
  }

  private async startLog(taskName: string, trigger: string): Promise<string> {
    let logId = '';
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);

      const [existing] = await tx.select({ id: syncTaskLogs.id })
        .from(syncTaskLogs)
        .where(sql`${syncTaskLogs.taskName} = ${taskName} AND ${syncTaskLogs.status} = 'running'`)
        .limit(1);

      if (existing) {
        const [skipped] = await tx.insert(syncTaskLogs).values({
          taskName,
          taskType: 'scheduled',
          trigger,
          status: 'skipped',
          startedAt: new Date(),
          finishedAt: new Date(),
          errorMessage: `skipped: another ${taskName} is already running (id=${existing.id})`,
        }).returning({ id: syncTaskLogs.id });
        logId = '';
        return;
      }

      const [inserted] = await tx.insert(syncTaskLogs).values({
        taskName,
        taskType: 'scheduled',
        trigger,
        status: 'running',
        startedAt: new Date(),
      }).returning({ id: syncTaskLogs.id });
      logId = inserted?.id ?? '';
    });
    return logId;
  }

  private async finishLog(
    logId: string,
    status: string,
    recordsUpdated: number,
    dataSource: string,
    errorMessage?: string,
  ): Promise<void> {
    if (!logId) return;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      await tx.update(syncTaskLogs).set({
        status,
        finishedAt: new Date(),
        recordsUpdated,
        dataSource,
        errorMessage,
      }).where(eq(syncTaskLogs.id, logId));
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
        this.logger.warn(`[auto-hist-stats] failed for ${teamName}(${league}): ${this.errorMessage(err)}`);
      }
    }

    return result;
  }
}
