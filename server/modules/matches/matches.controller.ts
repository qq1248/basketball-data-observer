import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
  Res,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import { NeedLogin, DRIZZLE_DATABASE } from '@lark-apaas/fullstack-nestjs-core';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { MatchesService } from './matches.service';
import { dailyReview } from '@server/database/schema';
import type {
  MatchListResponse,
  MatchDetailResponse,
  CreateMatchRequest,
  UpdateMatchRequest,
  MatchOddsResponse,
  DateStatsResponse,
  BatchUpsertResponse,
  DataCheckResponse,
   MatchStatsResponse,
   LiveScoreResponse,
   FootballBacktestResponse,
   PredictionAccuracyResponse,
    OddsTrendResponse,
    MatchMultiSourceResponse,
     RuleBacktestResponse,
     DailyReviewResponse,
   } from '@shared/api.interface';

function validateUuid(value: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new BadRequestException(`ID格式错误，必须是有效的UUID`);
  }
}

@Controller('api/matches')
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  @Get('today/list')
  async getTodayMatches(): Promise<MatchListResponse> {
    const now = new Date();
    const beijingMs = now.getTime() + 8 * 3600 * 1000;
    const today = new Date(beijingMs).toISOString().slice(0, 10);
    return this.matchesService.getListByDate({ date: today });
  }

  @Get('live-scores')
  async getLiveScores(
    @Query('date') date?: string,
  ): Promise<LiveScoreResponse> {
    let targetDate = date;
    if (!targetDate) {
      const now = new Date();
      const beijingMs = now.getTime() + 8 * 3600 * 1000;
      targetDate = new Date(beijingMs).toISOString().slice(0, 10);
    }
    return this.matchesService.getLiveScores(targetDate);
  }

  @Get()
  async getMatches(
    @Query('date') date?: string,
    @Query('league') league?: string,
    @Query('confidence') confidence?: 'high' | 'medium' | 'low',
    @Query('direction') direction?: string,
    @Query('sort') sort?: 'kickoff_asc' | 'confidence_desc',
    @Query('status') status?: 'upcoming' | 'finished',
    @Query('source') source?: 'sporttery' | 'beidan',
    @Query('sourceFilter') sourceFilter?: 'all' | 'official' | 'jingcai' | 'beidan' | 'international' | 'others',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<MatchListResponse> {
    let targetDate = date;
    if (!targetDate || targetDate === 'today') {
      const now = new Date();
      const beijingMs = now.getTime() + 8 * 3600 * 1000;
      targetDate = new Date(beijingMs).toISOString().slice(0, 10);
    }
    return this.matchesService.getListByDate({
      date: targetDate,
      league,
      confidence,
      direction,
      sort,
      status,
      source,
      sourceFilter,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  @Get('date-stats')
  async getDateStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('source') source?: string,
  ): Promise<DateStatsResponse> {
    const now = new Date();
    const beijingMs = now.getTime() + 8 * 3600 * 1000;
    const today = new Date(beijingMs).toISOString().slice(0, 10);
    const start = startDate || this.getDateOffset(today, -14);
    const end = endDate || this.getDateOffset(today, 2);
    return this.matchesService.getDateStats(start, end, source);
  }

  @Get('backtest')
  async getBacktest(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('days') days?: string,
  ): Promise<FootballBacktestResponse> {
    return this.matchesService.getBacktest({
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
          eq(dailyReview.sport, 'football'),
          eq(dailyReview.source, sourceVal),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
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
      matches: [],
      summary: row.summary ?? null,
      createdAt: row.createdAt?.toISOString() ?? '',
      updatedAt: row.updatedAt?.toISOString() ?? '',
    };
  }

  @Get('stats')
  async getStats(): Promise<MatchStatsResponse> {
    return this.matchesService.getStats();
  }

  @Get('prediction-accuracy')
  async getPredictionAccuracy(
    @Query('days') days?: string,
  ): Promise<PredictionAccuracyResponse> {
    const parsedDays = days !== undefined ? Number(days) : 30;
    const clampedDays = Math.max(7, Math.min(90, parsedDays));
    return this.matchesService.getPredictionAccuracy(clampedDays);
  }

  @Get('rule-backtest')
  async getRuleBacktest(): Promise<RuleBacktestResponse> {
    return this.matchesService.getRuleBacktest();
  }

  @Get('data-check')
  async dataCheck(): Promise<DataCheckResponse> {
    return this.matchesService.runDataCheck('matches');
  }

  @NeedLogin()
  @Post('recalc-total-goals-hits')
  async recalcTotalGoalsHits(): Promise<{ updatedCount: number }> {
    return this.matchesService.recalculateTotalGoalsHits();
  }

  @NeedLogin()
  @Post('backfill-injury-reports')
  async backfillInjuryReports(): Promise<{ processed: number; inserted: number; skipped: number }> {
    return this.matchesService.backfillFootballInjuryReports();
  }

  @NeedLogin()
  @Post('batch-upsert')
  async batchUpsert(
    @Req() req: Request,
    @Body() body: { items: CreateMatchRequest[] },
    @Query('skipValidation') skipValidation?: string,
  ): Promise<BatchUpsertResponse> {
    const { userId } = req.userContext;
    if (skipValidation === 'true') {
      return this.matchesService.batchUpsert(body.items, userId);
    }
    return this.matchesService.batchUpsertWithValidation(body.items, userId);
  }

  private getDateOffset(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  @Get('export')
  async exportMatches(
    @Query('format') format: 'csv' | 'json' = 'csv',
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.matchesService.exportAll();
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="matches.json"');
      res.json(data);
      return;
    }
    const headers = [
      'match_no', 'league', 'home_team', 'away_team', 'kickoff_time',
      'match_date', 'match_status', 'prediction_direction', 'confidence',
      'handicap', 'handicap_recommendation', 'handicap_win_prob',
      'total_goals', 'total_pick', 'total_pick_prob',
      'source', 'source_match_id', 'home_score', 'away_score',
    ];
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    };
    const rows = data.map((m) => [
      m.matchNo, m.league, m.homeTeam, m.awayTeam,
      m.kickoffTime, m.matchDate, m.matchStatus,
      m.predictionDirection, m.confidence,
      m.handicap, m.handicapRecommendation, m.handicapWinProb,
      m.totalGoals, m.totalPick ?? '', m.totalPickProb ?? 0,
      m.source ?? 'sporttery', m.sourceMatchId ?? '', m.homeScore ?? '', m.awayScore ?? '',
    ].map(escape).join(','));
    const csv = '\ufeff' + [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="matches.csv"');
    res.send(csv);
  }

  @Get(':id/odds')
  async getMatchOdds(@Param('id') id: string): Promise<MatchOddsResponse> {
    validateUuid(id);
    return this.matchesService.getMatchOdds(id);
  }

  @Get(':id/odds-trend')
  async getOddsTrend(@Param('id') id: string): Promise<OddsTrendResponse> {
    validateUuid(id);
    return this.matchesService.getOddsTrend(id);
  }

  @Get(':id/multi-source')
  async getMultiSource(@Param('id') id: string): Promise<MatchMultiSourceResponse> {
    validateUuid(id);
    return this.matchesService.getMultiSource(id);
  }

  @Get(':id')
  async getMatch(@Param('id') id: string): Promise<MatchDetailResponse> {
    validateUuid(id);
    return this.matchesService.getById(id);
  }

  @NeedLogin()
  @Post()
  async createMatch(
    @Req() req: Request,
    @Body() dto: CreateMatchRequest,
  ): Promise<MatchDetailResponse> {
    const { userId } = req.userContext;
    return this.matchesService.create(dto, userId);
  }

  @NeedLogin()
  @Patch(':id')
  async updateMatch(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMatchRequest,
  ): Promise<MatchDetailResponse> {
    validateUuid(id);
    const { userId } = req.userContext;
    return this.matchesService.update(id, dto, userId);
  }

  @NeedLogin()
  @Delete(':id')
  async deleteMatch(@Param('id') id: string): Promise<{ success: boolean }> {
    validateUuid(id);
    return this.matchesService.remove(id);
  }
}
