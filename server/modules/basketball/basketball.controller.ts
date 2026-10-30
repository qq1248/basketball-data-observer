import {
  Controller,
  Get,
  Query,
  Param,
  Post,
  Body,
  Req,
  BadRequestException,
  NotFoundException,
  Redirect,
  Inject,
} from '@nestjs/common';
import { NeedLogin, DRIZZLE_DATABASE } from '@lark-apaas/fullstack-nestjs-core';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { BasketballService } from './basketball.service';
import { BasketballDataDrivenPredictionService } from '../basketball-prediction/basketball-data-driven.service';
import { BasketballAutoCheckService } from './basketball-auto-check.service';
import { BasketballFlashscoreService } from './flashscore.service';
import { dailyReview, basketballMatches } from '@server/database/schema';
import type {
  BasketballListResponse,
  BasketballDetailResponse,
  BasketballDateStatsResponse,
   BasketballStatsResponse,
   BasketballBacktestResponse,
  BasketballParlayResponse,
  CreateBasketballMatchRequest,
  BatchUpsertResponse,
  DataCheckResponse,
    BasketballRecalcHandicapResponse,
    BasketballDataSourceStatusResponse,
    PredictionAccuracyResponse,
    OddsTrendResponse,
    MatchMultiSourceResponse,
    RuleBacktestResponse,
     AutoCheckReport,
     AutoCheckReportListResponse,
     BasketballFinalCard,
    DailyReviewResponse,
    DailyReviewMatchItem,
   } from '@shared/api.interface';

function validateUuid(value: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new BadRequestException(`ID格式错误，必须是有效的UUID`);
  }
}

