import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  BadRequestException,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { WnbaSyncService } from './wnba-sync.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { isBeidanEnabled } from '@server/config/secrets.config';
import { SportteryService } from './sporttery.service';
import { AuthService } from '../auth/auth.service';
import type {
  SyncHealthResponse,
  SyncTriggerResponse,
} from '@shared/api.interface';
import type {
  SportteryExternalPayload,
  OddsApiTriggerResult,
  SyncRefreshOddsResult,
  BeidanSyncPayload,
  BeidanSyncResult,
  IngestFootballPayload,
  IngestBasketballPayload,
  IngestBeidanPayload,
  IngestResult,
} from './sporttery.types';
import { z } from 'zod';
import { SinaInjuryService } from './sina-injury.service';
import type { Request } from 'express';
import { FootballAutoCheckService } from './football-auto-check.service';
import { BasketballAutoCheckService } from '../basketball/basketball-auto-check.service';
import { BasketballService } from '../basketball/basketball.service';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

const ExternalMatchSchema = z.object({
  matchNo: z.union([z.string(), z.number()]),
  matchDate: z.string(),
  league: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  kickoffTime: z.string().optional(),
  matchStatus: z.string().optional(),
  oddsOpenHome: z.union([z.string(), z.number()]).optional(),
  oddsOpenDraw: z.union([z.string(), z.number()]).optional(),
  oddsOpenAway: z.union([z.string(), z.number()]).optional(),
  handicap: z.string().optional(),
  handicapRecommendation: z.string().optional(),
  overUnder: z.string().optional(),
  totalGoals: z.union([z.string(), z.number()]).optional(),
});

const ExternalBasketballMatchSchema = z.object({
  matchNo: z.union([z.string(), z.number()]),
  matchDate: z.string(),
  league: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  kickoffTime: z.string().optional(),
  matchStatus: z.string().optional(),
  handicap: z.string().optional(),
  totalLine: z.string().optional(),
  homeWinOdds: z.union([z.string(), z.number()]).optional(),
  awayWinOdds: z.union([z.string(), z.number()]).optional(),
  handicapOddsHome: z.union([z.string(), z.number()]).optional(),
  handicapOddsAway: z.union([z.string(), z.number()]).optional(),
  totalOddsOver: z.union([z.string(), z.number()]).optional(),
  totalOddsUnder: z.union([z.string(), z.number()]).optional(),
});

const SyncPayloadSchema = z.object({
  football: z.array(ExternalMatchSchema).max(500).optional(),
  basketball: z.array(ExternalBasketballMatchSchema).max(500).optional(),
});

const BeidanMatchSchema = z.object({
  matchNo: z.union([z.string(), z.number()]),
  matchDate: z.string(),
  league: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  kickoffTime: z.string().optional(),
  matchStatus: z.string().optional(),
  spHome: z.union([z.string(), z.number()]).optional(),
  spDraw: z.union([z.string(), z.number()]).optional(),
  spAway: z.union([z.string(), z.number()]).optional(),
  handicap: z.string().optional(),
  totalGoals: z.union([z.string(), z.number()]).optional(),
  halfFull: z.string().optional(),
  score: z.string().optional(),
  homeWinProb: z.number().optional(),
  drawProb: z.number().optional(),
  awayWinProb: z.number().optional(),
  predictionDirection: z.string().optional(),
  confidence: z.number().optional(),
  intel: z.string().optional(),
});

const BeidanSyncPayloadSchema = z.object({
  matches: z.array(BeidanMatchSchema).max(500),
});

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count += 1;
  return true;
}

function getClientIp(headers: Record<string, string | string[] | undefined>): string {
  const fwd = headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string') return realIp;
  return 'unknown';
}

