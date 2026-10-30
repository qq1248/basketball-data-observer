import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { basketballMatches, matchAutoCheckReports, syncTaskLogs } from '@server/database/schema';
import { eq, and, isNull, isNotNull, gt, lt, sql, desc, count, inArray } from 'drizzle-orm';
import type { AutoCheckIssue, AutoCheckSummary, AutoCheckReport } from '@shared/api.interface';
import { BasketballFlashscoreService } from './flashscore.service';
import { SportteryService } from '../sporttery/sporttery.service';

type CheckCategory =
  | 'integrity'
  | 'status_flow'
  | 'period_display'
  | 'data_correctness'
  | 'hit_backfill'
  | 'model_baseline'
  | 'sporttery_coverage'
  | 'sync_health';

interface CheckMatchRow {
  id: string;
  matchNo: string | null;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Date | string;
  matchStatus: string;
  homeScore: number | null;
  awayScore: number | null;
  handicapLineNum: string | number | null;
  totalLineNum: string | number | null;
  handicapRecommendation: string | null;
  handicapPick: string | null;
  totalDirection: string | null;
  totalPick: string | null;
  handicapCoverProb: number;
  overProb: number;
  underProb: number;
  confidence: number;
  predictionDirection: string;
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
  livePeriod: number | null;
  liveClock: string | null;
  liveScoreSource: string;
  livePeriodEstimated: boolean | null;
  resultPendingReason: string | null;
  predEngineVersion: string | null;
  teamStats: unknown;
  recentForm: unknown;
  h2hHistory: unknown;
  injuries: unknown;
  injuryAdjustApplied: string | number | null;
  predictedTotal: string | number | null;
  businessDate: Date | string | null;
  source: string;
  lastScoreAt: Date | string | null;
}

@Injectable()
export class BasketballAutoCheckService {
  private readonly logger = new Logger(BasketballAutoCheckService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly flashscoreService: BasketballFlashscoreService,
    @Inject(forwardRef(() => SportteryService)) private readonly sportteryService: SportteryService,
  ) {}