@Controller('api/basketball')
export class BasketballController {
  constructor(
    private readonly basketballService: BasketballService,
    private readonly dataDrivenService: BasketballDataDrivenPredictionService,
    private readonly autoCheckService: BasketballAutoCheckService,
    private readonly flashscoreService: BasketballFlashscoreService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  @Get('today/list')
  async getTodayMatches(): Promise<BasketballListResponse> {
    const now = new Date();
    const beijingMs = now.getTime() + 8 * 3600 * 1000;
    const today = new Date(beijingMs).toISOString().slice(0, 10);
    return this.basketballService.getListByDate({ date: today });
  }

  @Get()
  async getMatches(
    @Query('date') date?: string,
    @Query('league') league?: string,
    @Query('confidence') confidence?: 'high' | 'medium' | 'low',
    @Query('direction') direction?: string,
    @Query('sort') sort?: 'kickoff_asc' | 'confidence_desc',
    @Query('status') status?: 'upcoming' | 'finished',
    @Query('sourceFilter') sourceFilter?: 'all' | 'jingcai' | 'others',
    @Query('divergence') divergence?: 'divergent' | 'consistent',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('dateMode') dateMode?: 'business' | 'kickoff',
  ): Promise<BasketballListResponse> {
    let targetDate = date;
    if (!targetDate || targetDate === 'today') {
      const now = new Date();
      const beijingMs = now.getTime() + 8 * 3600 * 1000;
      targetDate = new Date(beijingMs).toISOString().slice(0, 10);
    }
    return this.basketballService.getListByDate({
      date: targetDate,
      league,
      confidence,
      direction,
      sort,
      status,
      sourceFilter,
      divergence,
       page: page !== undefined ? Number(page) : undefined,
       pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
       dateMode,
     });
  }

  @Get('date-stats')
  async getDateStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<BasketballDateStatsResponse> {
    const now = new Date();
    const beijingMs = now.getTime() + 8 * 3600 * 1000;
    const beijingNow = new Date(beijingMs);
    const start = startDate || new Date(beijingNow.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date(beijingNow.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return this.basketballService.getDateStats(start, end);
  }

  @Get('stats')
  async getStats(): Promise<BasketballStatsResponse> {
    return this.basketballService.getStats();
  }

  @Get('backtest')
  async getBacktest(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('days') days?: string,
  ): Promise<BasketballBacktestResponse> {
    return this.basketballService.getBacktest({
      startDate,
      endDate,
      days: days !== undefined ? Number(days) : undefined,
    });
  }

  @Get('review')
  async getReview(
    @Query('date') date?: string,
    @Query('source') source?: string,
  ): Promise<DailyReviewResponse | null> {
    if (!date) {
      throw new BadRequestException('date 参数必填');
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new BadRequestException('date 格式必须为 YYYY-MM-DD');
    }
    const sourceVal = source && source.trim() ? source.trim() : 'sporttery';
    const rows = await this.db
      .select()
      .from(dailyReview)
      .where(
        and(
          eq(dailyReview.reviewDate, date),
          eq(dailyReview.sport, 'basketball'),
          eq(dailyReview.source, sourceVal),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];

    // 逐场命中明细
    const matchRows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        predictionDirection: basketballMatches.predictionDirection,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalDirection: basketballMatches.totalDirection,
        totalLineNum: basketballMatches.totalLineNum,
        hitWdw: basketballMatches.hitWdw,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
        confidence: basketballMatches.confidence,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.businessDate, date),
          eq(basketballMatches.matchStatus, 'finished'),
        ),
      )
      .orderBy(basketballMatches.kickoffTime);

    const matches: DailyReviewMatchItem[] = matchRows.map((m) => ({
      id: m.id,
      matchNo: m.matchNo,
      league: m.league,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      kickoffTime: m.kickoffTime.toISOString(),
      homeScore: m.homeScore ?? null,
      awayScore: m.awayScore ?? null,
      predictionDirection: m.predictionDirection,
      handicapRecommendation: m.handicapRecommendation,
      handicapLine: Number(m.handicapLineNum),
      totalDirection: m.totalDirection,
      totalLine: Number(m.totalLineNum),
      hitWdw: m.hitWdw ?? null,
      hitHandicap: m.hitHandicap ?? null,
      hitOverunder: m.hitOverunder ?? null,
      confidence: m.confidence,
    }));

    return {
      id: row.id,
      reviewDate: String(row.reviewDate),
      sport: row.sport,
      source: row.source,
      totalMatches: row.totalMatches,
      wdwHit: row.wdwHit,
      wdwTotal: row.wdwTotal,
      wdwRate: row.wdwRate !== null ? Number(row.wdwRate) : null,
      handicapHit: row.handicapHit,
      handicapTotal: row.handicapTotal,
      handicapRate: row.handicapRate !== null ? Number(row.handicapRate) : null,
      overunderHit: row.overunderHit,
      overunderTotal: row.overunderTotal,
      overunderRate: row.overunderRate !== null ? Number(row.overunderRate) : null,
      byLeague: (row.byLeague as DailyReviewResponse['byLeague']) ?? [],
      anomalyMatches: (row.anomalyMatches as DailyReviewResponse['anomalyMatches']) ?? [],
      matches,
      summary: row.summary ?? null,
      createdAt: row.createdAt?.toISOString() ?? '',
      updatedAt: row.updatedAt?.toISOString() ?? '',
    };
  }

  @Get('v11-backtest')
  async getV11Backtest(
    @Query('league') league?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{
    hasData: boolean;
    totalSamples: number;
    dateRange: { start: string; end: string };
    byLeague: Array<{
      league: string;
      sampleSize: number;
      v11: {
        wdwHitRate: number;
        handicapHitRate: number;
        overunderHitRate: number;
        wdwSamples: number;
        handicapSamples: number;
        ouSamples: number;
      };
      oldModel: {
        wdwHitRate: number;
        handicapHitRate: number;
        overunderHitRate: number;
        wdwSamples: number;
        handicapSamples: number;
        ouSamples: number;
      };
    }>;
    overall: {
      v11: {
        wdwHitRate: number;
        handicapHitRate: number;
        overunderHitRate: number;
        wdwSamples: number;
        handicapSamples: number;
        ouSamples: number;
      };
      oldModel: {
        wdwHitRate: number;
        handicapHitRate: number;
        overunderHitRate: number;
        wdwSamples: number;
        handicapSamples: number;
        ouSamples: number;
      };
      sampleSize: number;
    };
  }> {
    return this.basketballService.getV11ModelBacktest({ league, startDate, endDate });
  }

  @Get('parlay')
  async getParlay(@Query('date') date?: string): Promise<BasketballParlayResponse> {
    let targetDate = date;
    if (!targetDate) {
      const now = new Date();
      const beijingMs = now.getTime() + 8 * 3600 * 1000;
      targetDate = new Date(beijingMs).toISOString().slice(0, 10);
    }
    return this.basketballService.getParlay(targetDate);
  }

  @Get('odds-trend/:id')
  async getOddsTrend(@Param('id') id: string): Promise<OddsTrendResponse> {
    validateUuid(id);
    return this.basketballService.getOddsTrend(id);
  }

  @Get('multi-source/:id')
  async getMultiSource(@Param('id') id: string): Promise<MatchMultiSourceResponse> {
    validateUuid(id);
    return this.basketballService.getMultiSource(id);
  }

  @Get('match/:id')
  @Redirect('', 302)
  redirectMatchToDetail(@Param('id') id: string): { url: string } {
    validateUuid(id);
    return { url: `/api/basketball/detail/${id}` };
  }

  @Get('detail/:id')
  async getDetail(@Param('id') id: string): Promise<BasketballDetailResponse> {
    validateUuid(id);
    return this.basketballService.getDetail(id);
  }

  @Get('final-card/:matchNo')
  async getFinalCard(@Param('matchNo') matchNo: string): Promise<BasketballFinalCard> {
    const result = await this.basketballService.getFinalCardByMatchNo(matchNo);
    if (!result) {
      throw new NotFoundException('比赛不存在');
    }
    return result;
  }

  @NeedLogin()
  @Post('batch-upsert')
  async batchUpsert(
    @Req() req: Request,
    @Body() body: { items: CreateBasketballMatchRequest[] },
    @Query('skipValidation') skipValidation?: string,
  ): Promise<BatchUpsertResponse> {
    const { userId } = req.userContext;
    if (skipValidation === 'true') {
      return this.basketballService.batchUpsert(body.items, userId);
    }
    return this.basketballService.batchUpsertWithValidation(body.items, userId);
  }

  @Get('data-check')
  async dataCheck(): Promise<DataCheckResponse> {
    return this.basketballService.runDataCheck('basketball_matches');
  }

  @Get('prediction-accuracy')
  async getPredictionAccuracy(
    @Query('days') days?: string,
  ): Promise<PredictionAccuracyResponse> {
    const parsedDays = days !== undefined ? Number(days) : 30;
    const clampedDays = Math.max(7, Math.min(90, parsedDays));
    return this.basketballService.getPredictionAccuracy(clampedDays);
  }

  @Get('rule-backtest')
  async getRuleBacktest(): Promise<RuleBacktestResponse> {
    return this.basketballService.getRuleBacktest();
  }

  @Get('v113-backtest')
  async getV113Backtest(
    @Query('businessDate') businessDate?: string,
    @Query('source') source?: string,
  ): Promise<{
    matches: Array<{
      matchNo: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      league: string | null;
      line: number | null;
      oldHandicapRec: string | null;
      newHandicapRec: string;
      oldTotalDir: string | null;
      newTotalDir: string;
      oldHomeProb: number | null;
      newHomeProb: number;
      weightedHome: number;
      weightedAway: number;
      injuryShift: number;
      modelVersion: string;
      hitHandicapOld: boolean | null;
      hitHandicapNew: boolean | null;
      hitOuOld: boolean | null;
      hitOuNew: boolean | null;
      homeScore: number | null;
      awayScore: number | null;
    }>;
    summary: {
      total: number;
      oldHandicapHitRate: number;
      newHandicapHitRate: number;
      oldOuHitRate: number;
      newOuHitRate: number;
      shallowLineSamples: number;
      shallowLineOldHitRate: number;
      shallowLineNewHitRate: number;
    };
  }> {
    return this.basketballService.runV113Backtest(businessDate, source);
  }

  @Get('data-source-status')
  async getDataSourceStatus(): Promise<BasketballDataSourceStatusResponse> {
    return this.basketballService.getDataSourceStatus();
  }

  @NeedLogin()
  @Post('recalc-handicap-hits')
  async recalcHandicapHits(@Req() req: Request): Promise<BasketballRecalcHandicapResponse> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`让分命中重算请求: userId=${userId}`);
    return this.basketballService.recalculateHandicapHits();
  }

