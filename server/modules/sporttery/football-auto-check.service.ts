import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, matchAutoCheckReports, syncTaskLogs } from '@server/database/schema';
import { eq, and, isNull, isNotNull, gt, lt, sql, desc, count, inArray } from 'drizzle-orm';
import type { AutoCheckIssue, AutoCheckSummary, AutoCheckReport } from '@shared/api.interface';
import { SportteryService } from './sporttery.service';

type CheckCategory =
  | 'integrity'
  | 'status_flow'
  | 'hit_backfill'
  | 'odds_coverage'
  | 'model_baseline'
  | 'sporttery_coverage'
  | 'sync_health';

interface FootballCheckRow {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Date | string;
  matchStatus: string;
  homeScore: number | null;
  awayScore: number | null;
  predictionDirection: string;
  handicap: string;
  handicapRecommendation: string;
  overUnder: string;
  totalPick: string | null;
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
  oddsOpenHome: string | number | null;
  oddsOpenDraw: string | number | null;
  oddsOpenAway: string | number | null;
  handicapOddsHome: string | number | null;
  totalOddsOver: string | number | null;
  confidence: number;
  source: string;
  lastScoreAt: Date | string | null;
  predEngineVersion: string | null;
  livePeriod: number | null;
  liveClock: string | null;
  liveScoreSource: string;
  resultPendingReason: string | null;
  totalGoals: string | number | null;
  matchDate: string | null;
}

@Injectable()
export class FootballAutoCheckService {
  private readonly logger = new Logger(FootballAutoCheckService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sportteryService: SportteryService,
  ) {}