@Controller('api')
export class SportteryController {
  constructor(
    private readonly sportteryService: SportteryService,
    private readonly wnbaSyncService: WnbaSyncService,
    private readonly syncSchedulerService: SyncSchedulerService,
    private readonly authService: AuthService,
    private readonly sinaInjuryService: SinaInjuryService,
    private readonly footballAutoCheckService: FootballAutoCheckService,
    private readonly basketballAutoCheckService: BasketballAutoCheckService,
    private readonly basketballService: BasketballService,
  ) {}

  @Get('health/sync')
  async getSyncHealth(): Promise<SyncHealthResponse> {
    return this.sportteryService.getHealth();
  }

  @Get('wnba/status')
  async getWnbaSyncStatus(): Promise<{
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    lastSource: string | null;
    lastUpdatedCount: number;
    status: string;
  }> {
    return this.wnbaSyncService.getStatus();
  }

  @Get('sync/scheduler/status')
  async getSchedulerStatus(): Promise<{
    tasks: {
      taskName: string;
      description: string;
      cron: string;
      lastRunAt: string | null;
      lastStatus: string | null;
      lastErrorMessage: string | null;
      lastRecordsUpdated: number;
      nextRunAt: string | null;
    }[];
  }> {
    const tasks = await this.syncSchedulerService.getStatus();
    return { tasks };
  }

  @Get('sync/scheduler/logs')
  async getSchedulerLogs(@Query('limit') limit?: string): Promise<{
    logs: {
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
    }[];
  }> {
    const n = limit ? Math.min(Number(limit) || 30, 100) : 30;
    const logs = await this.syncSchedulerService.getRecentLogs(n);
    return { logs };
  }

  @Post('sync/scheduler/run/:taskName')
  async triggerTask(
    @Req() req: { userContext?: { userId?: string } },
    @Param('taskName') taskName: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (!req.userContext?.userId) {
      throw new UnauthorizedException();
    }
    return this.syncSchedulerService.runTask(taskName, 'manual');
  }

  @Get('wnba/matches')
  async getWnbaMatches(@Query('limit') limit?: string): Promise<{
    matches: {
      id: string;
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: Date;
      matchStatus: string;
      homeScore: number | null;
      awayScore: number | null;
      homeWinProb: number;
      awayWinProb: number;
      predictionDirection: string;
      handicapLineNum: string | null;
      handicapRecommendation: string;
      totalLineNum: string | null;
      totalDirection: string;
      confidence: number;
    }[];
    syncStatus: {
      lastSuccessAt: string | null;
      lastAttemptAt: string | null;
      lastError: string | null;
      lastSource: string | null;
      lastUpdatedCount: number;
      status: string;
    };
  }> {
    const n = limit ? Math.min(Number(limit) || 30, 100) : 30;
    const matches = await this.wnbaSyncService.getWnbaMatches(n);
    const status = this.wnbaSyncService.getStatus();
    return { matches, syncStatus: status };
  }

  @Post('wnba/sync-now')
  async triggerWnbaSync(
    @Req() req: { userContext?: { userId?: string } },
  ): Promise<{
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    lastSource: string | null;
    lastUpdatedCount: number;
    status: string;
  }> {
    if (!req.userContext?.userId) {
      throw new UnauthorizedException();
    }
    return this.wnbaSyncService.triggerManual();
  }

  @Post('sync/sporttery')
  async triggerSync(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body?: SportteryExternalPayload,
  ): Promise<SyncTriggerResponse> {
    const ip = getClientIp(headers);
    if (!checkRateLimit(ip)) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const token = headers['x-sync-token'];
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }

    const hasExternalData =
      (body?.football && body.football.length > 0) ||
      (body?.basketball && body.basketball.length > 0);

    if (hasExternalData && body) {
      const parsed = SyncPayloadSchema.safeParse(body);
      if (!parsed.success) {
        throw new UnauthorizedException();
      }
      const result = await this.sportteryService.receiveExternalData(
        parsed.data as SportteryExternalPayload,
      );
      return {
        triggered: true,
        football: {
          inserted: result.football.inserted,
          updated: result.football.updated,
          skipped: result.football.skipped,
          skipReasons: result.football.skipReasons ?? [],
        },
        basketball: {
          inserted: result.basketball.inserted,
          updated: result.basketball.updated,
          skipped: result.basketball.skipped,
          skipReasons: result.basketball.skipReasons ?? [],
        },
        message: 'external data ingested',
      };
    }