  @NeedLogin()
  @Post('recalc-upcoming')
  async recalcUpcoming(@Req() req: Request): Promise<{ recalculated: number; skipped: number; errors: number }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球预测重算请求: userId=${userId}`);
    return this.basketballService.recalcUpcomingPredictions();
  }

  @NeedLogin()
  @Post('backfill-injury-reports')
  async backfillInjuryReports(@Req() req: Request): Promise<{ processed: number; inserted: number; skipped: number }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球伤停回填请求: userId=${userId}`);
    return this.basketballService.backfillInjuryReportsFromEspn();
  }

  @NeedLogin()
  @Post('recalc-flashscore-historical')
  async recalcFlashscoreHistorical(@Req() req: Request): Promise<{
    total: number;
    recalculated: number;
    errors: number;
    hitRecalc: { wdw: number; hc: number; ou: number };
  }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`Flashscore历史重算请求: userId=${userId}`);
    return this.basketballService.recalcFlashscoreHistorical();
  }

  @NeedLogin()
  @Post('recalc-by-date')
  async recalcByDate(
    @Req() req: Request,
    @Body() body: { date?: string; startDate?: string; endDate?: string; force?: boolean },
  ): Promise<{ recalculated: number; skipped: number; errors: number }> {
    const { userId } = req.userContext;
    const date = body.date || body.startDate;
    const endDate = body.endDate || body.date;
    this.basketballService['logger'].log(`篮球按日期重算请求: userId=${userId} date=${date} endDate=${endDate} force=${body.force}`);
    return this.basketballService.recalcPredictionsByDateRange(date, endDate, body.force);
  }

  @NeedLogin()
  @Post('recalc-injury-adjustments')
  async recalcInjuryAdjustments(@Req() req: Request): Promise<{
    processed: number;
    updated: number;
    frozenUpdated: number;
    noInjury: number;
    errors: number;
    results: unknown[];
  }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球伤停融合重算请求: userId=${userId}`);
    return this.basketballService.recalcInjuryAdjustments();
  }

  @NeedLogin()
  @Post('backfill-v8-structural')
  async backfillV8Structural(@Req() req: Request): Promise<{ updated: number; total: number; errors: number }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球v8结构化字段全量回填: userId=${userId}`);
    return this.basketballService.backfillV8StructuralFields();
  }

  @NeedLogin()
  @Post('data-driven-prediction')
  async runDataDrivenPrediction(
    @Req() req: Request,
    @Body() body: { date?: string; apply?: boolean; source?: string; allDates?: boolean },
  ): Promise<{
    date: string;
    total: number;
    locked: number;
    updated: number;
    predictions: Array<{
      matchNo: string;
      league: string;
      match: string;
      handicapRecommendation: string;
      handicapLine: number;
      handicapCoverProb: number;
      handicapConfidence: string;
      totalDirection: string;
      totalLine: number;
      totalProb: number;
      totalConfidence: string;
      dataQuality: string;
      missingData: string[];
      computationBasis: string[];
      isLocked: boolean;
    }>;
  }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球数据驱动预测: userId=${userId} date=${body.date || 'today'} source=${body.source || 'sporttery'}`);
    const date = body.date || new Date().toISOString().slice(0, 10);
    const source = body.source || 'sporttery';
    const apply = body.apply !== false;
    const allDates = body.allDates === true;

    const preds = allDates
      ? await this.dataDrivenService.predictAllUpcomingBySource(source)
      : await this.dataDrivenService.predictUpcomingSporttery(date);

    let updated = 0;
    if (apply) {
      const result = await this.dataDrivenService.applyPredictions(preds);
      updated = result.updated;
    }

    return {
      date,
      total: preds.length,
      locked: preds.filter((p) => p.isOfficialLocked).length,
      updated,
      predictions: preds.map((p) => ({
        matchNo: p.matchNo,
        league: p.league,
        match: `${p.homeTeam} vs ${p.awayTeam}`,
        handicapRecommendation: p.handicapRecommendation,
        handicapLine: p.handicapLineNum,
        handicapCoverProb: p.handicapCoverProb,
        handicapConfidence: p.handicapConfidence,
        totalDirection: p.totalDirection,
        totalLine: p.totalLineNum,
        totalProb: p.totalProb,
        totalConfidence: p.totalConfidence,
        dataQuality: p.dataQuality,
        missingData: p.missingData,
        computationBasis: p.computationBasis,
        isLocked: p.isOfficialLocked,
      })),
    };
  }

  @NeedLogin()
  @Post('backtest-data-driven')
  async backtestDataDriven(
    @Req() req: Request,
    @Body() body: { league?: string; limit?: number },
  ) {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球data-driven回测: userId=${userId} league=${body.league || '全部'} limit=${body.limit || 50}`);
    const league = body.league || '';
    const limit = Math.min(200, body.limit || 50);
    return this.dataDrivenService.backtestFinishedByLeague(league, limit);
  }

  @NeedLogin()
  @Post('backtest-data-driven-range')
  async backtestDataDrivenRange(
    @Req() req: Request,
    @Body() body: { startDate: string; endDate: string; source?: string },
  ) {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球data-driven区间回测: userId=${userId} start=${body.startDate} end=${body.endDate} source=${body.source || '全部'}`);
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    return this.dataDrivenService.backtestFinishedByDateRange(start, end, body.source);
  }

  @NeedLogin()
  @Post('clean-invalid-lines')
  async cleanInvalidLines(
    @Req() req: Request,
  ): Promise<{
    total: number;
    totalInvalid: number;
    invalidSpread: Array<{ matchNo: string; league: string; line: number }>;
    invalidTotal: Array<{ matchNo: string; league: string; line: number }>;
  }> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球无效指数线清洗请求: userId=${userId}`);
    return this.basketballService.cleanInvalidLines();
  }

  @NeedLogin()
  @Post('auto-check/run')
  async runAutoCheck(@Req() req: Request): Promise<AutoCheckReport> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球自动检查请求: userId=${userId}`);
    return this.autoCheckService.runCheck('manual');
  }

  @Get('auto-check/latest')
  async getLatestCheck(): Promise<AutoCheckReport | null> {
    return this.autoCheckService.getLatestReport();
  }

  @NeedLogin()
  @Get('auto-check/reports')
  async getCheckReports(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<AutoCheckReportListResponse> {
    const { userId } = req.userContext;
    this.basketballService['logger'].log(`篮球自动检查报告列表: userId=${userId} page=${page || 1}`);
    return this.autoCheckService.getReportList(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @NeedLogin()
  @Get('auto-check/report/:id')
  async getCheckReport(@Param('id') id: string): Promise<AutoCheckReport> {
    validateUuid(id);
    return this.autoCheckService.getReportById(id);
  }

  @NeedLogin()
  @Post('flashscore/backfill/:leagueKey')
  async flashscoreBackfill(
    @Param('leagueKey') leagueKey: string,
    @Query('limit') limit?: string,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    return this.flashscoreService.backfillHistoricalMatches(
      leagueKey,
      limit ? Number(limit) : undefined,
    );
  }

  @NeedLogin()
  @Post('debug-v113')
  async debugV113(@Req() req: Request, @Body() body: { handicapLineNum: number; totalLineNum: number; league: string; freshWeightedHome: number; freshWeightedAway: number; coreHome: number; coreAway: number }): Promise<Record<string, unknown>> {
    const result = this.basketballService.debugV113Prediction(body);
    return result;
  }

  @NeedLogin()
  @Get('debug-v113/:matchNo')
  async debugV113Match(@Param('matchNo') matchNo: string): Promise<Record<string, unknown>> {
    return this.basketballService.debugV113ForMatch(matchNo);
  }

  @NeedLogin()
  @Post('flashscore/backfill/:leagueKey')
  async flashscoreFindScore(
    @Query('homeTeam') homeTeam: string,
    @Query('awayTeam') awayTeam: string,
    @Query('kickoffFrom') kickoffFromStr: string,
    @Query('kickoffTo') kickoffToStr: string,
    @Query('leagueKey') leagueKey?: string,
  ): Promise<{ homeScore: number; awayScore: number } | null> {
    if (!homeTeam || !awayTeam || !kickoffFromStr || !kickoffToStr) {
      throw new BadRequestException('缺少必要参数: homeTeam, awayTeam, kickoffFrom, kickoffTo');
    }
    const kickoffFrom = new Date(kickoffFromStr);
    const kickoffTo = new Date(kickoffToStr);
    return this.flashscoreService.findMatchScore(homeTeam, awayTeam, kickoffFrom, kickoffTo, leagueKey);
  }
}