  async runCheck(
    triggerSource: string = 'manual',
    triggerTask?: string,
  ): Promise<AutoCheckReport> {
    const startTime = Date.now();
    const issues: AutoCheckIssue[] = [];

    try {
      const table = matches;

      // Step 1: auto-fix pass (backfill + stale live resolve)
      let autoFixedCount = 0;
      try {
        const backfillResult = await this.sportteryService.backfillFootballHitResults();
        autoFixedCount += backfillResult.updated;
      } catch (err) {
        this.logger.warn(
          `[auto-check] backfill pass failed: ${this.errorMessage(err)}`,
        );
      }

      try {
        const staleResult = await this.sportteryService.autoResolveStaleLiveFootball();
        autoFixedCount += staleResult.resolvedToFinished + staleResult.resolvedToPending;
      } catch (err) {
        this.logger.warn(
          `[auto-check] stale-live pass failed: ${this.errorMessage(err)}`,
        );
      }

      try {
        const noScoreResult = await this.sportteryService.resolveFinishedNoScoreFootball();
        autoFixedCount += noScoreResult.updated;
      } catch (err) {
        this.logger.warn(
          `[auto-check] finished-no-score pass failed: ${this.errorMessage(err)}`,
        );
      }

      // Step 1.4: stale upcoming 巡检（只告警，不自动改状态）
      let staleUpcomingTotal = 0;
      try {
        const staleUpcomingResult = await this.sportteryService.autoResolveStaleUpcomingFootball();
        staleUpcomingTotal = staleUpcomingResult.total;
      } catch (err) {
        this.logger.warn(
          `[auto-check] stale-upcoming pass failed: ${this.errorMessage(err)}`,
        );
      }

      // Step 2: load matches in scope (past 7 days → future 3 days)
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
          predictionDirection: table.predictionDirection,
          handicap: table.handicap,
          handicapRecommendation: table.handicapRecommendation,
          overUnder: table.overUnder,
          totalPick: table.totalPick,
          hitWdw: table.hitWdw,
          hitHandicap: table.hitHandicap,
          hitOverunder: table.hitOverunder,
          oddsOpenHome: table.oddsOpenHome,
          oddsOpenDraw: table.oddsOpenDraw,
          oddsOpenAway: table.oddsOpenAway,
          handicapOddsHome: table.handicapOddsHome,
          totalOddsOver: table.totalOddsOver,
          confidence: table.confidence,
          source: table.source,
          lastScoreAt: table.lastScoreAt,
          predEngineVersion: table.predEngineVersion,
          livePeriod: table.livePeriod,
          liveClock: table.liveClock,
          liveScoreSource: table.liveScoreSource,
          resultPendingReason: table.resultPendingReason,
          totalGoals: table.totalGoals,
          matchDate: table.matchDate,
        })
        .from(table)
        .where(
          and(
            gt(table.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '7 days'`),
            lt(table.kickoffTime, sql`CURRENT_TIMESTAMP + INTERVAL '3 days'`),
          ),
        )
        .orderBy(table.kickoffTime) as FootballCheckRow[];

      const upcoming = allRows.filter((r) => r.matchStatus === 'upcoming');
      const live = allRows.filter((r) => r.matchStatus === 'live');
      const finished = allRows.filter((r) => r.matchStatus === 'finished');

      const summary: AutoCheckSummary = {
        integrity: {
          total: allRows.length,
          predicted: 0,
          emptyFields: 0,
          duplicateMatchNos: 0,
        },
        statusFlow: {
          finished: finished.length,
          pendingHit: 0,
          stuckLive: 0,
          stuckLiveAutoFixed: 0,
          stuckLivePending: 0,
          wrongFinished: 0,
          staleUpcoming: 0,
        },
        periodDisplay: { reliable: 0, estimated: 0, misleading: 0, otMislabeled: 0 },
        dataCorrectness: { lineValid: 0, directionConsistent: 0, scoreAnomalies: 0 },
        hitBackfill: { finishedWithHit: 0, finishedMissingHit: 0, hitMismatch: 0 },
        modelBaseline: { v11Count: 0, baselineByLeague: {}, emptyFeatures: 0, injuryAdjustApplied: 0 },
      };

      this.checkIntegrity(allRows, issues, summary);
      this.checkStatusFlow(allRows, issues, summary);
      this.checkHitBackfill(finished, issues, summary);
      this.checkOddsCoverage(upcoming, issues, summary);
      await this.checkModelBaseline(upcoming, issues, summary);
      await this.checkSportteryCoverage(upcoming, issues, summary);
      await this.checkSyncHealth(issues, summary);

      const totalIssues = issues.length;
      const autoFixed = issues.filter((i) => i.fixStatus === 'fixed').length + autoFixedCount;
      const needsManual = issues.filter(
        (i) => i.autoFixable === false || i.fixStatus === 'pending',
      ).length;
      const durationMs = Date.now() - startTime;

      const [inserted] = await this.db
        .insert(matchAutoCheckReports)
        .values({
          checkType: 'football',
          triggerSource,
          triggerTask: triggerTask || null,
          status: 'completed',
          totalMatches: allRows.length,
          upcomingCount: upcoming.length,
          liveCount: live.length,
          finishedCount: finished.length,
          totalIssues,
          autoFixed: Math.max(autoFixed, 0),
          needsManual,
          durationMs,
          summary: summary as unknown as Record<string, unknown>,
          issues: issues as unknown as Record<string, unknown>[],
        })
        .returning({ id: matchAutoCheckReports.id });

      this.logger.log(
        `[football-auto-check] completed: total=${allRows.length}, ` +
        `issues=${totalIssues}, auto_fixed=${autoFixed}, needs_manual=${needsManual}, ` +
        `duration=${durationMs}ms`,
      );

      return this.getReportById(inserted!.id);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[football-auto-check] failed', errMsg);

      await this.db
        .insert(matchAutoCheckReports)
        .values({
          checkType: 'football',
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
      .from(matchAutoCheckReports)
      .where(eq(matchAutoCheckReports.checkType, 'football'));

    const rows = await this.db
      .select()
      .from(matchAutoCheckReports)
      .where(eq(matchAutoCheckReports.checkType, 'football'))
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
      .where(eq(matchAutoCheckReports.checkType, 'football'))
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
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    };
  }

  private addIssue(
    issues: AutoCheckIssue[],
    category: CheckCategory,
    subCategory: string,
    severity: 'low' | 'medium' | 'high',
    row: { id: string; matchNo: string; league: string; homeTeam: string; awayTeam: string },
    detail: string,
    autoFixable: boolean = false,
    fixStatus: 'pending' | 'fixed' | 'failed' = 'pending',
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
      fixStatus,
      fixDetail: '',
    });
  }

  // --- Integrity ---
  private checkIntegrity(
    rows: FootballCheckRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    const predicted = rows.filter(
      (r) => r.predictionDirection && r.predictionDirection !== '观望' && r.confidence > 0,
    ).length;
    summary.integrity.predicted = predicted;

    // finished但无比分
    const finishedNoScore = rows.filter(
      (r) => r.matchStatus === 'finished' && (r.homeScore == null || r.awayScore == null),
    );
    for (const row of finishedNoScore) {
      this.addIssue(
        issues,
        'integrity',
        'finished_no_score',
        'high',
        row,
        '比赛状态为finished但缺少比分数据',
      );
    }

    // finished但预测方向为空
    const finishedNoPrediction = rows.filter(
      (r) => r.matchStatus === 'finished' && (!r.predictionDirection || r.predictionDirection === ''),
    );
    for (const row of finishedNoPrediction) {
      this.addIssue(
        issues,
        'integrity',
        'finished_no_prediction',
        'medium',
        row,
        '已完赛比赛预测方向为空',
      );
    }

    summary.integrity.emptyFields = finishedNoScore.length + finishedNoPrediction.length;

    // match_no + match_date 重复（同天同编号才是异常，跨日期重号是竞彩编号正常复用）
    const matchNoDateMap = new Map<string, FootballCheckRow[]>();
    for (const row of rows) {
      if (row.matchNo && row.matchDate) {
        const key = `${row.matchNo}|${row.matchDate}`;
        const arr = matchNoDateMap.get(key) || [];
        arr.push(row);
        matchNoDateMap.set(key, arr);
      }
    }
    let duplicateCount = 0;
    for (const [key, matchList] of matchNoDateMap) {
      if (matchList.length > 1) {
        duplicateCount += 1;
        for (const row of matchList) {
          this.addIssue(
            issues,
            'integrity',
            'duplicate_match_no',
            'high',
            row,
            `比赛编号+日期重复 (${key})，共${matchList.length}条记录`,
          );
        }
      }
    }
    summary.integrity.duplicateMatchNos = duplicateCount;
  }

  // --- Status Flow ---
  private checkStatusFlow(
    rows: FootballCheckRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    const nowMs = Date.now();
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;

      let stuckLive = 0;
      let pendingHit = 0;
      let wrongFinished = 0;
      let staleUpcoming = 0;
      const unknownStatuses = new Set<string>();

    for (const row of rows) {
      // 未知状态
      if (
        row.matchStatus !== 'upcoming' &&
        row.matchStatus !== 'live' &&
        row.matchStatus !== 'finished' &&
        row.matchStatus !== 'score_pending' &&
        row.matchStatus !== 'result_pending' &&
        row.matchStatus !== 'canceled' &&
        row.matchStatus !== 'postponed'
      ) {
        unknownStatuses.add(row.matchStatus);
        this.addIssue(
          issues,
          'status_flow',
          'unknown_status',
          'high',
          row,
          `未知比赛状态: ${row.matchStatus}`,
        );
      }

      // 卡 live 超 48 小时
      if (row.matchStatus === 'live') {
        const kickoffMs = row.kickoffTime instanceof Date
          ? row.kickoffTime.getTime()
          : new Date(row.kickoffTime).getTime();
        if (nowMs - kickoffMs > fortyEightHoursMs) {
          stuckLive += 1;
          this.addIssue(
            issues,
            'status_flow',
            'stuck_live_48h',
            'high',
            row,
            '比赛卡live状态超过48小时',
            true,
          );
        }
      }

      // upcoming 已开赛超过 6 小时（过期 upcoming）
      if (row.matchStatus === 'upcoming') {
        const kickoffMs = row.kickoffTime instanceof Date
          ? row.kickoffTime.getTime()
          : new Date(row.kickoffTime).getTime();
        if (nowMs - kickoffMs > 6 * 60 * 60 * 1000) {
          staleUpcoming += 1;
          const hoursPast = Math.round((nowMs - kickoffMs) / (60 * 60 * 1000) * 10) / 10;
          this.addIssue(
            issues,
            'status_flow',
            'stale_upcoming',
            'medium',
            row,
            `比赛已开赛 ${hoursPast} 小时仍为 upcoming 状态`,
          );
        }
      }

      // finished 有预测但未回打
      if (row.matchStatus === 'finished' && row.homeScore != null && row.awayScore != null) {
        const hasPrediction =
          (row.predictionDirection && row.predictionDirection !== '观望') ||
          (row.handicapRecommendation && row.handicapRecommendation !== '' && row.handicapRecommendation !== '观望') ||
          (row.totalPick && row.totalPick !== '' && row.totalPick !== '观望');
        const hasHit = row.hitWdw != null || row.hitHandicap != null || row.hitOverunder != null;
        if (hasPrediction && !hasHit) {
          pendingHit += 1;
          this.addIssue(
            issues,
            'status_flow',
            'pending_hit_backfill',
            'medium',
            row,
            '比赛已结束且有预测但命中未回填',
            true,
          );
        }
      }
    }

    summary.statusFlow.stuckLive = stuckLive;
    summary.statusFlow.stuckLiveAutoFixed = 0; // autoFix pass 在前面执行
    summary.statusFlow.stuckLivePending = stuckLive;
    summary.statusFlow.wrongFinished = wrongFinished;
    summary.statusFlow.pendingHit = pendingHit;
    summary.statusFlow.staleUpcoming = staleUpcoming;

    // 异常状态分布（未知状态计数）
    if (unknownStatuses.size > 0) {
      this.logger.warn(
        `[football-auto-check] found ${unknownStatuses.size} unknown status values: ${[...unknownStatuses].join(', ')}`,
      );
    }
  }

  // --- Hit Backfill ---
  private checkHitBackfill(
    finishedRows: FootballCheckRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    let finishedWithHit = 0;
    let finishedMissingHit = 0;
    let hitMismatch = 0;

    for (const row of finishedRows) {
      if (row.homeScore == null || row.awayScore == null) continue;

      const h = row.homeScore;
      const a = row.awayScore;

      // WDW
      let expectedWdw: boolean | null = null;
      if (row.predictionDirection === '主胜') expectedWdw = h > a;
      else if (row.predictionDirection === '客胜') expectedWdw = h < a;
      else if (row.predictionDirection === '平') expectedWdw = h === a;

      let wdwChecked = false;
      if (expectedWdw !== null) {
        wdwChecked = true;
        if (row.hitWdw == null) {
          finishedMissingHit += 1;
          this.addIssue(
            issues,
            'hit_backfill',
            'wdw_missing_hit',
            'medium',
            row,
            `WDW有预测(${row.predictionDirection})但命中未回打`,
            true,
          );
        } else if (row.hitWdw !== expectedWdw) {
          hitMismatch += 1;
          this.addIssue(
            issues,
            'hit_backfill',
            'wdw_hit_mismatch',
            'high',
            row,
            `胜平负命中不一致: 实际${h}-${a}，预测${row.predictionDirection}，DB存${row.hitWdw}`,
            true,
          );
        }
      }

      // 让球
      const hLine = row.handicap ? Number(row.handicap) : NaN;
      if (!Number.isNaN(hLine) && row.handicapRecommendation && row.handicapRecommendation !== '观望') {
        const v = (h - a) + hLine;
        let expected: boolean | null = null;
        if (v === 0) {
          expected = null;
        } else if (row.handicapRecommendation === '让球主胜' || row.handicapRecommendation === '让胜') {
          expected = v > 0;
        } else if (row.handicapRecommendation === '让球主负' || row.handicapRecommendation === '让负') {
          expected = v < 0;
        }

        if (expected !== null && row.hitHandicap == null) {
          finishedMissingHit += 1;
          this.addIssue(
            issues,
            'hit_backfill',
            'handicap_missing_hit',
            'medium',
            row,
            `让球有预测(${row.handicapRecommendation})但命中未回打`,
            true,
          );
        } else if (expected !== null && row.hitHandicap != null && row.hitHandicap !== expected) {
          hitMismatch += 1;
          this.addIssue(
            issues,
            'hit_backfill',
            'handicap_hit_mismatch',
            'high',
            row,
            `让球命中不一致: 净胜${h - a}，线${hLine}，推荐${row.handicapRecommendation}，DB存${row.hitHandicap}`,
            true,
          );
        }
      }

      // 大小球
      const tLine = row.overUnder ? Number(row.overUnder) : NaN;
      if (!Number.isNaN(tLine) && row.totalPick && row.totalPick !== '观望') {
        const total = h + a;
        let expected: boolean | null = null;
        if (total === tLine) {
          expected = null;
        } else if (row.totalPick === '大球') {
          expected = total > tLine;
        } else if (row.totalPick === '小球') {
          expected = total < tLine;
        }

        if (expected !== null && row.hitOverunder == null) {
          finishedMissingHit += 1;
          this.addIssue(
            issues,
            'hit_backfill',
            'overunder_missing_hit',
            'medium',
            row,
            `大小球有预测(${row.totalPick})但命中未回打`,
            true,
          );
        } else if (expected !== null && row.hitOverunder != null && row.hitOverunder !== expected) {
          hitMismatch += 1;
          this.addIssue(
            issues,
            'hit_backfill',
            'overunder_hit_mismatch',
            'high',
            row,
            `大小球命中不一致: 实际${total}，线${tLine}，pick=${row.totalPick}，DB存${row.hitOverunder}`,
            true,
          );
        }
      }

      if (wdwChecked && row.hitWdw != null) {
        finishedWithHit += 1;
      }
    }

    summary.hitBackfill.finishedWithHit = finishedWithHit;
    summary.hitBackfill.finishedMissingHit = finishedMissingHit;
    summary.hitBackfill.hitMismatch = hitMismatch;
  }

  // --- Odds Coverage ---
  private checkOddsCoverage(
    upcomingRows: FootballCheckRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): void {
    // 只用作统计展示，summary.dataCorrectness 复用存盘口覆盖计数
    let wdwMissing = 0;
    let handicapMissing = 0;
    let ouMissing = 0;

    for (const row of upcomingRows) {
      const oddsHome = Number(row.oddsOpenHome) || 0;
      const oddsAway = Number(row.oddsOpenAway) || 0;
      const oddsDraw = Number(row.oddsOpenDraw) || 0;

      if (oddsHome <= 0 || oddsAway <= 0 || oddsDraw <= 0) {
        wdwMissing += 1;
        const missing: string[] = [];
        if (oddsHome <= 0) missing.push('主胜赔率');
        if (oddsDraw <= 0) missing.push('平赔率');
        if (oddsAway <= 0) missing.push('客胜赔率');
        this.addIssue(
          issues,
          'odds_coverage',
          'missing_wdw_odds',
          'medium',
          row,
          `即将开赛但缺少胜平负赔率: ${missing.join('、')}`,
        );
      }

      // 让球盘口
      const hLine = row.handicap ? Number(row.handicap) : NaN;
      if (Number.isNaN(hLine) || !row.handicapRecommendation || row.handicapRecommendation === '') {
        handicapMissing += 1;
        this.addIssue(
          issues,
          'odds_coverage',
          'missing_handicap',
          'medium',
          row,
          '即将开赛但缺少让球盘口或推荐',
        );
      }

      // 大小球盘口
      const tLine = row.overUnder ? Number(row.overUnder) : NaN;
      if (Number.isNaN(tLine) || !row.totalPick || row.totalPick === '') {
        ouMissing += 1;
        this.addIssue(
          issues,
          'odds_coverage',
          'missing_overunder',
          'medium',
          row,
          '即将开赛但缺少大小球盘口或推荐',
        );
      }
    }

    // 存到 dataCorrectness.lineValid 作为盘口覆盖率计数（足球版没有 dataCorrectness 细分类，借用存数）
    summary.dataCorrectness.lineValid = upcomingRows.length - wdwMissing;
    summary.dataCorrectness.directionConsistent = upcomingRows.length - handicapMissing;
    summary.dataCorrectness.scoreAnomalies = upcomingRows.length - ouMissing;
  }

  // --- Model Baseline ---
  private async checkModelBaseline(
    upcomingRows: FootballCheckRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): Promise<void> {
    // upcoming比赛预测方向为空
    let emptyPrediction = 0;
    for (const row of upcomingRows) {
      if (!row.predictionDirection || row.predictionDirection === '' || row.predictionDirection === '观望') {
        emptyPrediction += 1;
        this.addIssue(
          issues,
          'model_baseline',
          'empty_prediction_direction',
          'medium',
          row,
          '即将开赛但预测方向为空',
        );
      }
    }

    // 低样本联赛（finished<30场）的 upcoming 比赛
    // 先统计各联赛已完赛场次
    const leagueFinishedCounts = await this.db
      .select({
        league: matches.league,
        count: sql<number>`count(*)`,
      })
      .from(matches)
      .where(
        and(
          eq(matches.matchStatus, 'finished'),
          isNotNull(matches.homeScore),
          isNotNull(matches.awayScore),
          gt(matches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '365 days'`),
        ),
      )
      .groupBy(matches.league);