    const result = await this.sportteryService.triggerSync();
    return {
      triggered: true,
      football: {
        inserted: result.football.inserted,
        updated: result.football.updated,
        skipped: result.football.skipped,
        skipReasons: result.football.skipReasons ?? [],
      },
      basketball: {
        inserted: result.basketball.inserted,
        updated: result.basketball.updated,
        skipped: result.basketball.skipped,
        skipReasons: result.basketball.skipReasons ?? [],
      },
      message: 'built-in fetch attempted (may be WAF-blocked)',
    };
  }

  @Post('sync/beidan')
  async syncBeidan(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: BeidanSyncPayload,
  ): Promise<SyncTriggerResponse> {
    const ip = getClientIp(headers);
    if (!checkRateLimit(ip)) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!isBeidanEnabled()) {
      throw new ServiceUnavailableException(
        '足球二台数据源未启用。请设置环境变量 BEIDAN_ENABLED=true 后再调用。',
      );
    }

    const token = headers['x-sync-token'];
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }

    const parsed = BeidanSyncPayloadSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException();
    }

    const result: BeidanSyncResult = await this.sportteryService.receiveBeidanData(
      parsed.data.matches,
    );

    return {
      triggered: true,
      football: { inserted: 0, updated: 0, skipped: 0, skipReasons: [] },
      basketball: { inserted: 0, updated: 0, skipped: 0, skipReasons: [] },
      beidan: {
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        skipReasons: result.skipReasons,
      },
      message: 'beidan data ingested',
    };
  }

  @Post('sync/ingest/football')
  async ingestFootball(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: IngestFootballPayload,
  ): Promise<IngestResult> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    if (!body?.matches || !Array.isArray(body.matches)) {
      throw new BadRequestException('matches must be an array');
    }
    return this.sportteryService.ingestFootball(body.matches);
  }

  @Post('sync/ingest/basketball')
  async ingestBasketball(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: IngestBasketballPayload,
  ): Promise<IngestResult> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    if (!body?.matches || !Array.isArray(body.matches)) {
      throw new BadRequestException('matches must be an array');
    }
    return this.sportteryService.ingestBasketball(body.matches);
  }

  @Post('sync/ingest/beidan')
  async ingestBeidan(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: IngestBeidanPayload,
  ): Promise<IngestResult> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    if (!body?.matches || !Array.isArray(body.matches)) {
      throw new BadRequestException('matches must be an array');
    }
    return this.sportteryService.ingestBeidan(body.matches);
  }

  @Post('health/sync/odds-api')
  async triggerOddsApiSync(): Promise<OddsApiTriggerResult> {
    const result = await this.sportteryService.triggerOddsApiSync();
    return {
      enabled: this.sportteryService.isOddsApiEnabled(),
      sportsSynced: result.sportsSynced,
      wnbaGames: result.wnbaGames,
      nbaGames: result.nbaGames,
      nbaUpdated: result.nbaUpdated,
      eplGames: result.eplGames,
      success: result.success,
      lastSyncAt: result.success ? new Date().toISOString() : null,
      remaining: result.remaining,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      excludedMarkets: result.excludedMarkets,
    };
  }

  @Post('odds/sync/the-odds-api')
  async syncTheOddsApi(): Promise<OddsApiTriggerResult> {
    const result = await this.sportteryService.triggerOddsApiSync();
    return {
      enabled: this.sportteryService.isOddsApiEnabled(),
      sportsSynced: result.sportsSynced,
      wnbaGames: result.wnbaGames,
      nbaGames: result.nbaGames,
      nbaUpdated: result.nbaUpdated,
      eplGames: result.eplGames,
      success: result.success,
      lastSyncAt: result.success ? new Date().toISOString() : null,
      remaining: result.remaining,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      excludedMarkets: result.excludedMarkets,
    };
  }

  @Post('sync/refresh-live')
  @HttpCode(202)
  async refreshLive(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ accepted: boolean }> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    this.sportteryService.triggerLiveRefreshAsync();
    return { accepted: true };
  }

  @Post('sync/refresh-live-user')
  @HttpCode(202)
  async refreshLiveForUser(@Req() req: Request): Promise<{ accepted: boolean }> {
    const appSession = req.cookies?.['app_session'];
    if (!appSession) {
      throw new UnauthorizedException('未登录');
    }
    const payload = await this.authService.verifyToken(appSession);
    if (!payload) {
      throw new UnauthorizedException('未登录');
    }
    this.sportteryService.triggerLiveRefreshAsync();
    return { accepted: true };
  }

  @Post('sync/refresh-odds')
  async refreshOdds(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<SyncRefreshOddsResult> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    const result = await this.sportteryService.triggerOddsRefresh();
    return { triggered: true, ...result };
  }

  @Post('sporttery/backfill-rules')
  async backfillRules(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{
    triggered: boolean;
    basketballFilled: number;
    footballFilled: number;
    basketballTotalEmpty: number;
    footballTotalEmpty: number;
  }> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    const result = await this.sportteryService.backfillEmptyModelRules();
    return { triggered: true, ...result };
  }

  @Post('sporttery/backfill-deep')
  async backfillDeep(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{
    triggered: boolean;
    footballChecked: number;
    footballUpdated: number;
    footballErrors: number;
    basketballChecked: number;
    basketballUpdated: number;
    basketballErrors: number;
  }> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    const result = await this.sportteryService.backfillDeepData();
    return { triggered: true, ...result };
  }

  @Post('sporttery/backfill-derived')
  async backfillDerived(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{
    triggered: boolean;
    checked: number;
    updated: number;
    failed: number;
  }> {
    if (!this.sportteryService.isSyncWriteEnabled()) {
      throw new ServiceUnavailableException(
        'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（长度≥32位）',
      );
    }
    const token = headers['x-sync-token'];
    if (typeof token !== 'string' || !this.sportteryService.verifySyncToken(token)) {
      throw new UnauthorizedException();
    }
    const result = await this.sportteryService.backfillDerivedScoreData();
    return { triggered: true, ...result };
  }

  @NeedLogin()
  @Get('admin/sporttery/backfill-deep/status')
  async getDeepBackfillStatus(): Promise<{
    status: 'idle' | 'running' | 'done' | 'error';
    startedAt: string | null;
    finishedAt: string | null;
    footballChecked: number;
    footballUpdated: number;
    footballErrors: number;
    basketballChecked: number;
    basketballUpdated: number;
    basketballErrors: number;
    errorMessage?: string;
  }> {
    const s = this.sportteryService.getDeepBackfillStatus();
    return {
      status: s.status,
      startedAt: s.startedAt ? s.startedAt.toISOString() : null,
      finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
      footballChecked: s.footballChecked,
      footballUpdated: s.footballUpdated,
      footballErrors: s.footballErrors,
      basketballChecked: s.basketballChecked,
      basketballUpdated: s.basketballUpdated,
      basketballErrors: s.basketballErrors,
      errorMessage: s.errorMessage,
    };
  }

  @NeedLogin()
  @Post('admin/sporttery/backfill-deep')
  async adminBackfillDeep(): Promise<{
    accepted: boolean;
    message: string;
  }> {
    const result = this.sportteryService.startDeepBackfillAsync();
    return result;
  }

  @NeedLogin()
  @Post('admin/sporttery/backfill-nba-sourceid')
  async adminBackfillNbaSourceId(): Promise<{
    checked: number;
    updated: number;
    failed: number;
    details: Array<{ matchNo: string; sourceId: string; homeTeam: string; awayTeam: string }>;
  }> {
    const result = await this.sportteryService.backfillNbaSourceIds();
    return result;
  }

  @NeedLogin()
  @Post('admin/sporttery/backfill-derived')
  async adminBackfillDerived(): Promise<{
    triggered: boolean;
    checked: number;
    updated: number;
    failed: number;
  }> {
    const result = await this.sportteryService.backfillDerivedScoreData();
    return { triggered: true, ...result };
  }

  @NeedLogin()
  @Post('admin/sporttery/trigger-sync')
  async adminTriggerSync(): Promise<SyncTriggerResponse> {
    const result = await this.sportteryService.triggerSync();
    return {
      triggered: true,
      football: {
        inserted: result.football.inserted,
        updated: result.football.updated,
        skipped: result.football.skipped,
        skipReasons: result.football.skipReasons ?? [],
      },
      basketball: {
        inserted: result.basketball.inserted,
        updated: result.basketball.updated,
        skipped: result.basketball.skipped,
        skipReasons: result.basketball.skipReasons ?? [],
      },
      message: 'manual sync triggered by admin',
    };
  }

  @NeedLogin()
  @Post('admin/sporttery/recalc-upcoming')
  async adminRecalcUpcoming(): Promise<{
    triggered: boolean;
    recalculated: number;
    skipped: number;
    errors: number;
  }> {
    const result = await this.sportteryService.recalcFootballUpcomingPredictions();
    return { triggered: true, ...result };
  }

  @NeedLogin()
  @NeedLogin()
  @Post('admin/sporttery/recalc-basketball-upcoming')
  async adminRecalcBasketballUpcoming(): Promise<{
    triggered: boolean;
    recalculated: number;
    skipped: number;
    errors: number;
  }> {
    const result = await this.sportteryService.recalcBasketballUpcomingPredictions();
    return { triggered: true, ...result };
  }

  @NeedLogin()
  @Post('admin/sporttery/resolve-stale-live-basketball')
  async adminResolveStaleLiveBasketball(): Promise<{
    total: number;
    resolvedToFinished: number;
    resolvedToPending: number;
    stillLive: number;
  }> {
    return this.sportteryService.autoResolveStaleLiveBasketball();
  }

  @NeedLogin()
  @Post('admin/sporttery/sentinel-scan-basketball')
  async adminSentinelScanBasketball(): Promise<{
    staleUpcoming: { scanned: number; staleCount: number; logged: number };
  }> {
    const result = await this.basketballService.scanStaleUpcomingMatches();
    return { staleUpcoming: result };
  }

  @NeedLogin()
  @Post('admin/sporttery/sentinel-test-handicap')
  async adminSentinelTestHandicap(
    @Body() body: {
      homeTeam: string;
      awayTeam: string;
      handicapLineNum: number;
      evidenceSource: string;
      prevHomeTeam?: string;
      prevAwayTeam?: string;
      prevHandicapLine?: number;
    },
  ): Promise<{ allowed: boolean; reason?: string }> {
    return this.basketballService.validateHandicapSign(body);
  }

  @NeedLogin()
  @Post('admin/sporttery/check-stale-upcoming-football')
  async adminCheckStaleUpcomingFootball(): Promise<{
    total: number;
    bySource: Record<string, number>;
    byHourBucket: Record<string, number>;
  }> {
    return this.sportteryService.autoResolveStaleUpcomingFootball();
  }

  @Post('admin/sporttery/recalc-by-date')
  async adminRecalcByDate(@Body() body: { date: string }): Promise<{ triggered: boolean; date: string }> {
    void this.sportteryService.recalcFootballPredictionsByDate(body.date);
    return { triggered: true, date: body.date };
  }

  @NeedLogin()
  @Post('admin/sporttery/recalc-v9-to-v12')
  async adminRecalcV9ToV12(@Body() body?: { days?: number }): Promise<{ triggered: boolean; days: number }> {
    const days = body?.days ?? 14;
    void this.sportteryService.recalcV9FootballToV12(days);
    return { triggered: true, days };
  }

   @NeedLogin()
   @Post('admin/sporttery/trigger-beidan')
   async adminTriggerBeidanSync(): Promise<{
     triggered: boolean;
     inserted: number;
     updated: number;
     skipped: number;
     beidanEnabled: boolean;
   }> {
     const beidanEnabled = isBeidanEnabled();
     if (!beidanEnabled) {
       return { triggered: false, inserted: 0, updated: 0, skipped: 0, beidanEnabled: false };
     }
     const result = await this.sportteryService.triggerBeidanSync();
     return {
       triggered: true,
       inserted: result.inserted,
       updated: result.updated,
       skipped: result.skipped,
       beidanEnabled: true,
     };
   }

  @NeedLogin()
  @Post('admin/sporttery/backfill-hits')
  async adminBackfillHits(@Body() body: { startDate?: string; endDate?: string; sport?: string }): Promise<{
    triggered: boolean;
    sport: string;
  }> {
    const sport = body.sport ?? 'both';
    if (sport === 'football' || sport === 'both') {
      void this.sportteryService.backfillFootballHits(body.startDate, body.endDate);
    }
    if (sport === 'basketball' || sport === 'both') {
      void this.sportteryService.backfillBasketballHits(body.startDate, body.endDate);
    }
    return { triggered: true, sport };
  }

  @NeedLogin()
  @Post('admin/sporttery/sina-injury-backfill')
  async sinaInjuryBackfill(@Body() body: { articleUrl?: string }): Promise<{
    articleUrl: string;
    articleTitle: string;
    articleDate: string;
    totalMatchesInArticle: number;
    matchedMatches: number;
    unmatchedTeams: string[];
    inserted: number;
    updated: number;
    skipped: number;
    errors: string[];
  }> {
    return this.sinaInjuryService.backfillSinaInjuries(body.articleUrl);
  }

  @Post('football/auto-check')
  async triggerFootballAutoCheck(
    @Req() req: { userContext?: { userId?: string } },
  ): Promise<{
    ok: boolean;
    reportId?: string;
    totalIssues?: number;
    autoFixed?: number;
    needsManual?: number;
    durationMs?: number;
    message?: string;
  }> {
    if (!req.userContext?.userId) {
      throw new UnauthorizedException();
    }
    const report = await this.footballAutoCheckService.runCheck('manual');
    return {
      ok: true,
      reportId: report.id,
      totalIssues: report.totalIssues,
      autoFixed: report.autoFixed,
      needsManual: report.needsManual,
      durationMs: report.durationMs,
    };
  }

  @NeedLogin()
  @Post('sporttery/coverage-check')
  async triggerCoverageCheck(
    @Req() req: { userContext?: { userId?: string } },
  ): Promise<{
    ok: boolean;
    football: {
      reportId: string;
      totalIssues: number;
      autoFixed: number;
      needsManual: number;
    };
    basketball: {
      reportId: string;
      totalIssues: number;
      autoFixed: number;
      needsManual: number;
    };
  }> {
    if (!req.userContext?.userId) {
      throw new UnauthorizedException();
    }
    const [fbReport, bbReport] = await Promise.all([
      this.footballAutoCheckService.runCheck('manual', 'coverage_check'),
      this.basketballAutoCheckService.runCheck('manual', 'coverage_check'),
    ]);
    return {
      ok: true,
      football: {
        reportId: fbReport.id,
        totalIssues: fbReport.totalIssues,
        autoFixed: fbReport.autoFixed,
        needsManual: fbReport.needsManual,
      },
      basketball: {
        reportId: bbReport.id,
        totalIssues: bbReport.totalIssues,
        autoFixed: bbReport.autoFixed,
        needsManual: bbReport.needsManual,
      },
    };
  }
}