  async runCheck(triggerSource: string = 'manual', triggerTask?: string): Promise<AutoCheckReport> {
    const startTime = Date.now();
    const issues: AutoCheckIssue[] = [];

    try {
      const table = basketballMatches;
      const now = new Date();

      const allRows = await this.db
        .select({
          id: table.id,
          matchNo: table.matchNo,
          league: table.league,
          homeTeam: table.homeTeam,
          awayTeam: table.awayTeam,
          kickoffTime: table.kickoffTime,
          matchStatus: table.matchStatus,
          homeScore: table.homeScore,
          awayScore: table.awayScore,
          handicapLineNum: table.handicapLineNum,
          totalLineNum: table.totalLineNum,
          handicapRecommendation: table.handicapRecommendation,
          handicapPick: table.handicapPick,
          totalDirection: table.totalDirection,
          totalPick: table.totalPick,
          handicapCoverProb: table.handicapCoverProb,
          overProb: table.overProb,
          underProb: table.underProb,
          confidence: table.confidence,
          predictionDirection: table.predictionDirection,
          hitWdw: table.hitWdw,
          hitHandicap: table.hitHandicap,
          hitOverunder: table.hitOverunder,
          livePeriod: table.livePeriod,
          liveClock: table.liveClock,
          liveScoreSource: table.liveScoreSource,
          livePeriodEstimated: table.livePeriodEstimated,
          resultPendingReason: table.resultPendingReason,
          predEngineVersion: table.predEngineVersion,
          teamStats: table.teamStats,
          recentForm: table.recentForm,
          h2hHistory: table.h2hHistory,
          injuries: table.injuries,
          injuryAdjustApplied: table.injuryAdjustApplied,
          predictedTotal: table.predictedTotal,
          businessDate: table.businessDate,
          source: table.source,
          lastScoreAt: table.lastScoreAt,
        })
        .from(table)
        .where(
          and(
            gt(table.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '21 days'`),
            lt(table.kickoffTime, sql`CURRENT_TIMESTAMP + INTERVAL '3 days'`),
          ),
        )
        .orderBy(table.kickoffTime);

      const upcoming = allRows.filter((r) => r.matchStatus === 'upcoming');
      const live = allRows.filter((r) => r.matchStatus === 'live');
      const finished = allRows.filter((r) => r.matchStatus === 'finished');

      const summary: AutoCheckSummary = {
        integrity: { total: allRows.length, predicted: 0, emptyFields: 0, duplicateMatchNos: 0 },
        statusFlow: { finished: finished.length, pendingHit: 0, stuckLive: 0, stuckLiveAutoFixed: 0, stuckLivePending: 0, wrongFinished: 0, staleUpcoming: 0 },
        periodDisplay: { reliable: 0, estimated: 0, misleading: 0, otMislabeled: 0 },
        dataCorrectness: { lineValid: 0, directionConsistent: 0, scoreAnomalies: 0 },
        hitBackfill: { finishedWithHit: 0, finishedMissingHit: 0, hitMismatch: 0 },
        modelBaseline: { v11Count: 0, baselineByLeague: {}, emptyFeatures: 0, injuryAdjustApplied: 0 },
      };

      this.checkIntegrity(allRows, issues, summary);
      await this.checkAndFixStuckLive(allRows, now, issues, summary);
      this.checkPeriodDisplay(live, issues, summary);
      this.checkDataCorrectness(allRows, issues, summary);
      await this.checkHitBackfill(finished, issues, summary);
      this.checkModelBaseline(upcoming, issues, summary);
      await this.checkSportteryCoverage(upcoming, issues, summary);
      await this.checkSyncHealth(issues, summary);

      const autoFixed = issues.filter((i) => i.fixStatus === 'fixed').length;
      const needsManual = issues.filter((i) => i.autoFixable === false || i.fixStatus === 'pending').length;
      const durationMs = Date.now() - startTime;

      const [inserted] = await this.db
        .insert(matchAutoCheckReports)
        .values({
          checkType: 'basketball',
          triggerSource,
          triggerTask: triggerTask || null,
          status: 'completed',
          totalMatches: allRows.length,
          upcomingCount: upcoming.length,
          liveCount: live.length,
          finishedCount: finished.length,
          totalIssues: issues.length,
          autoFixed,
          needsManual,
          durationMs,
          summary: summary as unknown as Record<string, unknown>,
          issues: issues as unknown as Record<string, unknown>[],
        })
        .returning({ id: matchAutoCheckReports.id });

      this.logger.log(
        `[auto-check] completed: total=${allRows.length}, issues=${issues.length}, ` +
        `auto_fixed=${autoFixed}, needs_manual=${needsManual}, duration=${durationMs}ms`,
      );

      return this.getReportById(inserted!.id);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[auto-check] failed', errMsg);

      await this.db
        .insert(matchAutoCheckReports)
        .values({
          checkType: 'basketball',
          triggerSource,
          triggerTask: triggerTask || null,
          status: 'failed',
          totalMatches: 0,
          upcomingCount: 0,
          liveCount: 0,
          finishedCount: 0,
          totalIssues: 0,
          autoFixed: 0,
          needsManual: 0,
          durationMs,
          errorMessage: errMsg,
          summary: {},
          issues: [],
        });

      throw error;
    }
  }

  async getReportById(id: string): Promise<AutoCheckReport> {
    const rows = await this.db
      .select()
      .from(matchAutoCheckReports)
      .where(eq(matchAutoCheckReports.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new Error('Report not found');
    }
    return this.mapReport(rows[0]);
  }

  async getReportList(page: number = 1, pageSize: number = 20): Promise<{
    items: AutoCheckReport[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const offset = (page - 1) * pageSize;

    const [countResult] = await this.db
      .select({ count: count() })
      .from(matchAutoCheckReports);

    const rows = await this.db
      .select()
      .from(matchAutoCheckReports)
      .orderBy(desc(matchAutoCheckReports.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => this.mapReport(r)),
      total: Number(countResult?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getLatestReport(): Promise<AutoCheckReport | null> {
    const rows = await this.db
      .select()
      .from(matchAutoCheckReports)
      .orderBy(desc(matchAutoCheckReports.createdAt))
      .limit(1);

    return rows.length > 0 ? this.mapReport(rows[0]) : null;
  }

  private mapReport(row: typeof matchAutoCheckReports.$inferSelect): AutoCheckReport {
    return {
      id: row.id,
      checkType: row.checkType,
      triggerSource: row.triggerSource,
      triggerTask: row.triggerTask,
      status: row.status,
      totalMatches: row.totalMatches,
      upcomingCount: row.upcomingCount,
      liveCount: row.liveCount,
      finishedCount: row.finishedCount,
      totalIssues: row.totalIssues,
      autoFixed: row.autoFixed,
      needsManual: row.needsManual,
      durationMs: row.durationMs,
      errorMessage: row.errorMessage,
      summary: (row.summary ?? {}) as AutoCheckSummary,
      issues: (row.issues ?? []) as AutoCheckIssue[],
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    };
  }

  private addIssue(
    issues: AutoCheckIssue[],
    category: CheckCategory,
    subCategory: string,
    severity: 'low' | 'medium' | 'high',
    row: { id: string; matchNo: string | null; league: string | null; homeTeam: string; awayTeam: string },
    detail: string,
    autoFixable: boolean = false,
  ): void {
    issues.push({
      category,
      subCategory,
      severity,
      matchId: row.id,
      matchNo: row.matchNo || '',
      league: row.league || '',
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      detail,
      autoFixable,
      fixStatus: autoFixable ? 'pending' : 'pending',
      fixDetail: '',
    });
  }

  private checkIntegrity(
    rows: CheckMatchRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    const predicted = rows.filter(
      (r) => r.predictionDirection && r.predictionDirection !== '观望' && r.confidence > 0,
    ).length;
    summary.integrity.predicted = predicted;

    const emptyFields = rows.filter(
      (r) => r.matchStatus === 'upcoming' && (
        !r.handicapLineNum || Number(r.handicapLineNum) === 0 ||
        !r.totalLineNum || Number(r.totalLineNum) === 0 ||
        !r.predictionDirection || r.predictionDirection === ''
      ),
    );
    summary.integrity.emptyFields = emptyFields.length;

    for (const row of emptyFields) {
      const isQmbMinor = row.matchNo?.startsWith('QMB-qmb-');
      if (isQmbMinor) continue;

      const missing: string[] = [];
      if (!row.handicapLineNum || Number(row.handicapLineNum) === 0) missing.push('让分盘口');
      if (!row.totalLineNum || Number(row.totalLineNum) === 0) missing.push('大小分盘口');
      if (!row.predictionDirection || row.predictionDirection === '') missing.push('预测方向');
      this.addIssue(issues, 'integrity', 'empty_fields', 'high', row,
        `即将开赛但缺少: ${missing.join('、')}`);
    }

    const matchNoMap = new Map<string, CheckMatchRow[]>();
    for (const row of rows) {
      if (row.matchNo && row.businessDate) {
        const key = `${row.matchNo}_${row.businessDate}`;
        const arr = matchNoMap.get(key) || [];
        arr.push(row);
        matchNoMap.set(key, arr);
      }
    }

    let duplicateCount = 0;
    for (const [key, matches] of matchNoMap) {
      if (matches.length > 1) {
        duplicateCount += 1;
        for (const row of matches) {
          this.addIssue(issues, 'integrity', 'duplicate_match_no', 'high', row,
            `比赛编号+交易日重复 (${key})，共${matches.length}条记录`);
        }
      }
    }
    summary.integrity.duplicateMatchNos = duplicateCount;
  }

  private async checkAndFixStuckLive(
    rows: CheckMatchRow[],
    now: Date,
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): Promise<void> {
    const nowMs = now.getTime();
    const oneEightyMinMs = 180 * 60 * 1000;
    const table = basketballMatches;

    let stuckLiveAutoFixable = 0;
    let stuckLiveFixed = 0;
    let stuckLivePending = 0;
    let wrongFinished = 0;
    let pendingHit = 0;

    for (const row of rows) {
      const kickoffMs = row.kickoffTime instanceof Date
        ? row.kickoffTime.getTime()
        : new Date(row.kickoffTime).getTime();

      if (row.matchStatus === 'live' && nowMs - kickoffMs > oneEightyMinMs) {
        const lastScoreMs = row.lastScoreAt
          ? (row.lastScoreAt instanceof Date ? row.lastScoreAt.getTime() : new Date(row.lastScoreAt).getTime())
          : kickoffMs;
        const stagnantMinutes = Math.round((nowMs - lastScoreMs) / 60000);

        const scoreValid = this.isScoreValid(row);
        const isFinalLike = row.liveClock === '完' ||
          row.liveScoreSource === 'qiumibao-final-pending' ||
          row.resultPendingReason?.includes('qiumibao-final-pending');

        if (isFinalLike && scoreValid) {
          stuckLiveAutoFixable += 1;
          const fixedIssue: AutoCheckIssue = {
            category: 'status_flow',
            subCategory: 'stuck_live_auto_fix',
            severity: 'high',
            matchId: row.id,
            matchNo: row.matchNo || '',
            league: row.league || '',
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            detail: `卡live超3小时且比分合理（${row.homeScore}-${row.awayScore}），自动切finished并回打命中`,
            autoFixable: true,
            fixStatus: 'pending',
            fixDetail: '',
          };
          issues.push(fixedIssue);

          try {
            const hit = this.calcHit(row);
            await this.db.update(table)
              .set({
                matchStatus: 'finished',
                hitWdw: hit.wdw,
                hitHandicap: hit.handicap,
                hitOverunder: hit.overunder,
                resultPendingReason: 'auto-check-stuck-live-fixed',
              })
              .where(eq(table.id, row.id));
            stuckLiveFixed += 1;
            stuckLiveAutoFixable -= 1;
            fixedIssue.fixStatus = 'fixed';
            fixedIssue.fixDetail = `已切finished；命中：胜负${hit.wdw === null ? 'N/A' : hit.wdw ? '红' : '黑'}，让分${hit.handicap === null ? 'N/A' : hit.handicap ? '红' : '黑'}，大小分${hit.overunder === null ? 'N/A' : hit.overunder ? '红' : '黑'}`;
          } catch (fixErr) {
            fixedIssue.fixStatus = 'failed';
            fixedIssue.fixDetail = `自动修复失败: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`;
          }
        } else if (row.resultPendingReason?.includes('espn-pending-review')) {
          this.addIssue(issues, 'status_flow', 'pending_espn_review', 'medium', row,
            `已开赛${Math.round((nowMs - kickoffMs) / 60000)}分钟，ESPN终场待复核，比分已${stagnantMinutes}分钟未变动`);
        } else if (row.resultPendingReason?.includes('qiumibao-final-pending')) {
          this.addIssue(issues, 'status_flow', 'pending_espn_final', 'medium', row,
            `球美宝标终场但等待ESPN确认，已${stagnantMinutes}分钟未更新`);
        } else if (row.homeScore == null || row.awayScore == null) {
          const flashscoreResult = await this.tryFlashscoreBackfill(row, table);
          if (flashscoreResult.fixed) {
            stuckLiveFixed += 1;
            const fixedIssue: AutoCheckIssue = {
              category: 'status_flow',
              subCategory: 'stuck_live_flashscore_backfill',
              severity: 'high',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `卡live超3小时且原数据源无比分，已从Flashscore补录比分（${flashscoreResult.homeScore}-${flashscoreResult.awayScore}），自动切finished并回打命中`,
              autoFixable: true,
              fixStatus: 'fixed',
              fixDetail: flashscoreResult.fixDetail || '',
            };
            issues.push(fixedIssue);
          } else if (stagnantMinutes >= 2880) {
            await this.db.update(table)
              .set({
                matchStatus: 'result_pending' as const,
                resultPendingReason: 'stale_live_unverifiable',
              })
              .where(eq(table.id, row.id));
            stuckLiveFixed += 1;
            const fixedIssue: AutoCheckIssue = {
              category: 'status_flow',
              subCategory: 'stuck_live_stale_moved',
              severity: 'medium',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `卡live超48小时且Flashscore等权威源无匹配，已自动移至result_pending（源赛程可能有误）`,
              autoFixable: true,
              fixStatus: 'fixed',
              fixDetail: 'stale_live_unverifiable',
            };
            issues.push(fixedIssue);
          } else {
            stuckLivePending += 1;
            this.addIssue(issues, 'status_flow', 'stuck_live_no_score', 'medium', row,
              `卡live超3小时但无比分数据（数据源未覆盖），已${stagnantMinutes}分钟未变动`);
          }
        } else if (!scoreValid) {
          const isZeroZero = row.homeScore === 0 && row.awayScore === 0;
          const isQmbMinor = row.matchNo?.startsWith('QMB-qmb-');
          if (isZeroZero && isQmbMinor && stagnantMinutes >= 2880) {
            await this.db.update(table)
              .set({
                matchStatus: 'result_pending' as const,
                resultPendingReason: 'stale_live_zero_zero_cancelled',
              })
              .where(eq(table.id, row.id));
            stuckLiveFixed += 1;
            const fixedIssue: AutoCheckIssue = {
              category: 'status_flow',
              subCategory: 'stuck_live_cancelled_moved',
              severity: 'low',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `卡live超48小时且0-0无变动（QMB小联赛，大概率取消/停赛），已自动移至result_pending`,
              autoFixable: true,
              fixStatus: 'fixed',
              fixDetail: 'stale_live_zero_zero_cancelled',
            };
            issues.push(fixedIssue);
          } else {
            stuckLivePending += 1;
            this.addIssue(issues, 'status_flow', 'stuck_live_suspect_score', 'high', row,
              `卡live超3小时且比分异常（${row.homeScore}-${row.awayScore}），不敢自动切终场，已${stagnantMinutes}分钟未变动`);
          }
        } else if (stagnantMinutes >= 360) {
          const flashscoreResult = await this.tryFlashscoreBackfill(row, table);
          if (flashscoreResult.fixed) {
            stuckLiveFixed += 1;
            const fixedIssue: AutoCheckIssue = {
              category: 'status_flow',
              subCategory: 'stuck_live_flashscore_verify',
              severity: 'high',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `卡live超6小时，Flashscore确认终场比分（${flashscoreResult.homeScore}-${flashscoreResult.awayScore}），自动切finished并回打命中`,
              autoFixable: true,
              fixStatus: 'fixed',
              fixDetail: flashscoreResult.fixDetail || '',
            };
            issues.push(fixedIssue);
          } else if (stagnantMinutes >= 2880) {
            await this.db.update(table)
              .set({
                matchStatus: 'result_pending' as const,
                resultPendingReason: 'stale_live_unverifiable',
              })
              .where(eq(table.id, row.id));
            stuckLiveFixed += 1;
            const fixedIssue: AutoCheckIssue = {
              category: 'status_flow',
              subCategory: 'stuck_live_stale_moved',
              severity: 'medium',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `卡live超48小时且Flashscore无匹配终场，已自动移至result_pending（源赛程可能有误）`,
              autoFixable: true,
              fixStatus: 'fixed',
              fixDetail: 'stale_live_unverifiable',
            };
            issues.push(fixedIssue);
          } else {
            stuckLivePending += 1;
            this.addIssue(issues, 'status_flow', 'stuck_live', 'high', row,
              `比赛卡live状态超3小时，比分已${stagnantMinutes}分钟未变动，需人工确认`);
          }
        } else {
          stuckLivePending += 1;
          this.addIssue(issues, 'status_flow', 'stuck_live', 'high', row,
            `比赛卡live状态超3小时，比分已${stagnantMinutes}分钟未变动，需人工确认`);
        }
      }

      if (row.matchStatus === 'finished' && row.homeScore == null) {
        wrongFinished += 1;
        this.addIssue(issues, 'status_flow', 'finished_no_score', 'high', row,
          '状态为finished但无比分数据');
      }

      if (row.matchStatus === 'finished' && row.homeScore != null) {
        const hasPrediction =
          (row.predictionDirection && row.predictionDirection !== '观望') ||
          (row.handicapPick && row.handicapPick !== '' && row.handicapPick !== '观望') ||
          (row.totalPick && row.totalPick !== '' && row.totalPick !== '观望');
        const hasHit = row.hitWdw != null || row.hitHandicap != null || row.hitOverunder != null;
        if (hasPrediction && !hasHit) {
          pendingHit += 1;
          this.addIssue(issues, 'status_flow', 'pending_hit_backfill', 'medium', row,
            '比赛已结束且有预测但命中未回填', true);
        }
      }
    }

    summary.statusFlow.stuckLive = stuckLiveFixed + stuckLiveAutoFixable + stuckLivePending;
    summary.statusFlow.stuckLiveAutoFixed = stuckLiveFixed;
    summary.statusFlow.stuckLivePending = stuckLivePending;
    summary.statusFlow.wrongFinished = wrongFinished;
    summary.statusFlow.pendingHit = pendingHit;
  }

  private isScoreValid(row: CheckMatchRow): boolean {
    if (row.homeScore == null || row.awayScore == null) return false;
    const h = row.homeScore;
    const a = row.awayScore;
    if (h < 20 || a < 20) return false;
    const total = h + a;
    if (total < 60 || total > 300) return false;
    if (Math.abs(h - a) > 80) return false;
    return true;
  }

  private calcHit(row: CheckMatchRow): { wdw: boolean | null; handicap: boolean | null; overunder: boolean | null } {
    const wdw: boolean | null = null;
    const handicap: boolean | null = null;
    const overunder: boolean | null = null;

    const h = row.homeScore;
    const a = row.awayScore;
    if (h == null || a == null) return { wdw, handicap, overunder };

    const result: { wdw: boolean | null; handicap: boolean | null; overunder: boolean | null } = { wdw: null, handicap: null, overunder: null };

    if (row.predictionDirection === '主胜') result.wdw = h > a;
    else if (row.predictionDirection === '客胜') result.wdw = h < a;

    if (row.handicapLineNum != null && Number(row.handicapLineNum) !== 0) {
      const line = Number(row.handicapLineNum);
      const cover = (h - a) + line;
      if (row.handicapPick === '让分主胜' && cover !== 0) result.handicap = cover > 0;
      else if (row.handicapPick === '让分客胜' && cover !== 0) result.handicap = cover < 0;
    }

    if (row.totalLineNum != null && Number(row.totalLineNum) > 0) {
      const line = Number(row.totalLineNum);
      const total = h + a;
      if (row.totalPick === '大分' && total !== line) result.overunder = total > line;
      else if (row.totalPick === '小分' && total !== line) result.overunder = total < line;
    }

    return result;
  }

  private checkPeriodDisplay(
    liveRows: CheckMatchRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    let reliable = 0;
    let estimated = 0;
    let misleading = 0;
    let otMislabeled = 0;

    for (const row of liveRows) {
      const period = row.livePeriod ?? 0;

      if (period > 0 && period <= 4 && !row.livePeriodEstimated) {
        reliable += 1;
      } else if (row.livePeriodEstimated) {
        estimated += 1;
      }

      if (period === 4 && row.liveClock === '0:00') {
        misleading += 1;
        this.addIssue(issues, 'period_display', 'q4_zero_zero', 'high', row,
          '第4节 0:00 显示可能造成终场误导');
      }

      if (period > 4) {
        if (row.homeScore != null && row.awayScore != null) {
          const total = row.homeScore + row.awayScore;
          if (total < 100) {
            otMislabeled += 1;
            this.addIssue(issues, 'period_display', 'suspicious_ot', 'medium', row,
              `节次=${period}显示加时但总分只有${total}分，疑似误判`);
          } else {
            reliable += 1;
          }
        }
      }

      if (!row.liveScoreSource || row.liveScoreSource === '') {
        this.addIssue(issues, 'period_display', 'no_live_source', 'medium', row,
          'live状态但无比分数据源');
      }
    }

    summary.periodDisplay.reliable = reliable;
    summary.periodDisplay.estimated = estimated;
    summary.periodDisplay.misleading = misleading;
    summary.periodDisplay.otMislabeled = otMislabeled;
  }

  private checkDataCorrectness(
    rows: CheckMatchRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    let lineValid = 0;
    let directionConsistent = 0;
    let scoreAnomalies = 0;

    for (const row of rows) {
      const hLine = Number(row.handicapLineNum) || 0;
      const tLine = Number(row.totalLineNum) || 0;

      if (hLine !== 0 && tLine > 50) {
        lineValid += 1;
      }

      if (row.handicapPick && row.handicapRecommendation) {
        if (row.handicapPick === row.handicapRecommendation) {
          directionConsistent += 1;
        } else if (row.matchStatus === 'upcoming') {
          this.addIssue(issues, 'data_correctness', 'pick_recommendation_mismatch', 'high', row,
            `让分方向不一致: pick=${row.handicapPick}, recommendation=${row.handicapRecommendation}`, true);
        }
      }

      if (row.totalPick && row.totalDirection) {
        if (row.totalPick !== row.totalDirection && row.matchStatus === 'upcoming') {
          this.addIssue(issues, 'data_correctness', 'total_direction_mismatch', 'high', row,
            `大小分方向不一致: pick=${row.totalPick}, direction=${row.totalDirection}`, true);
        }
      }

      if (row.matchStatus === 'finished' && row.homeScore != null && row.awayScore != null) {
        const h = row.homeScore;
        const a = row.awayScore;
        const isQmbMinor = row.matchNo?.startsWith('QMB-qmb-');
        if ((h < 20 || a < 20) && !isQmbMinor) {
          scoreAnomalies += 1;
          this.addIssue(issues, 'data_correctness', 'suspicious_low_score', 'medium', row,
            `终场比分过低: ${h}-${a}`);
        }
        if (h + a > 300) {
          scoreAnomalies += 1;
          this.addIssue(issues, 'data_correctness', 'suspicious_high_score', 'low', row,
            `终场总分过高: ${h + a}分`);
        }
        if (Math.abs(h - a) > 80) {
          scoreAnomalies += 1;
          this.addIssue(issues, 'data_correctness', 'suspicious_blowout', 'low', row,
            `分差过大: ${Math.abs(h - a)}分`);
        }
      }

      if (row.matchStatus === 'upcoming') {
        const over = Number(row.overProb) || 50;
        const under = Number(row.underProb) || 50;
        if (Math.abs(over + under - 100) > 5) {
          this.addIssue(issues, 'data_correctness', 'ou_prob_sum_error', 'high', row,
            `大小分概率和=${over + under}%，偏离100%`, true);
        }
      }
    }

    summary.dataCorrectness.lineValid = lineValid;
    summary.dataCorrectness.directionConsistent = directionConsistent;
    summary.dataCorrectness.scoreAnomalies = scoreAnomalies;
  }

  private async checkHitBackfill(
    finishedRows: CheckMatchRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): Promise<void> {
    let finishedWithHit = 0;
    let finishedMissingHit = 0;
    let hitMismatch = 0;
    const table = basketballMatches;

    for (const row of finishedRows) {
      if (row.homeScore == null || row.awayScore == null) continue;

      const h = row.homeScore;
      const a = row.awayScore;

      let expectedWdw: boolean | null = null;
      if (row.predictionDirection === '主胜') expectedWdw = h > a;
      else if (row.predictionDirection === '客胜') expectedWdw = h < a;

      if (expectedWdw !== null && row.hitWdw != null) {
        if (row.hitWdw !== expectedWdw) {
          hitMismatch += 1;
          const issue: AutoCheckIssue = {
            category: 'hit_backfill',
            subCategory: 'wdw_hit_mismatch',
            severity: 'high',
            matchId: row.id,
            matchNo: row.matchNo || '',
            league: row.league || '',
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            detail: `主客胜命中不一致: 实际${h}-${a}，预测${row.predictionDirection}，DB存${row.hitWdw}`,
            autoFixable: true,
            fixStatus: 'pending',
            fixDetail: '',
          };
          issues.push(issue);
          try {
            await this.db.update(table)
              .set({ hitWdw: expectedWdw })
              .where(eq(table.id, row.id));
            issue.fixStatus = 'fixed';
            issue.fixDetail = `已修正为${expectedWdw ? '红' : '黑'}`;
          } catch (fixErr) {
            issue.fixStatus = 'failed';
            issue.fixDetail = `自动修复失败: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`;
          }
        } else {
          finishedWithHit += 1;
        }
      } else if (expectedWdw !== null && row.hitWdw == null) {
        finishedMissingHit += 1;
      }

      if (row.handicapLineNum != null && Number(row.handicapLineNum) !== 0) {
        const line = Number(row.handicapLineNum);
        const cover = (h - a) + line;
        let expected: boolean | null = null;
        if (row.handicapPick === '让分主胜' && cover !== 0) expected = cover > 0;
        else if (row.handicapPick === '让分客胜' && cover !== 0) expected = cover < 0;

        if (expected !== null && row.hitHandicap != null) {
          if (row.hitHandicap !== expected) {
            hitMismatch += 1;
            const issue: AutoCheckIssue = {
              category: 'hit_backfill',
              subCategory: 'handicap_hit_mismatch',
              severity: 'high',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `让分命中不一致: 实际净胜${h - a}，线${line}，pick=${row.handicapPick}，DB存${row.hitHandicap}`,
              autoFixable: true,
              fixStatus: 'pending',
              fixDetail: '',
            };
            issues.push(issue);
            try {
              await this.db.update(table)
                .set({ hitHandicap: expected })
                .where(eq(table.id, row.id));
              issue.fixStatus = 'fixed';
              issue.fixDetail = `已修正为${expected ? '红' : '黑'}`;
            } catch (fixErr) {
              issue.fixStatus = 'failed';
              issue.fixDetail = `自动修复失败: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`;
            }
          }
        }
      }

      if (row.totalLineNum != null && Number(row.totalLineNum) > 0) {
        const line = Number(row.totalLineNum);
        const total = h + a;
        let expected: boolean | null = null;
        if (row.totalPick === '大分' && total !== line) expected = total > line;
        else if (row.totalPick === '小分' && total !== line) expected = total < line;

        if (expected !== null && row.hitOverunder != null) {
          if (row.hitOverunder !== expected) {
            hitMismatch += 1;
            const issue: AutoCheckIssue = {
              category: 'hit_backfill',
              subCategory: 'ou_hit_mismatch',
              severity: 'high',
              matchId: row.id,
              matchNo: row.matchNo || '',
              league: row.league || '',
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              detail: `大小分命中不一致: 实际总分${total}，线${line}，pick=${row.totalPick}，DB存${row.hitOverunder}`,
              autoFixable: true,
              fixStatus: 'pending',
              fixDetail: '',
            };
            issues.push(issue);
            try {
              await this.db.update(table)
                .set({ hitOverunder: expected })
                .where(eq(table.id, row.id));
              issue.fixStatus = 'fixed';
              issue.fixDetail = `已修正为${expected ? '红' : '黑'}`;
            } catch (fixErr) {
              issue.fixStatus = 'failed';
              issue.fixDetail = `自动修复失败: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`;
            }
          }
        }
      }
    }

    summary.hitBackfill.finishedWithHit = finishedWithHit;
    summary.hitBackfill.finishedMissingHit = finishedMissingHit;
    summary.hitBackfill.hitMismatch = hitMismatch;
  }

  private checkModelBaseline(
    upcomingRows: CheckMatchRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    const v11Count = upcomingRows.filter(
      (r) => r.predEngineVersion === 'v11.0-unified',
    ).length;
    summary.modelBaseline.v11Count = v11Count;

    const baselineByLeague: Record<string, number> = {};
    const leagueTotals: Record<string, { sum: number; count: number }> = {};

    for (const row of upcomingRows) {
      if (row.league && row.predictedTotal && row.predEngineVersion === 'v11.0-unified') {
        const key = row.league;
        if (!leagueTotals[key]) leagueTotals[key] = { sum: 0, count: 0 };
        leagueTotals[key].sum += Number(row.predictedTotal);
        leagueTotals[key].count += 1;
      }
    }

    for (const [league, data] of Object.entries(leagueTotals)) {
      baselineByLeague[league] = Math.round((data.sum / data.count) * 10) / 10;
    }
    summary.modelBaseline.baselineByLeague = baselineByLeague;

    let emptyFeatures = 0;
    for (const row of upcomingRows) {
      if (row.predEngineVersion === 'v11.1-unified' || row.predEngineVersion === 'v11.0-unified') {
        const hasStats = row.teamStats != null;
        const hasForm = row.recentForm != null;
        const hasH2h = row.h2hHistory != null;

        if (!hasStats && !hasForm && !hasH2h) {
          emptyFeatures += 1;
        }
      }
    }
    summary.modelBaseline.emptyFeatures = emptyFeatures;

    let injuryAdjustApplied = 0;
    for (const row of upcomingRows) {
      if (row.injuries && typeof row.injuries === 'object') {
        const inj = row.injuries as Record<string, unknown>;
        const hasHome = Array.isArray(inj.home) && inj.home.length > 0;
        const hasAway = Array.isArray(inj.away) && inj.away.length > 0;
        if (!hasHome && !hasAway) continue;

        const hasLine = row.handicapLineNum != null && Number(row.handicapLineNum) !== 0;
        const adj = Number(row.injuryAdjustApplied) || 0;
        if (adj !== 0) {
          injuryAdjustApplied += 1;
        } else if (row.predEngineVersion === 'v11.0-unified' && hasLine) {
          const coreOutCount = this.countCoreOuts(inj);
          if (coreOutCount > 0) {
            this.addIssue(issues, 'model_baseline', 'injury_no_adjust', 'medium', row,
              `有${coreOutCount}名核心缺阵但伤停加权未生效`);
          }
        } else if (row.predEngineVersion === 'v11.0-unified' && !hasLine) {
          this.addIssue(issues, 'model_baseline', 'injury_no_line', 'low', row,
            '有伤停数据但无让分盘口，伤停加权无法应用（R44需盘口判断热门方）');
        }
      }
    }
    summary.modelBaseline.injuryAdjustApplied = injuryAdjustApplied;
  }

  private countCoreOuts(inj: Record<string, unknown>): number {
    let count = 0;
    const teams = ['home', 'away'] as const;
    for (const side of teams) {
      const list = inj[side];
      if (Array.isArray(list)) {
        for (const p of list) {
          const st = (p as Record<string, unknown>)?.status as string | undefined;
          if (st === 'Out' || st === 'OUT') count += 1;
        }
      }
    }
    return count;
  }

  private async tryFlashscoreBackfill(
    row: CheckMatchRow,
    table: typeof basketballMatches,
  ): Promise<{ fixed: boolean; homeScore?: number; awayScore?: number; fixDetail?: string }> {
    const kickoffMs = row.kickoffTime instanceof Date
      ? row.kickoffTime.getTime()
      : new Date(row.kickoffTime).getTime();
    const from = new Date(kickoffMs - 48 * 60 * 60 * 1000);
    const to = new Date(kickoffMs + 48 * 60 * 60 * 1000);

    const leagueKey = this.mapLeagueToFlashscoreKey(row.league || '');

    try {
      const score = await this.flashscoreService.findMatchScore(
        row.homeTeam,
        row.awayTeam,
        from,
        to,
        leagueKey || undefined,
      );
      if (!score) {
        return { fixed: false };
      }

      const scoreValid = score.homeScore >= 20 && score.awayScore >= 20 &&
        score.homeScore <= 200 && score.awayScore <= 200 &&
        Math.abs(score.homeScore - score.awayScore) <= 80 &&
        score.homeScore + score.awayScore >= 60 && score.homeScore + score.awayScore <= 350;

      if (!scoreValid) {
        return { fixed: false };
      }

      const hit = this.calcHit({ ...row, homeScore: score.homeScore, awayScore: score.awayScore });
      await this.db.update(table)
        .set({
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          matchStatus: 'finished',
          hitWdw: hit.wdw,
          hitHandicap: hit.handicap,
          hitOverunder: hit.overunder,
          liveScoreSource: 'flashscore-backfill',
          resultPendingReason: 'flashscore-auto-backfill',
        })
        .where(eq(table.id, row.id));

      const hitDesc = `胜负${hit.wdw === null ? 'N/A' : hit.wdw ? '红' : '黑'}，让分${hit.handicap === null ? 'N/A' : hit.handicap ? '红' : '黑'}，大小分${hit.overunder === null ? 'N/A' : hit.overunder ? '红' : '黑'}`;
      return { fixed: true, homeScore: score.homeScore, awayScore: score.awayScore, fixDetail: hitDesc };
    } catch (err) {
      this.logger.warn(`Flashscore backfill failed for ${row.homeTeam} vs ${row.awayTeam}: ${(err as Error).message}`);
      return { fixed: false };
    }
  }

  private mapLeagueToFlashscoreKey(league: string): string | null {
    const l = league.toLowerCase();
    if (l.includes('欧篮') || l.includes('euroleague')) return 'euroleague';
    if (l.includes('西篮') || l.includes('acb') || l.includes('西班牙')) return 'spain-acb';
    if (l.includes('德篮') || l.includes('bbl') || l.includes('德国')) return 'germany-bbl';
    if (l.includes('澳') || l.includes('nbl') || l.includes('澳洲')) return 'australia-nbl';
    return null;
  }

  // --- Sporttery Coverage ---
  private async checkSportteryCoverage(
    upcomingRows: CheckMatchRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): Promise<void> {
    try {
      const officialList = await this.sportteryService.fetchBasketballSchedule();
      const officialMatchNos = new Set(officialList.map((m: { matchNo: string }) => m.matchNo));

      const dbSportteryUpcoming = upcomingRows.filter((r) => r.source === 'sporttery');
      const dbMatchNoMap = new Map<string, CheckMatchRow>();
      for (const row of dbSportteryUpcoming) {
        if (row.matchNo) dbMatchNoMap.set(row.matchNo, row);
      }

      // 官方有、库内无 → missing
      let missingCount = 0;
      for (const m of officialList) {
        const matchNo = (m as { matchNo: string }).matchNo;
        if (!dbMatchNoMap.has(matchNo)) {
          missingCount += 1;
          const league = (m as { league?: string }).league || '';
          const homeTeam = (m as { homeTeam?: string }).homeTeam || '';
          const awayTeam = (m as { awayTeam?: string }).awayTeam || '';
          issues.push({
            category: 'sporttery_coverage',
            subCategory: 'missing_sporttery_match',
            severity: 'high',
            matchId: '',
            matchNo,
            league,
            homeTeam,
            awayTeam,
            detail: '竞彩官方在售但库内无对应记录，下次同步时自动补拉',
            autoFixable: false,
            fixStatus: 'pending',
            fixDetail: '',
          });
        }
      }

      // 库内 source='sporttery' 且开赛在未来2天内、官方无 → stale
      let staleCount = 0;
      const now = Date.now();
      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
      for (const row of dbSportteryUpcoming) {
        if (!row.matchNo) continue;
        const kickoffMs = row.kickoffTime instanceof Date
          ? row.kickoffTime.getTime()
          : new Date(row.kickoffTime).getTime();
        if (kickoffMs - now > twoDaysMs) continue;
        if (!officialMatchNos.has(row.matchNo)) {
          staleCount += 1;
          this.addIssue(
            issues,
            'sporttery_coverage',
            'stale_sporttery_match',
            'medium',
            row,
            '库内为竞彩源且未来2天内开赛，但官方在售清单中不存在，可能已停售或赛程变动',
            false,
          );
        }
      }

      (summary as unknown as Record<string, unknown>)['sportteryCoverage'] = {
        officialCount: officialList.length,
        inDbCount: dbSportteryUpcoming.length,
        missingCount,
        staleCount,
      };
    } catch (err) {
      this.logger.warn(
        `[basketball-auto-check] sporttery coverage check failed: ${this.errorMessage(err)}`,
      );
      issues.push({
        category: 'sporttery_coverage',
        subCategory: 'check_failed',
        severity: 'medium',
        matchId: '',
        matchNo: '',
        league: '',
        homeTeam: '',
        awayTeam: '',
        detail: `竞彩对照检查失败: ${this.errorMessage(err)}`,
        autoFixable: false,
        fixStatus: 'failed',
        fixDetail: '',
      });
      (summary as unknown as Record<string, unknown>)['sportteryCoverage'] = {
        officialCount: 0,
        inDbCount: 0,
        missingCount: 0,
        staleCount: 0,
      };
    }
  }

  // --- Sync Health ---
  private async checkSyncHealth(
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): Promise<void> {
    try {
      const mainSyncTasks = [
        'daily_full_sync',
        'daily_wnba_full_sync',
        'hourly_onsale_capture',
        'on_sale_capture',
        'base_sync',
      ];

      const recentLogs = await this.db
        .select({
          taskName: syncTaskLogs.taskName,
          status: syncTaskLogs.status,
          finishedAt: syncTaskLogs.finishedAt,
          errorMessage: syncTaskLogs.errorMessage,
        })
        .from(syncTaskLogs)
        .where(inArray(syncTaskLogs.taskName, mainSyncTasks))
        .orderBy(desc(syncTaskLogs.startedAt))
        .limit(5);

      const now = Date.now();
      let lastSyncAt: string | null = null;
      let lastStatus: string = 'unknown';
      let consecutiveFailures = 0;
      let stalenessHours = 0;

      for (const log of recentLogs) {
        if (log.status === 'failed') {
          consecutiveFailures += 1;
        } else if (log.status === 'success' || log.status === 'skipped') {
          break;
        }
      }

      const lastSuccess = recentLogs.find(
        (l) => l.status === 'success' || l.status === 'skipped',
      );
      if (lastSuccess?.finishedAt) {
        const successDate = lastSuccess.finishedAt instanceof Date
          ? lastSuccess.finishedAt
          : new Date(lastSuccess.finishedAt);
        lastSyncAt = successDate.toISOString();
        stalenessHours = Math.round((now - successDate.getTime()) / (60 * 60 * 1000) * 10) / 10;
      }

      if (recentLogs.length > 0 && recentLogs[0].status) {
        lastStatus = recentLogs[0].status;
      }

      if (recentLogs.length > 0 && recentLogs[0].status === 'failed') {
        const errMsg = recentLogs[0].errorMessage || '未知错误';
        issues.push({
          category: 'sync_health',
          subCategory: 'last_sync_failed',
          severity: 'medium',
          matchId: '',
          matchNo: '',
          league: '',
          homeTeam: '',
          awayTeam: '',
          detail: `最近一次同步任务失败: ${recentLogs[0].taskName}，错误: ${errMsg}`,
          autoFixable: false,
          fixStatus: 'pending',
          fixDetail: '',
        });
      }

      if (consecutiveFailures >= 2) {
        issues.push({
          category: 'sync_health',
          subCategory: 'consecutive_failures',
          severity: 'high',
          matchId: '',
          matchNo: '',
          league: '',
          homeTeam: '',
          awayTeam: '',
          detail: `同步任务连续${consecutiveFailures}次失败，需立即排查`,
          autoFixable: false,
          fixStatus: 'pending',
          fixDetail: '',
        });
      }

      if (lastSyncAt) {
        const lastSyncDate = new Date(lastSyncAt);
        if (now - lastSyncDate.getTime() > 24 * 60 * 60 * 1000) {
          issues.push({
            category: 'sync_health',
            subCategory: 'sync_staleness',
            severity: 'high',
            matchId: '',
            matchNo: '',
            league: '',
            homeTeam: '',
            awayTeam: '',
            detail: `最近成功同步距今 ${stalenessHours} 小时，已超过24小时阈值`,
            autoFixable: false,
            fixStatus: 'pending',
            fixDetail: '',
          });
        }
      } else if (recentLogs.length === 0) {
        issues.push({
          category: 'sync_health',
          subCategory: 'no_sync_record',
          severity: 'high',
          matchId: '',
          matchNo: '',
          league: '',
          homeTeam: '',
          awayTeam: '',
          detail: '未找到任何同步任务记录，请确认同步任务是否正常运行',
          autoFixable: false,
          fixStatus: 'pending',
          fixDetail: '',
        });
      }

      (summary as unknown as Record<string, unknown>)['syncHealth'] = {
        lastSyncAt,
        lastStatus,
        consecutiveFailures,
        stalenessHours,
      };
    } catch (err) {
      this.logger.warn(
        `[basketball-auto-check] sync health check failed: ${this.errorMessage(err)}`,
      );
      issues.push({
        category: 'sync_health',
        subCategory: 'check_failed',
        severity: 'medium',
        matchId: '',
        matchNo: '',
        league: '',
        homeTeam: '',
        awayTeam: '',
        detail: `同步健康度检查失败: ${this.errorMessage(err)}`,
        autoFixable: false,
        fixStatus: 'failed',
        fixDetail: '',
      });
      (summary as unknown as Record<string, unknown>)['syncHealth'] = {
        lastSyncAt: null,
        lastStatus: 'unknown',
        consecutiveFailures: 0,
        stalenessHours: 0,
      };
    }
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