    const leagueCountMap = new Map<string, number>();
    for (const row of leagueFinishedCounts) {
      leagueCountMap.set(row.league, Number(row.count));
    }

    const lowSampleLeagues = new Set<string>();
    let lowSampleUpcoming = 0;
    for (const row of upcomingRows) {
      const finishedCount = leagueCountMap.get(row.league) ?? 0;
      if (finishedCount < 30) {
        lowSampleLeagues.add(row.league);
        lowSampleUpcoming += 1;
        this.addIssue(
          issues,
          'model_baseline',
          'low_sample_league',
          'low',
          row,
          `联赛 ${row.league} 近365天仅 ${finishedCount} 场完赛样本（<30场），预测置信度偏低`,
        );
      }
    }

    // baselineByLeague 存的是各联赛已完赛场次
    const baselineByLeague: Record<string, number> = {};
    for (const [league, count] of leagueCountMap.entries()) {
      baselineByLeague[league] = count;
    }

    summary.modelBaseline.v11Count = upcomingRows.length - emptyPrediction;
    summary.modelBaseline.baselineByLeague = baselineByLeague;
    summary.modelBaseline.emptyFeatures = emptyPrediction;
    summary.modelBaseline.injuryAdjustApplied = lowSampleUpcoming;
  }

  // --- Sporttery Coverage ---
  private async checkSportteryCoverage(
    upcomingRows: FootballCheckRow[],
    issues: AutoCheckIssue[],
    summary: AutoCheckSummary,
  ): Promise<void> {
    try {
      const officialList = await this.sportteryService.fetchFootballSchedule();
      const officialMatchNos = new Set(officialList.map((m: { matchNo: string }) => m.matchNo));

      const dbSportteryUpcoming = upcomingRows.filter((r) => r.source === 'sporttery');
      const dbMatchNoMap = new Map<string, FootballCheckRow>();
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
        `[football-auto-check] sporttery coverage check failed: ${this.errorMessage(err)}`,
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
        'football',
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

      // 连续失败计数（从最新开始数）
      for (const log of recentLogs) {
        if (log.status === 'failed') {
          consecutiveFailures += 1;
        } else if (log.status === 'success' || log.status === 'skipped') {
          break;
        }
      }

      // 最近一次成功时间
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

      // 最近一次运行状态
      if (recentLogs.length > 0 && recentLogs[0].status) {
        lastStatus = recentLogs[0].status;
      }

      // 最后一次失败
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

      // 连续2次失败
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

      // 同步过时 >24h
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
        // 没有任何同步记录
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
        `[football-auto-check] sync health check failed: ${this.errorMessage(err)}`,
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
