import {
  Controller,
  Get,
  ForbiddenException,
  Req,
  Post,
  Query,
  BadRequestException,
  Body,
  Delete,
  Param,
  Patch,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { NeedLogin, DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { users, userData, matches, basketballMatches, adminAuditLogs, appSettings, syncTaskLogs, teamsElo, injuryReports, backtestResults } from '@server/database/schema';
import { MlTrainingService } from '@server/modules/ml-ensemble/ml-training.service';
import { GbdtService, GbdtModel } from '@server/modules/ml-ensemble/gbdt.service';
import { eq, gt, gte, lt, sql, count, desc, like, or, and, inArray, ilike, isNull, isNotNull } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import { AuditService } from './audit.service';
import { SportteryService } from '../sporttery/sporttery.service';
import { SyncSchedulerService } from '../sporttery/sync-scheduler.service';
import { EloHistoryService } from '../elo/elo-history.service';
import type { SyncConfig, DataSourceSettingsResponse } from '../sporttery/sporttery.types';
import {
  shouldSkipPredictionWrite,
  hasPredictionFields,
  isDataDrivenEngine,
} from '@server/common/utils/basketball-prediction-guard';

@Controller('api/admin')
export class AdminController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly sportteryService: SportteryService,
    private readonly syncSchedulerService: SyncSchedulerService,
    private readonly eloHistoryService: EloHistoryService,
    private readonly mlTrainingService: MlTrainingService,
    private readonly gbdtService: GbdtService,
  ) {}

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip ?? '';
  }

  private async requireAdmin(req: Request): Promise<{ userId: string; email: string; role: string }> {
    const token = req.cookies?.['app_session'];
    if (!token) {
      if (process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_TOKEN) {
        const devToken = req.headers['x-dev-admin-token'];
        if (devToken && devToken === process.env.ADMIN_DEV_TOKEN) {
          return { userId: 'dev_admin', email: 'dev@local', role: 'admin' };
        }
      }
      throw new ForbiddenException('无权访问');
    }
    const payload = await this.authService.verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      throw new ForbiddenException('无权访问');
    }
    return payload;
  }

  private async assertNotLastAdmin(targetUserId: string): Promise<void> {
    const adminCount = await this.db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, 'admin'));
    const total = Number(adminCount[0]?.count ?? 0);
    if (total <= 1) {
      const target = await this.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
      if (target[0]?.role === 'admin') {
        throw new ConflictException('系统必须至少保留一名管理员');
      }
    }
  }

  @Get('users')
  async listUsers(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('role') roleFilter?: string,
    @Query('sort') sort?: string,
  ) {
    await this.requireAdmin(req);

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize || '20', 10) || 20));
    const offset = (pageNum - 1) * pageSizeNum;

    const conditions: any[] = [];
    if (search) {
      conditions.push(like(users.email, `%${search}%`));
    }
    if (roleFilter && ['admin', 'user'].includes(roleFilter)) {
      conditions.push(eq(users.role, roleFilter));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderCol =
      sort === 'lastActive' ? users.lastActiveAt :
      sort === 'createdAt' ? users.createdAt :
      sort === 'favorites' ? sql`favorites_count` :
      users.createdAt;

    const listQuery = this.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        lastActiveAt: users.lastActiveAt,
        favoritesCount: sql<number>`COALESCE(jsonb_array_length(${userData.favorites}), 0)`.as('favorites_count'),
        followedTeamsCount: sql<number>`COALESCE(jsonb_array_length(${userData.followedTeams}), 0)`.as('followed_teams_count'),
      })
      .from(users)
      .leftJoin(userData, eq(userData.userId, users.id));

    if (where) listQuery.where(where);
    listQuery.orderBy(desc(orderCol)).limit(pageSizeNum).offset(offset);

    const [items, countResult] = await Promise.all([
      listQuery,
      this.db
        .select({ count: count() })
        .from(users)
        .where(where),
    ]);

    return {
      items,
      total: Number(countResult[0]?.count ?? 0),
      page: pageNum,
      pageSize: pageSizeNum,
    };
  }

  @Get('stats/activity')
  async getActivityStats(@Req() req: Request) {
    await this.requireAdmin(req);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

    const [total, todayNew, todayActive, online] = await Promise.all([
      this.db.select({ count: count() }).from(users),
      this.db.select({ count: count() }).from(users).where(gte(users.createdAt, todayStart)),
      this.db.select({ count: count() }).from(users).where(gte(users.lastActiveAt, todayStart)),
      this.db.select({ count: count() }).from(users).where(gte(users.lastActiveAt, fifteenMinAgo)),
    ]);

    return {
      totalUsers: Number(total[0]?.count ?? 0),
      todayNew: Number(todayNew[0]?.count ?? 0),
      todayActive: Number(todayActive[0]?.count ?? 0),
      online: Number(online[0]?.count ?? 0),
    };
  }

  @Get('stats')
  async getStats(@Req() req: Request) {
    const activity = await this.getActivityStats(req);
    return {
      totalUsers: activity.totalUsers,
      newToday: activity.todayNew,
      activeToday: activity.todayActive,
      onlineNow: activity.online,
    };
  }

  @Get('backtest/results')
  async getBacktestResults(@Req() req: Request) {
    await this.requireAdmin(req);
    const rows = await this.db
      .select({
        id: backtestResults.id,
        engineVersion: backtestResults.engineVersion,
        sport: backtestResults.sport,
        sampleScope: backtestResults.sampleScope,
        source: backtestResults.source,
        leagueFilter: backtestResults.leagueFilter,
        dateFrom: backtestResults.dateFrom,
        dateTo: backtestResults.dateTo,
        sampleSize: backtestResults.sampleSize,
        wdwHitRate: backtestResults.wdwHitRate,
        handicapHitRate: backtestResults.handicapHitRate,
        overunderHitRate: backtestResults.overunderHitRate,
        wdwSample: backtestResults.wdwSample,
        handicapSample: backtestResults.handicapSample,
        overunderSample: backtestResults.overunderSample,
        note: backtestResults.note,
        calculatedAt: backtestResults.calculatedAt,
      })
      .from(backtestResults)
      .orderBy(desc(backtestResults.calculatedAt));
    return { items: rows };
  }

  @Post('ml/train/football')
  async trainFootballModel(@Req() req: Request, @Body() body: { nEstimators?: number; learningRate?: number }) {
    await this.requireAdmin(req);
    const result = await this.mlTrainingService.trainFootballModel(
      body?.nEstimators ?? 50,
      body?.learningRate ?? 0.1,
      42,
    );
    const trainedModel = new GbdtModel(result.model);
    this.gbdtService.setFootballModel(trainedModel);
    return {
      trainSize: result.trainSize,
      testSize: result.testSize,
      trainAccuracy: result.trainAccuracy,
      testAccuracy: result.testAccuracy,
      nEstimators: result.model.nEstimators,
      learningRate: result.model.learningRate,
      featureImportance: result.featureImportance,
      trees: result.model.trees.length,
      modelParams: result.model,
    };
  }

  @Post('ml/train/basketball')
  async trainBasketballModel(@Req() req: Request, @Body() body: { nEstimators?: number; learningRate?: number }) {
    await this.requireAdmin(req);
    const result = await this.mlTrainingService.trainBasketballModel(
      body?.nEstimators ?? 50,
      body?.learningRate ?? 0.1,
      42,
    );
    const trainedModel = new GbdtModel(result.model);
    this.gbdtService.setBasketballModel(trainedModel);
    return {
      trainSize: result.trainSize,
      testSize: result.testSize,
      trainAccuracy: result.trainAccuracy,
      testAccuracy: result.testAccuracy,
      nEstimators: result.model.nEstimators,
      learningRate: result.model.learningRate,
      featureImportance: result.featureImportance,
      trees: result.model.trees.length,
      modelParams: result.model,
    };
  }

  @Get('ml/model-info')
  async getMlModelInfo(@Req() req: Request) {
    await this.requireAdmin(req);
    return {
      football: this.gbdtService.getFootballModelInfo(),
      basketball: this.gbdtService.getBasketballModelInfo(),
    };
  }

  @Get('stats/content')
  async getContentStats(@Req() req: Request) {
    await this.requireAdmin(req);

    const [
      footballTotal,
      basketballTotal,
      fbNoPrediction,
      bbNoPrediction,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(matches),
      this.db.select({ count: count() }).from(basketballMatches),
      this.db
        .select({ count: count() })
        .from(matches)
        .where(eq(matches.predictionDirection, '')),
      this.db
        .select({ count: count() })
        .from(basketballMatches)
        .where(eq(basketballMatches.predictionDirection, '')),
    ]);

    return {
      footballTotal: Number(footballTotal[0]?.count ?? 0),
      basketballTotal: Number(basketballTotal[0]?.count ?? 0),
      footballNoPrediction: Number(fbNoPrediction[0]?.count ?? 0),
      basketballNoPrediction: Number(bbNoPrediction[0]?.count ?? 0),
    };
  }

  @Post('users/role')
  async updateUserRole(
    @Req() req: Request,
    @Body() body: { userId: string; role: string },
  ) {
    const admin = await this.requireAdmin(req);
    const { userId, role } = body;
    if (!['user', 'admin'].includes(role)) {
      throw new BadRequestException('无效角色');
    }
    if (userId === admin.userId) {
      throw new BadRequestException('不能修改自己的角色');
    }

    const target = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (target.length === 0) {
      throw new NotFoundException('用户不存在');
    }
    if (target[0].role === 'admin' && role === 'user') {
      await this.assertNotLastAdmin(userId);
    }

    const result = await this.db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (result.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    void this.auditService.logAction({
      actionType: 'update_user_role',
      targetType: 'user',
      targetId: userId,
      detail: `role -> ${role}`,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true };
  }

  @Patch('users/:id/role')
  async patchUserRole(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { role: string },
  ) {
    return this.updateUserRole(req, { userId: id, role: body.role });
  }

  @Delete('users/:id')
  async deleteUser(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const admin = await this.requireAdmin(req);
    if (id === admin.userId) {
      throw new BadRequestException('不能删除自己');
    }

    const target = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (target.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    if (target[0].role === 'admin') {
      await this.assertNotLastAdmin(id);
    }

    const deleted = await this.db
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (deleted.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    void this.auditService.logAction({
      actionType: 'delete_user',
      targetType: 'user',
      targetId: id,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true };
  }

  @Post('users/:id/reset-password')
  async resetPassword(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const admin = await this.requireAdmin(req);

    const target = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (target.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    const newPassword = this.authService.generateRandomPassword();
    const passwordHash = this.authService.hashPassword(newPassword);

    await this.db
      .update(users)
      .set({ passwordHash, sessionToken: null })
      .where(eq(users.id, id));

    void this.auditService.logAction({
      actionType: 'reset_password',
      targetType: 'user',
      targetId: id,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true, newPassword };
  }

  // ========== 篮球比赛管理 ==========

  @Get('basketball-matches')
  async listBasketballMatches(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.requireAdmin(req);

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize || '20', 10) || 20));
    const offset = (pageNum - 1) * pageSizeNum;

    const conditions: Parameters<typeof and> = [];
    if (date) {
      // 优先用 business_date（date 类型）查询，fallback 到 match_date（varchar）
      conditions.push(
        or(
          eq(basketballMatches.businessDate, date),
          eq(basketballMatches.matchDate, date),
        ),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const listQuery = this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        handicap: basketballMatches.handicap,
        totalLine: basketballMatches.totalLine,
        confidence: basketballMatches.confidence,
        predictionDirection: basketballMatches.predictionDirection,
        source: basketballMatches.source,
        businessDate: basketballMatches.businessDate,
      })
      .from(basketballMatches);

    if (where) listQuery.where(where);
    listQuery.orderBy(desc(basketballMatches.kickoffTime)).limit(pageSizeNum).offset(offset);

    const [items, countResult] = await Promise.all([
      listQuery,
      this.db
        .select({ count: count() })
        .from(basketballMatches)
        .where(where),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        kickoffTime: item.kickoffTime.toISOString(),
        businessDate: item.businessDate ?? null,
      })),
      total: Number(countResult[0]?.count ?? 0),
      page: pageNum,
      pageSize: pageSizeNum,
    };
  }

  @Get('basketball-matches/:id')
  async getBasketballMatch(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    await this.requireAdmin(req);

    const result = await this.db
      .select()
      .from(basketballMatches)
      .where(eq(basketballMatches.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    const row = result[0];
    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      matchDate: row.matchDate,
      businessDate: row.businessDate ?? null,
      venue: row.venue,
      source: row.source,
      sourceMatchId: row.sourceMatchId ?? null,
      homeWinProb: row.homeWinProb,
      awayWinProb: row.awayWinProb,
      predictionDirection: row.predictionDirection,
      handicap: row.handicap,
      handicapCoverProb: row.handicapCoverProb,
      handicapRecommendation: row.handicapRecommendation,
      handicapPick: row.handicapPick ?? null,
      handicapPickProb: row.handicapPickProb,
      totalLine: row.totalLine,
      overProb: row.overProb,
      underProb: row.underProb,
      totalDirection: row.totalDirection,
      totalPick: row.totalPick ?? null,
      totalPickProb: row.totalPickProb,
      predictedHomeScore: row.predictedHomeScore,
      predictedAwayScore: row.predictedAwayScore,
      confidence: row.confidence,
      intel: row.intel,
      riskWarning: row.riskWarning,
      matchStatus: row.matchStatus,
      homeScore: row.homeScore ?? null,
      awayScore: row.awayScore ?? null,
      hitWdw: row.hitWdw ?? null,
      hitHandicap: row.hitHandicap ?? null,
      hitOverunder: row.hitOverunder ?? null,
      isNeutral: row.isNeutral,
      category: row.category,
      modelRules: row.modelRules ?? [],
      handicapLineNum: row.handicapLineNum !== null && row.handicapLineNum !== undefined
        ? Number(row.handicapLineNum)
        : null,
      totalLineNum: row.totalLineNum !== null && row.totalLineNum !== undefined
        ? Number(row.totalLineNum)
        : null,
      predHtHome: row.predHtHome ?? 0,
      predHtAway: row.predHtAway ?? 0,
      intelSummary: row.intelSummary ?? null,
      upsetWarning: row.upsetWarning ?? null,
      homeHalfScore: row.homeHalfScore ?? null,
      awayHalfScore: row.awayHalfScore ?? null,
      ouConfidence: row.ouConfidence ?? null,
      handicapConfidence: row.handicapConfidence ?? null,
      teamNews: row.teamNews ?? null,
      injuries: row.injuries ?? null,
      mediaConsensus: row.mediaConsensus ?? null,
      expertPicks: row.expertPicks ?? null,
      predEngineVersion: row.predEngineVersion ?? null,
      predictionAnchor: row.predictionAnchor ?? null,
      advancedDataReady: row.advancedDataReady ?? null,
      advancedDataNotice: row.advancedDataNotice ?? null,
    };
  }

  @Post('basketball-matches')
  async createBasketballMatch(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const admin = await this.requireAdmin(req);

    const {
      matchNo,
      league,
      homeTeam,
      awayTeam,
      kickoffTime,
      matchDate,
      businessDate,
      venue,
      source,
      homeWinProb,
      awayWinProb,
      predictionDirection,
      handicap,
      handicapCoverProb,
      handicapRecommendation,
      handicapPick,
      handicapPickProb,
      totalLine,
      overProb,
      underProb,
      totalDirection,
      totalPick,
      totalPickProb,
      predictedHomeScore,
      predictedAwayScore,
      confidence,
      intel,
      riskWarning,
      matchStatus,
      homeScore,
      awayScore,
      isNeutral,
      category,
      modelRules,
      handicapLineNum,
      totalLineNum,
    } = body as Record<string, unknown>;

    if (!matchNo || !league || !homeTeam || !awayTeam || !kickoffTime || !matchDate) {
      throw new BadRequestException('缺少必填字段');
    }

    const insertData: typeof basketballMatches.$inferInsert = {
      matchNo: String(matchNo),
      league: String(league),
      homeTeam: String(homeTeam),
      awayTeam: String(awayTeam),
      kickoffTime: new Date(String(kickoffTime)),
      matchDate: String(matchDate),
      predictionDirection: predictionDirection !== undefined ? String(predictionDirection) : '',
      handicapRecommendation: handicapRecommendation !== undefined ? String(handicapRecommendation) : '',
      intel: intel !== undefined ? String(intel) : '',
      riskWarning: riskWarning !== undefined ? String(riskWarning) : '',
      totalDirection: totalDirection !== undefined ? String(totalDirection) : '',
      liveScoreSource: '',
    };

    if (businessDate !== undefined && businessDate !== null) {
      insertData.businessDate = String(businessDate);
    }
    if (venue !== undefined && venue !== null) insertData.venue = String(venue);
    if (source !== undefined && source !== null) insertData.source = String(source);
    if (homeWinProb !== undefined) insertData.homeWinProb = Number(homeWinProb);
    if (awayWinProb !== undefined) insertData.awayWinProb = Number(awayWinProb);
    if (predictionDirection !== undefined) insertData.predictionDirection = String(predictionDirection);
    if (handicap !== undefined) insertData.handicap = String(handicap);
    if (handicapCoverProb !== undefined) insertData.handicapCoverProb = Number(handicapCoverProb);
    if (handicapRecommendation !== undefined) insertData.handicapRecommendation = String(handicapRecommendation);
    if (handicapPick !== undefined && handicapPick !== null) insertData.handicapPick = String(handicapPick);
    if (handicapPickProb !== undefined) insertData.handicapPickProb = Number(handicapPickProb);
    if (totalLine !== undefined) insertData.totalLine = String(totalLine);
    if (overProb !== undefined) insertData.overProb = Number(overProb);
    if (underProb !== undefined) insertData.underProb = Number(underProb);
    if (totalDirection !== undefined) insertData.totalDirection = String(totalDirection);
    if (totalPick !== undefined && totalPick !== null) insertData.totalPick = String(totalPick);
    if (totalPickProb !== undefined) insertData.totalPickProb = Number(totalPickProb);
    if (predictedHomeScore !== undefined) insertData.predictedHomeScore = Number(predictedHomeScore);
    if (predictedAwayScore !== undefined) insertData.predictedAwayScore = Number(predictedAwayScore);
    if (confidence !== undefined) insertData.confidence = Number(confidence);
    if (intel !== undefined) insertData.intel = String(intel);
    if (riskWarning !== undefined) insertData.riskWarning = String(riskWarning);
    if (matchStatus !== undefined) insertData.matchStatus = String(matchStatus);
    if (homeScore !== undefined && homeScore !== null) insertData.homeScore = Number(homeScore);
    if (awayScore !== undefined && awayScore !== null) insertData.awayScore = Number(awayScore);
    if (isNeutral !== undefined) insertData.isNeutral = Boolean(isNeutral);
    if (category !== undefined) insertData.category = String(category);
    if (Array.isArray(modelRules)) insertData.modelRules = modelRules.map(String);
    if (handicapLineNum !== undefined && handicapLineNum !== null) insertData.handicapLineNum = String(handicapLineNum);
    if (totalLineNum !== undefined && totalLineNum !== null) insertData.totalLineNum = String(totalLineNum);

    const inserted = await this.db
      .insert(basketballMatches)
      .values(insertData)
      .returning({ id: basketballMatches.id });

    void this.auditService.logAction({
      actionType: 'create_match',
      targetType: 'basketball_match',
      targetId: inserted[0]?.id,
      detail: `${matchNo} ${homeTeam} vs ${awayTeam}`,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true, id: inserted[0]?.id };
  }

  @Patch('basketball-matches/:id')
  async updateBasketballMatch(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const admin = await this.requireAdmin(req);

    const patch: Partial<typeof basketballMatches.$inferInsert> = {};
    const fields: [string, (keyof typeof basketballMatches.$inferInsert)?][] = [
      ['matchNo'], ['league'], ['homeTeam'], ['awayTeam'],
      ['matchDate'], ['businessDate'], ['venue'], ['source'],
      ['homeWinProb'], ['awayWinProb'], ['predictionDirection'],
      ['handicap'], ['handicapCoverProb'], ['handicapRecommendation'],
      ['handicapPick'], ['handicapPickProb'], ['totalLine'],
      ['overProb'], ['underProb'], ['totalDirection'],
      ['totalPick'], ['totalPickProb'], ['predictedHomeScore'],
      ['predictedAwayScore'], ['confidence'], ['intel'],
      ['riskWarning'], ['matchStatus'], ['homeScore'],
      ['awayScore'], ['hitWdw'], ['hitHandicap'],
      ['hitOverunder'], ['isNeutral'], ['category'],
      ['predHtHome'], ['predHtAway'], ['intelSummary'],
      ['upsetWarning'], ['homeHalfScore'], ['awayHalfScore'],
      ['ouConfidence'], ['handicapConfidence'], ['teamNews'],
      ['injuries'], ['mediaConsensus'], ['expertPicks'],
      ['predEngineVersion'], ['predictionAnchor'],
      ['advancedDataReady'], ['advancedDataNotice'],
    ];

    for (const [key, schemaKey] of fields) {
      const val = body[key];
      if (val === undefined) continue;
      const targetKey = (schemaKey ?? key) as keyof typeof patch;

      // 数值类字段
      if (key === 'homeWinProb' || key === 'awayWinProb' || key === 'handicapCoverProb'
        || key === 'handicapPickProb' || key === 'overProb' || key === 'underProb'
        || key === 'totalPickProb' || key === 'predictedHomeScore' || key === 'predictedAwayScore'
        || key === 'confidence' || key === 'homeScore' || key === 'awayScore'
        || key === 'predHtHome' || key === 'predHtAway' || key === 'homeHalfScore'
        || key === 'awayHalfScore') {
        (patch as Record<string, unknown>)[targetKey] = val === null ? null : Number(val);
      } else if (key === 'hitWdw' || key === 'hitHandicap' || key === 'hitOverunder'
        || key === 'isNeutral' || key === 'advancedDataReady') {
        (patch as Record<string, unknown>)[targetKey] = val === null ? null : Boolean(val);
      } else {
        (patch as Record<string, unknown>)[targetKey] = val === null ? null : String(val);
      }
    }

    if (body.kickoffTime !== undefined && body.kickoffTime !== null) {
      patch.kickoffTime = new Date(String(body.kickoffTime));
    }

    if (Array.isArray(body.modelRules)) {
      patch.modelRules = body.modelRules.map(String);
    }

    if (body.handicapLineNum !== undefined) {
      patch.handicapLineNum = body.handicapLineNum === null ? null : String(body.handicapLineNum);
    }
    if (body.totalLineNum !== undefined) {
      patch.totalLineNum = body.totalLineNum === null ? null : String(body.totalLineNum);
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    // data-driven 预测守卫：管理员手动更新时检查
    // 如果目标是 data-driven 且 upcoming，加 warning 但允许写入（admin 有最终决定权）
    let warning: string | null = null;
    const existing = await this.db
      .select({
        predEngineVersion: basketballMatches.predEngineVersion,
        matchStatus: basketballMatches.matchStatus,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.id, id))
      .limit(1);
    if (
      existing.length > 0 &&
      shouldSkipPredictionWrite(
        existing[0].predEngineVersion,
        existing[0].matchStatus,
        'admin-manual',
      ) &&
      hasPredictionFields(patch as Record<string, unknown>)
    ) {
      warning = '该场次为 data-driven 预测，手动覆盖预测字段可能破坏模型一致性，请谨慎操作。建议使用 data-driven 重算接口更新。';
    }

    const updated = await this.db
      .update(basketballMatches)
      .set(patch)
      .where(eq(basketballMatches.id, id))
      .returning({ id: basketballMatches.id });

    if (updated.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    void this.auditService.logAction({
      actionType: 'update_match',
      targetType: 'basketball_match',
      targetId: id,
      detail: Object.keys(patch).join(','),
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true, ...(warning ? { warning } : {}) };
  }

  @NeedLogin()
  @Post('basketball-matches/:id/freeze-prediction')
  async freezeBasketballPrediction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { freezeNote?: string },
  ) {
    const admin = await this.requireAdmin(req);

    const existing = await this.db
      .select({
        id: basketballMatches.id,
        modelRules: basketballMatches.modelRules,
        isPredictionFrozen: basketballMatches.isPredictionFrozen,
        matchNo: basketballMatches.matchNo,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    const currentRules: string[] = existing[0].modelRules ?? [];
    const newRules: string[] = [...currentRules];

    if (!newRules.includes('finalized_manual')) {
      newRules.push('finalized_manual');
    }
    if (body.freezeNote && !newRules.includes(body.freezeNote)) {
      newRules.push(body.freezeNote);
    }

    const updated = await this.db
      .update(basketballMatches)
      .set({
        isPredictionFrozen: true,
        modelRules: newRules,
      })
      .where(eq(basketballMatches.id, id))
      .returning({ id: basketballMatches.id });

    if (updated.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    void this.auditService.logAction({
      actionType: 'freeze_prediction',
      targetType: 'basketball_match',
      targetId: id,
      detail: `${existing[0].matchNo} ${existing[0].homeTeam} vs ${existing[0].awayTeam}${body.freezeNote ? ` (${body.freezeNote})` : ''}`,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true, modelRules: newRules };
  }

  @NeedLogin()
  @Post('basketball-matches/:id/unfreeze-prediction')
  async unfreezeBasketballPrediction(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const admin = await this.requireAdmin(req);

    const existing = await this.db
      .select({
        id: basketballMatches.id,
        modelRules: basketballMatches.modelRules,
        isPredictionFrozen: basketballMatches.isPredictionFrozen,
        matchNo: basketballMatches.matchNo,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    const currentRules: string[] = existing[0].modelRules ?? [];
    const freezeBatchPattern = /^\d{6}_\w+_\w+$/;
    const newRules: string[] = currentRules.filter(
      (r: string) => r !== 'finalized_manual' && !freezeBatchPattern.test(r),
    );

    const updated = await this.db
      .update(basketballMatches)
      .set({
        isPredictionFrozen: false,
        modelRules: newRules,
      })
      .where(eq(basketballMatches.id, id))
      .returning({ id: basketballMatches.id });

    if (updated.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    void this.auditService.logAction({
      actionType: 'unfreeze_prediction',
      targetType: 'basketball_match',
      targetId: id,
      detail: `${existing[0].matchNo} ${existing[0].homeTeam} vs ${existing[0].awayTeam}`,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true, modelRules: newRules };
  }

  @Delete('basketball-matches/:id')
  async deleteBasketballMatch(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const admin = await this.requireAdmin(req);

    const deleted = await this.db
      .delete(basketballMatches)
      .where(eq(basketballMatches.id, id))
      .returning({ id: basketballMatches.id });

    if (deleted.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    void this.auditService.logAction({
      actionType: 'delete_match',
      targetType: 'basketball_match',
      targetId: id,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true };
  }

  @Post('basketball-matches/:id/update-score')
  async updateBasketballMatchScore(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { homeScore?: number | null; awayScore?: number | null; matchStatus?: string },
  ) {
    const admin = await this.requireAdmin(req);

    const patch: Partial<typeof basketballMatches.$inferInsert> = {};
    if (body.homeScore !== undefined) {
      patch.homeScore = body.homeScore === null ? null : Number(body.homeScore);
    }
    if (body.awayScore !== undefined) {
      patch.awayScore = body.awayScore === null ? null : Number(body.awayScore);
    }
    if (body.matchStatus !== undefined) {
      patch.matchStatus = body.matchStatus;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const updated = await this.db
      .update(basketballMatches)
      .set(patch)
      .where(eq(basketballMatches.id, id))
      .returning({ id: basketballMatches.id });

    if (updated.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    void this.auditService.logAction({
      actionType: 'update_match',
      targetType: 'basketball_match',
      targetId: id,
      detail: `score update: ${body.homeScore ?? '-'}-${body.awayScore ?? '-'}, status: ${body.matchStatus ?? 'unchanged'}`,
      operatorId: admin.userId,
      operatorEmail: admin.email,
      ipAddress: this.getClientIp(req),
    });

    return { success: true };
  }

  // ========== 审计日志 ==========

  @Get('audit-logs')
  async listAuditLogs(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('actionType') actionType?: string,
    @Query('operatorId') operatorId?: string,
  ) {
    await this.requireAdmin(req);

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize || '20', 10) || 20));
    const offset = (pageNum - 1) * pageSizeNum;

    const conditions: Parameters<typeof and> = [];
    if (actionType) {
      conditions.push(eq(adminAuditLogs.actionType, actionType));
    }
    if (operatorId) {
      conditions.push(eq(adminAuditLogs.operatorId, operatorId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const listQuery = this.db
      .select({
        id: adminAuditLogs.id,
        actionType: adminAuditLogs.actionType,
        targetType: adminAuditLogs.targetType,
        targetId: adminAuditLogs.targetId,
        detail: adminAuditLogs.detail,
        result: adminAuditLogs.result,
        errorMessage: adminAuditLogs.errorMessage,
        operatorId: adminAuditLogs.operatorId,
        operatorEmail: adminAuditLogs.operatorEmail,
        ipAddress: adminAuditLogs.ipAddress,
        createdAt: adminAuditLogs.createdAt,
      })
      .from(adminAuditLogs);

    if (where) listQuery.where(where);
    listQuery.orderBy(desc(adminAuditLogs.createdAt)).limit(pageSizeNum).offset(offset);

    const [items, countResult] = await Promise.all([
      listQuery,
      this.db
        .select({ count: count() })
        .from(adminAuditLogs)
        .where(where),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      total: Number(countResult[0]?.count ?? 0),
      page: pageNum,
      pageSize: pageSizeNum,
    };
  }

  // ========== 同步设置（只读） ==========

  @Get('sync-config')
  async getSyncConfig(@Req() req: Request): Promise<SyncConfig> {
    await this.requireAdmin(req);
    return this.sportteryService.getSyncConfig();
  }

  // ========== 数据源设置 ==========

  @Get('data-sources')
  async getDataSources(@Req() req: Request): Promise<DataSourceSettingsResponse> {
    await this.requireAdmin(req);

    const rows = await this.db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(
        sql`${appSettings.key} IN ('api_sports_key', 'therundown_key', 'football_data_org_key')`,
      );
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.key, row.value);
    }

    const envApiSports = process.env.APISPORTS_KEY;
    const envTheRundown = process.env.THERUNDOWN_KEY;
    const envFdo = process.env.FOOTBALL_DATA_ORG_KEY;

    const apiSportsDbVal = map.get('api_sports_key') || '';
    const therundownDbVal = map.get('therundown_key') || '';
    const fdoDbVal = map.get('football_data_org_key') || '';

    const apiSportsActive = envApiSports || apiSportsDbVal || '';
    const therundownActive = envTheRundown || therundownDbVal || '';
    const fdoActive = envFdo || fdoDbVal || '';

    const mask = (k: string): string => {
      if (!k) return '';
      if (k.length <= 4) return '****';
      return `****${k.slice(-4)}`;
    };

    const sourceOf = (env: string | undefined, db: string): 'env' | 'db' | 'default' => {
      if (typeof env === 'string' && env.length > 0) return 'env';
      if (db.length > 0) return 'db';
      return 'default';
    };

    const health = await this.sportteryService.getHealth();
    const s = health.sources;

    return {
      apiSports: {
        enabled: s.apiSports?.enabled ?? false,
        maskedKey: mask(apiSportsActive),
        configuredSource: sourceOf(envApiSports, apiSportsDbVal),
        dbKeySet: apiSportsDbVal.length > 0,
        dailyQuota: s.apiSports?.dailyLimit ?? 500,
        quotaUsed: s.apiSports?.quotaUsed ?? 0,
        lastSyncAt: s.apiSports?.lastSyncAt ?? null,
        success: s.apiSports?.success ?? false,
      },
      theRundown: {
        enabled: s.theRundown?.enabled ?? false,
        maskedKey: mask(therundownActive),
        configuredSource: sourceOf(envTheRundown, therundownDbVal),
        dbKeySet: therundownDbVal.length > 0,
        lastSyncAt: s.theRundown?.lastSyncAt ?? null,
        success: s.theRundown?.success ?? false,
        oddsApiQuotaExhausted: health.adaptive.oddsApiQuotaExhausted ?? false,
      },
      espn: {
        footballEnabled: s.espnFootball?.enabled ?? false,
        basketballEnabled: s.espnBasketball?.enabled ?? false,
      },
      oddsApi: {
        enabled: s.oddsApi?.enabled ?? false,
        remaining: s.oddsApi?.remaining ?? null,
        used: s.oddsApi?.used ?? null,
        quotaExhausted: s.oddsApi?.quotaExhausted ?? false,
      },
      qiumibao: {
        enabled: s.qiumibao?.enabled ?? false,
        footballCount: s.qiumibao?.footballMatchCount ?? 0,
        basketballCount: s.qiumibao?.basketballMatchCount ?? 0,
      },
      beidan: {
        enabled: s.beidan?.enabled ?? false,
        todayCount: s.beidan?.todayCount ?? 0,
      },
      injurySource: {
        enabled: s.injurySource?.enabled ?? false,
        lastSyncAt: s.injurySource?.lastSyncAt ?? null,
        success: s.injurySource?.success ?? false,
        teamCount: s.injurySource?.teamCount ?? 0,
        playerCount: s.injurySource?.playerCount ?? 0,
        lastError: (s.injurySource as { lastError?: string | null } | undefined)?.lastError ?? null,
      },
      footballDataOrg: {
        enabled: s.footballDataOrg?.enabled ?? false,
        configuredSource: (envFdo && envFdo.length > 0) ? 'env' : (fdoDbVal.length > 0 ? 'db' : 'none'),
        dbKeySet: fdoDbVal.length > 0,
        maskedKey: mask(fdoActive),
        lastSyncAt: s.footballDataOrg?.lastSyncAt ?? null,
        success: s.footballDataOrg?.success ?? false,
        todayCount: s.footballDataOrg?.todayCount ?? 0,
        updated: s.footballDataOrg?.updated ?? 0,
        requestCount: (s.footballDataOrg as { requestCount?: number } | undefined)?.requestCount ?? 0,
        lastError: (s.footballDataOrg as { lastError?: string | null } | undefined)?.lastError ?? null,
      },
    };
  }

  @Patch('data-sources/api-sports')
  async updateApiSportsKey(
    @Req() req: Request,
    @Body() body: { apiKey?: string },
  ): Promise<{ updated: boolean; triggered: boolean }> {
    const admin = await this.requireAdmin(req);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

    if (apiKey.length > 0 && apiKey.length < 8) {
      throw new BadRequestException('API Key 长度至少 8 位');
    }

    const existing = await this.db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(eq(appSettings.key, 'api_sports_key'));

    if (existing.length > 0) {
      await this.db
        .update(appSettings)
        .set({ value: apiKey, updatedAt: new Date() })
        .where(eq(appSettings.key, 'api_sports_key'));
    } else {
      await this.db.insert(appSettings).values({
        key: 'api_sports_key',
        value: apiKey,
      });
    }

    this.sportteryService.setApiSportsKey(apiKey);

    await this.auditService.logAction({
      actionType: 'update_data_source',
      targetType: 'data_source',
      targetId: 'api_sports',
      operatorId: admin.userId,
      detail: `apiSports key ${apiKey ? 'updated' : 'cleared'}: ${apiKey ? `****${apiKey.slice(-4)}` : ''}`,
      result: 'success',
    });

    this.sportteryService.triggerSyncAsync();
    return { updated: true, triggered: true };
  }

  @Patch('data-sources/the-rundown')
  async updateTheRundownKey(
    @Req() req: Request,
    @Body() body: { apiKey?: string },
  ): Promise<{ updated: boolean; triggered: boolean }> {
    const admin = await this.requireAdmin(req);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

    if (apiKey.length > 0 && apiKey.length < 8) {
      throw new BadRequestException('API Key 长度至少 8 位');
    }

    const existing = await this.db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(eq(appSettings.key, 'therundown_key'));

    if (existing.length > 0) {
      await this.db
        .update(appSettings)
        .set({ value: apiKey, updatedAt: new Date() })
        .where(eq(appSettings.key, 'therundown_key'));
    } else {
      await this.db.insert(appSettings).values({
        key: 'therundown_key',
        value: apiKey,
      });
    }

    this.sportteryService.setTheRundownKey(apiKey);

    await this.auditService.logAction({
      actionType: 'update_data_source',
      targetType: 'data_source',
      targetId: 'the_rundown',
      operatorId: admin.userId,
      detail: `theRundown key ${apiKey ? 'updated' : 'cleared'}: ${apiKey ? `****${apiKey.slice(-4)}` : ''}`,
      result: 'success',
    });

    this.sportteryService.triggerOddsApiSyncAsync();
    return { updated: true, triggered: true };
  }

  @Patch('data-sources/football-data-org')
  async updateFootballDataOrgKey(
    @Req() req: Request,
    @Body() body: { apiKey?: string },
  ): Promise<{ updated: boolean; triggered: boolean }> {
    const admin = await this.requireAdmin(req);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

    if (apiKey.length > 0 && apiKey.length < 8) {
      throw new BadRequestException('API Key 长度至少 8 位');
    }

    const existing = await this.db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(eq(appSettings.key, 'football_data_org_key'));

    if (existing.length > 0) {
      await this.db
        .update(appSettings)
        .set({ value: apiKey, updatedAt: new Date() })
        .where(eq(appSettings.key, 'football_data_org_key'));
    } else {
      await this.db.insert(appSettings).values({
        key: 'football_data_org_key',
        value: apiKey,
      });
    }

    this.sportteryService.setFdoApiKey(apiKey.length > 0 ? apiKey : undefined);

    await this.auditService.logAction({
      actionType: 'update_data_source',
      targetType: 'data_source',
      targetId: 'football_data_org',
      operatorId: admin.userId,
      detail: `football-data.org key ${apiKey ? 'updated' : 'cleared'}: ${apiKey ? `****${apiKey.slice(-4)}` : ''}`,
      result: 'success',
    });

    this.sportteryService.triggerFdoSync();
    return { updated: true, triggered: true };
  }

  // ==================== 一、预测批量重算 ====================

  @Post('predictions/recalculate')
  async batchRecalculatePredictions(
    @Req() req: Request,
    @Body() body: {
      sport: 'football' | 'basketball';
      matchStatus?: 'upcoming' | 'live' | 'finished' | 'all';
      matchIds?: string[];
      dateFrom?: string;
      dateTo?: string;
      league?: string;
    },
  ): Promise<{
    totalScanned: number;
    recalculated: number;
    skippedLocked: number;
    skippedNoData: number;
    predictionsMade: number;
    holds: number;
    dateRange: { from: string | null; to: string | null };
  }> {
    const admin = await this.requireAdmin(req);
    const { sport, matchStatus = 'all', matchIds, dateFrom, dateTo } = body;

    const stats = {
      totalScanned: 0,
      recalculated: 0,
      skippedLocked: 0,
      skippedNoData: 0,
      predictionsMade: 0,
      holds: 0,
      dateRange: { from: dateFrom ?? null, to: dateTo ?? null },
    };

    if (sport === 'football') {
      const conditions = this.buildMatchWhere(matches, matchStatus, matchIds, dateFrom, dateTo, body.league);
      const rows = await this.db
        .select({
          id: matches.id,
          matchStatus: matches.matchStatus,
          isOfficialLocked: matches.isOfficialLocked,
          oddsOpenHome: matches.oddsOpenHome,
          oddsOpenDraw: matches.oddsOpenDraw,
          oddsOpenAway: matches.oddsOpenAway,
          handicap: matches.handicap,
          overUnder: matches.overUnder,
          league: matches.league,
          homeGoalsAvg: matches.homeGoalsAvg,
          awayGoalsAvg: matches.awayGoalsAvg,
          homeConcededAvg: matches.homeConcededAvg,
          awayConcededAvg: matches.awayConcededAvg,
          eloHome: matches.eloHome,
          eloAway: matches.eloAway,
          homeForm: matches.homeForm,
          awayForm: matches.awayForm,
          h2h: matches.h2h,
          advancedStats: matches.advancedStats,
          modelRules: matches.modelRules,
          predictionDirection: matches.predictionDirection,
        })
        .from(matches)
        .where(conditions ? and(...conditions) : undefined)
        .orderBy(desc(matches.kickoffTime))
        .limit(500);

      stats.totalScanned = rows.length;

      for (const row of rows) {
        if (row.isOfficialLocked) {
          stats.skippedLocked++;
          continue;
        }

        const oddsH = Number(row.oddsOpenHome) || 0;
        const oddsD = Number(row.oddsOpenDraw) || 0;
        const oddsA = Number(row.oddsOpenAway) || 0;

        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          stats.skippedNoData++;
          continue;
        }

        const advStats = (row.advancedStats ?? {}) as { xgHome?: number; xgAway?: number; quality?: string };
        const xgQualityVal = (advStats.quality ?? 'none') as 'high' | 'medium' | 'low' | 'none';

        const homeFormArr = Array.isArray(row.homeForm) ? row.homeForm : [];
        const awayFormArr = Array.isArray(row.awayForm) ? row.awayForm : [];
        const h2hArr = Array.isArray(row.h2h) ? row.h2h : [];
        const homeFormWdl = homeFormArr.slice(0, 5).join('');
        const awayFormWdl = awayFormArr.slice(0, 5).join('');
        let h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0;
        for (const r of h2hArr) {
          const s = String(r).toUpperCase();
          if (s === 'W' || s === 'HW') h2hHomeWins++;
          else if (s === 'L' || s === 'AW') h2hAwayWins++;
          else if (s === 'D') h2hDraws++;
        }

        const strengthInput = {
          homeGoalsAvg: Number(row.homeGoalsAvg) || 0,
          awayGoalsAvg: Number(row.awayGoalsAvg) || 0,
          homeConcededAvg: Number(row.homeConcededAvg) || 0,
          awayConcededAvg: Number(row.awayConcededAvg) || 0,
          eloHome: Number(row.eloHome) || 0,
          eloAway: Number(row.eloAway) || 0,
          homeXg: Number(advStats.xgHome) || 0,
          awayXg: Number(advStats.xgAway) || 0,
          xgQuality: xgQualityVal,
          homeFormWdl,
          awayFormWdl,
          h2hHomeWins,
          h2hAwayWins,
          h2hDraws,
        };

        const allFour = (Number(row.homeGoalsAvg) || 0) > 0 && (Number(row.awayGoalsAvg) || 0) > 0 &&
                          (Number(row.homeConcededAvg) || 0) > 0 && (Number(row.awayConcededAvg) || 0) > 0;

        const pred = (this.sportteryService as unknown as {
          generateFootballPrediction: (
            oddsHome: number,
            oddsDraw: number,
            oddsAway: number,
            handicapStr: string,
            totalGoalsStr?: string,
            league?: string,
            strengthInput?: { homeGoalsAvg: number; awayGoalsAvg: number; homeConcededAvg: number; awayConcededAvg: number; eloHome?: number; eloAway?: number; homeXg?: number; awayXg?: number; xgQuality?: 'high' | 'medium' | 'low' | 'none' },
          ) => {
            homeWinProb: number;
            drawProb: number;
            awayWinProb: number;
            predictionDirection: string;
            confidence: number;
            lowConfidence: boolean;
            drawWarning: boolean;
            handicapRecommendation: string;
            handicapWinProb: number;
            handicapDrawProb: number;
            handicapLoseProb: number;
            handicapSecondChoice: string;
            overProb: number;
            underProb: number;
            totalPick: string;
            totalPickProb: number;
            mostLikelyScore: string;
            scoreProbs: string[];
            totalGoalsProb: { goals: string; prob: number }[];
            halfFullProb: { code: string; prob: number }[];
            modelRules: string[];
          } | null;
        }).generateFootballPrediction(
          oddsH,
          oddsD,
          oddsA,
          row.handicap ?? '0',
          row.overUnder ?? '2.5',
          row.league,
          strengthInput,
        );

        if (!pred) {
          stats.skippedNoData++;
          continue;
        }

        const existingRules: string[] = Array.isArray(row.modelRules) ? row.modelRules : [];
        const newRules: string[] = Array.isArray(pred.modelRules) ? pred.modelRules : [];
        const mergedRules = Array.from(new Set([...existingRules, ...newRules]));

        const patch: Partial<typeof matches.$inferInsert> = {
          homeWinProb: pred.homeWinProb,
          drawProb: pred.drawProb,
          awayWinProb: pred.awayWinProb,
          predictionDirection: pred.predictionDirection,
          confidence: pred.confidence,
          lowConfidence: pred.lowConfidence,
          handicapRecommendation: pred.handicapRecommendation,
          handicapWinProb: String(pred.handicapWinProb),
          handicapDrawProb: String(pred.handicapDrawProb),
          handicapLoseProb: String(pred.handicapLoseProb),
          handicapSecondChoice: pred.handicapSecondChoice,
          overProb: pred.overProb,
          underProb: pred.underProb,
          totalPick: pred.totalPick,
          totalPickProb: pred.totalPickProb,
          mostLikelyScore: pred.mostLikelyScore,
          scoreProbs: pred.scoreProbs,
          totalGoalsProb: pred.totalGoalsProb as unknown as Record<string, unknown>[],
          halfFullProb: pred.halfFullProb as unknown as Record<string, unknown>[],
          modelRules: mergedRules,
        };

        await this.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
          await tx.update(matches).set(patch).where(eq(matches.id, row.id));
        });
        stats.recalculated++;
        if (pred.predictionDirection && pred.predictionDirection !== '观望') {
          stats.predictionsMade++;
        } else {
          stats.holds++;
        }
      }
    } else {
      const conditions = this.buildBasketballMatchWhere(basketballMatches, matchStatus, matchIds, dateFrom, dateTo, body.league);
      const rows = await this.db
        .select({
          id: basketballMatches.id,
          matchStatus: basketballMatches.matchStatus,
          isOfficialLocked: basketballMatches.isOfficialLocked,
          handicapOddsHome: basketballMatches.handicapOddsHome,
          handicapOddsAway: basketballMatches.handicapOddsAway,
          handicapLineNum: basketballMatches.handicapLineNum,
          handicap: basketballMatches.handicap,
          totalLineNum: basketballMatches.totalLineNum,
          totalLine: basketballMatches.totalLine,
           league: basketballMatches.league,
           kickoffTime: basketballMatches.kickoffTime,
           eloHome: basketballMatches.eloHome,
          eloAway: basketballMatches.eloAway,
          teamStats: basketballMatches.teamStats,
          recentForm: basketballMatches.recentForm,
          injuries: basketballMatches.injuries,
          modelRules: basketballMatches.modelRules,
          predictionDirection: basketballMatches.predictionDirection,
        })
        .from(basketballMatches)
        .where(conditions ? and(...conditions) : undefined)
        .orderBy(desc(basketballMatches.kickoffTime))
        .limit(500);

      stats.totalScanned = rows.length;

      for (const row of rows) {
        if (row.isOfficialLocked) {
          stats.skippedLocked++;
          continue;
        }

        // data-driven 预测守卫：旧引擎 recalc 跳过 data-driven upcoming 场次
        if (isDataDrivenEngine((row as { predEngineVersion?: string }).predEngineVersion) && row.matchStatus === 'upcoming') {
          stats.skippedLocked++;
          continue;
        }

        const hOdds = Number(row.handicapOddsHome) || 0;
        const aOdds = Number(row.handicapOddsAway) || 0;
        const handicapLineStr = row.handicapLineNum != null ? String(row.handicapLineNum) : row.handicap ?? '0';
        const totalLineStr = row.totalLineNum != null ? String(row.totalLineNum) : row.totalLine ?? '150.5';

        if (hOdds <= 0 || aOdds <= 0) {
          stats.skippedNoData++;
          continue;
        }

        const teamStatsData = row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | null;
        const recentFormData = row.recentForm as { home?: string[]; away?: string[] } | null;
        const injuriesData = row.injuries as { home?: Array<{ name: string; role?: string; date?: string }>; away?: Array<{ name: string; role?: string; date?: string }> } | null;
        const kickoffDate = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime));
        const freshCutoffMs = 21 * 24 * 60 * 60 * 1000;
        const isFreshInjury = (p: { date?: string }): boolean => {
          if (!p.date) return true;
          const d = new Date(p.date);
          if (Number.isNaN(d.getTime())) return true;
          return kickoffDate.getTime() - d.getTime() <= freshCutoffMs;
        };
        const coreInjuriesHome = injuriesData?.home?.filter((p: { name: string; role?: string; date?: string }) =>
          (p.role === '核心' || p.role === 'star' || p.role === '核心球员') && isFreshInjury(p)
        ).length ?? 0;
        const coreInjuriesAway = injuriesData?.away?.filter((p: { name: string; role?: string; date?: string }) =>
          (p.role === '核心' || p.role === 'star' || p.role === '核心球员') && isFreshInjury(p)
        ).length ?? 0;

        const pred = this.sportteryService.generateBasketballPrediction(
          hOdds,
          aOdds,
          handicapLineStr,
          totalLineStr,
          row.league,
          '',
          {
            teamStats: teamStatsData ?? undefined,
            eloHome: Number(row.eloHome) || 0,
            eloAway: Number(row.eloAway) || 0,
            coreInjuriesHome,
            coreInjuriesAway,
            rowIntel: {
              recentForm: recentFormData ?? undefined,
              injuries: injuriesData ?? undefined,
              teamStats: teamStatsData ?? undefined,
            },
          },
        );

        if (!pred) {
          stats.skippedNoData++;
          continue;
        }

        const existingRules: string[] = Array.isArray(row.modelRules) ? row.modelRules : [];
        const newRules: string[] = Array.isArray(pred.modelRules) ? pred.modelRules : [];
        const mergedRules = Array.from(new Set([...existingRules, ...newRules]));

        const patch: Partial<typeof basketballMatches.$inferInsert> = {
          homeWinProb: pred.homeWinProb,
          awayWinProb: pred.awayWinProb,
          predictionDirection: pred.predictionDirection,
          confidence: pred.confidence,
          handicapRecommendation: pred.handicapRecommendation,
          handicapCoverProb: pred.handicapCoverProb,
          handicapPickProb: pred.handicapPickProb,
          totalDirection: pred.totalDirection,
          overProb: pred.overProb,
          underProb: pred.underProb,
          totalPickProb: pred.totalPickProb,
          predictedHomeScore: pred.predictedHomeScore,
          predictedAwayScore: pred.predictedAwayScore,
          predictedTotal: String(pred.predictedTotal),
          handicapConfidence: pred.handicapConfidence,
          ouConfidence: pred.ouConfidence,
          ouDiffVsLine: String(pred.ouDiffVsLine),
          modelRules: mergedRules,
        };

        await this.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
          await tx.update(basketballMatches).set(patch).where(eq(basketballMatches.id, row.id));
        });
        stats.recalculated++;
        if (pred.predictionDirection && pred.predictionDirection !== '观望') {
          stats.predictionsMade++;
        } else {
          stats.holds++;
        }
      }
    }

    void this.auditService.logAction({
      actionType: 'trigger_sync',
      targetType: 'prediction',
      detail: JSON.stringify({ sport, matchStatus, count: stats.recalculated, ...stats }),
      operatorId: admin.userId,
      ipAddress: this.getClientIp(req),
      result: 'success',
    });

    return stats;
  }

  // ==================== Elo 评分回算 ====================

  @Post('elo/backfill')
  async backfillEloRatings(
    @Req() req: Request,
    @Body() body: { sport?: 'football' | 'basketball' | 'all' },
  ): Promise<{
    football?: { processed: number; teamsCount: number };
    basketball?: { processed: number; teamsCount: number };
  }> {
    await this.requireAdmin(req);
    const sport = body.sport ?? 'all';
    const result: {
      football?: { processed: number; teamsCount: number };
      basketball?: { processed: number; teamsCount: number };
    } = {};

    if (sport === 'all' || sport === 'football') {
      result.football = await this.eloHistoryService.backfillFootballElo();
    }
    if (sport === 'all' || sport === 'basketball') {
      result.basketball = await this.eloHistoryService.backfillBasketballElo();
    }

    return result;
  }

  @Get('elo/overview')
  async getEloOverview(
    @Req() req: Request,
    @Query('sport') sport?: string,
    @Query('league') league?: string,
    @Query('limit') limit?: string,
  ): Promise<{ total: number; topRatings: unknown[] }> {
    await this.requireAdmin(req);
    const targetSport = sport ?? 'football';
    const limitNum = Math.min(Number(limit) || 20, 100);

    const conditions = [eq(teamsElo.sport, targetSport)];
    if (league) {
      conditions.push(eq(teamsElo.league, league));
    }
    const whereClause = and(...conditions);

    const totalResult = await this.db
      .select({ count: count() })
      .from(teamsElo)
      .where(whereClause);
    const total = Number(totalResult[0]?.count ?? 0);

    const topRatings = await this.db
      .select({
        teamName: teamsElo.teamName,
        league: teamsElo.league,
        eloRating: teamsElo.eloRating,
        matchesPlayed: teamsElo.matchesPlayed,
        wins: teamsElo.wins,
        losses: teamsElo.losses,
      })
      .from(teamsElo)
      .where(whereClause)
      .orderBy(desc(teamsElo.eloRating))
      .limit(limitNum);

    return { total, topRatings };
  }

  @Get('predictions/recalculate/preview')
  async previewRecalculate(
    @Req() req: Request,
    @Query('sport') sport?: string,
    @Query('matchStatus') matchStatus?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('league') league?: string,
  ): Promise<{ total: number; sport: string }> {
    await this.requireAdmin(req);
    if (sport !== 'football' && sport !== 'basketball') {
      throw new BadRequestException('sport 参数必须是 football 或 basketball');
    }
    const statusVal = matchStatus === 'upcoming' || matchStatus === 'live' || matchStatus === 'finished' || matchStatus === 'all'
      ? matchStatus : 'all';

    let total = 0;
    if (sport === 'football') {
      const conditions = this.buildMatchWhere(matches, statusVal, undefined, dateFrom, dateTo, league);
      const [result] = await this.db
        .select({ count: count() })
        .from(matches)
        .where(conditions ? and(...conditions) : undefined);
      total = Number(result?.count ?? 0);
    } else {
      const conditions = this.buildBasketballMatchWhere(basketballMatches, statusVal, undefined, dateFrom, dateTo, league);
      const [result] = await this.db
        .select({ count: count() })
        .from(basketballMatches)
        .where(conditions ? and(...conditions) : undefined);
      total = Number(result?.count ?? 0);
    }
    return { total, sport };
  }

  private buildMatchWhere(
    table: typeof matches,
    matchStatus: string,
    matchIds: string[] | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    league?: string,
  ): import('drizzle-orm').SQL[] {
    const conditions: import('drizzle-orm').SQL[] = [];
    if (matchStatus && matchStatus !== 'all') {
      conditions.push(eq(table.matchStatus, matchStatus));
    }
    if (matchIds && matchIds.length > 0) {
      conditions.push(inArray(table.id, matchIds));
    }
    if (dateFrom) {
      conditions.push(gte(table.kickoffTime, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lt(table.kickoffTime, new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000)));
    }
    if (league && league.trim()) {
      conditions.push(ilike(table.league, `%${league.trim()}%`));
    }
    return conditions;
  }

  private buildBasketballMatchWhere(
    table: typeof basketballMatches,
    matchStatus: string,
    matchIds: string[] | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    league?: string,
  ): import('drizzle-orm').SQL[] {
    const conditions: import('drizzle-orm').SQL[] = [];
    if (matchStatus && matchStatus !== 'all') {
      conditions.push(eq(table.matchStatus, matchStatus));
    }
    if (matchIds && matchIds.length > 0) {
      conditions.push(inArray(table.id, matchIds));
    }
    if (dateFrom) {
      conditions.push(gte(table.kickoffTime, new Date(dateFrom)));
    }
    if (dateTo) {
      conditions.push(lt(table.kickoffTime, new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000)));
    }
    if (league && league.trim()) {
      conditions.push(ilike(table.league, `%${league.trim()}%`));
    }
    return conditions;
  }

  // ==================== 二、异常数据巡检 ====================

  @Post('inspection/scan')
  async inspectionScan(
    @Req() req: Request,
    @Body() body: { sport?: 'football' | 'basketball' | 'all' },
  ): Promise<{
    scanTime: string;
    totalScanned: number;
    football: {
      total: number;
      waitCount: number;
      waitRate: number;
      anomalies: Array<{
        id: string;
        matchNo: string;
        league: string;
        homeTeam: string;
        awayTeam: string;
        kickoffTime: Date;
        anomalyType: string;
        anomalyDetail: string;
        severity: 'low' | 'medium' | 'high';
      }>;
    };
    basketball: {
      total: number;
      waitCount: number;
      waitRate: number;
      anomalies: Array<{
        id: string;
        matchNo: string;
        league: string;
        homeTeam: string;
        awayTeam: string;
        kickoffTime: Date;
        anomalyType: string;
        anomalyDetail: string;
        severity: 'low' | 'medium' | 'high';
      }>;
    };
  }> {
    const admin = await this.requireAdmin(req);
    const scanTime = new Date().toISOString();
    const sportFilter = body.sport ?? 'all';

    type AnomalyItem = {
      id: string;
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: Date;
      anomalyType: string;
      anomalyDetail: string;
      severity: 'low' | 'medium' | 'high';
    };

    const footballResult = { total: 0, waitCount: 0, waitRate: 0, anomalies: [] as AnomalyItem[] };
    const basketballResult = { total: 0, waitCount: 0, waitRate: 0, anomalies: [] as AnomalyItem[] };

    if (sportFilter === 'all' || sportFilter === 'football') {
      const fbRows = await this.db
        .select({
          id: matches.id,
          matchNo: matches.matchNo,
          league: matches.league,
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
          kickoffTime: matches.kickoffTime,
          homeWinProb: matches.homeWinProb,
          awayWinProb: matches.awayWinProb,
          predictionDirection: matches.predictionDirection,
          confidence: matches.confidence,
          handicapRecommendation: matches.handicapRecommendation,
          totalGoals: matches.totalGoals,
          totalPick: matches.totalPick,
          handicapWinProb: matches.handicapWinProb,
          overProb: matches.overProb,
          homeGoalsAvg: matches.homeGoalsAvg,
          awayGoalsAvg: matches.awayGoalsAvg,
          homeConcededAvg: matches.homeConcededAvg,
          awayConcededAvg: matches.awayConcededAvg,
          matchStatus: matches.matchStatus,
        })
        .from(matches)
        .where(sql`${matches.matchStatus} IN ('upcoming', 'live')`)
        .limit(1000);

      footballResult.total = fbRows.length;
      footballResult.waitCount = fbRows.filter((r) => !r.predictionDirection || r.predictionDirection === '观望').length;
      footballResult.waitRate = footballResult.total > 0 ? Math.round((footballResult.waitCount / footballResult.total) * 10000) / 100 : 0;

      for (const row of fbRows) {
        // 1. confidence=0 但有方向
        if (row.confidence === 0 && row.predictionDirection && row.predictionDirection !== '观望') {
          footballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'zero_confidence_with_direction',
            anomalyDetail: `信心度为0但方向=${row.predictionDirection}`,
            severity: 'high',
          });
        }
        // 2. 胜平负最高概率≥80%却标观望
        const hwp = Number(row.homeWinProb) || 0;
        const awp = Number(row.awayWinProb) || 0;
        const dwp = 100 - hwp - awp;
        const maxWdwProb = Math.max(hwp, awp, Math.max(dwp, 0));
        if ((row.predictionDirection === '观望' || !row.predictionDirection) && maxWdwProb >= 80) {
          footballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'high_probability_still_wait',
            anomalyDetail: `胜平负最高概率${maxWdwProb}%但方向=观望`,
            severity: 'high',
          });
        }
        // 3. 让球/大小球概率≥65%却观望
        const handicapProb = Number(row.handicapWinProb) || 0;
        const overProb = Number(row.overProb) || 0;
        if ((row.handicapRecommendation === '观望' || !row.handicapRecommendation) && handicapProb >= 65) {
          footballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'handicap_high_prob_wait',
            anomalyDetail: `让球赢盘概率${handicapProb}%但让球推荐=观望`,
            severity: 'medium',
          });
        }
        if ((row.totalPick === '观望' || !row.totalPick) && overProb >= 65) {
          footballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'total_high_prob_wait',
            anomalyDetail: `大球概率${overProb}%但大小球推荐=观望`,
            severity: 'medium',
          });
        }
        // 4. 概率矛盾 - 胜负 vs 让球
        if (hwp > 85 && row.handicapRecommendation && row.handicapRecommendation.includes('让球客')) {
        } else if (awp > 85 && row.handicapRecommendation && row.handicapRecommendation.includes('让球主')) {
          footballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'wdw_vs_handicap_conflict',
            anomalyDetail: `客胜概率${awp}%但让球方向=${row.handicapRecommendation}（深盘赢球不赢盘）`,
            severity: 'medium',
          });
        }
        // 3. 概率矛盾 - 大小球
        const tg = Number(row.totalGoals) || 0;
        const op = Number(row.overProb) || 0;
        if (tg >= 3.5 && row.totalPick === '小球' && op > 60) {
          footballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'total_vs_predicted_conflict',
            anomalyDetail: `预期进球${tg}球却推小球，大球概率${op}%`,
            severity: 'medium',
          });
        }
        // 5. 缺失球队数据（降噪：排除测试标签 + 仅开赛前24h + 主客区分 + 过期归为赛果同步异常）
        const fbTestLeagues = ['Diff Batch', 'Perf55b'];
        if (!fbTestLeagues.includes(row.league)) {
          const hga = Number(row.homeGoalsAvg) || 0;
          const aga = Number(row.awayGoalsAvg) || 0;
          const hca = Number(row.homeConcededAvg) || 0;
          const aca = Number(row.awayConcededAvg) || 0;
          const homeMissing = hga === 0 && hca === 0;
          const awayMissing = aga === 0 && aca === 0;
          const now = new Date();
          const kickoff = new Date(row.kickoffTime);
          const hoursToKickoff = (kickoff.getTime() - now.getTime()) / (1000 * 60 * 60);

          if (homeMissing || awayMissing) {
            if (row.matchStatus === 'upcoming' && hoursToKickoff < 0) {
              // 开赛时间已过但仍upcoming且缺数据 → 赛果同步异常
              footballResult.anomalies.push({
                id: row.id,
                matchNo: row.matchNo,
                league: row.league,
                homeTeam: row.homeTeam,
                awayTeam: row.awayTeam,
                kickoffTime: row.kickoffTime,
                anomalyType: 'result_sync_anomaly',
                anomalyDetail: `开赛时间已过${Math.abs(Math.round(hoursToKickoff))}小时但状态仍为upcoming`,
                severity: 'medium',
              });
            } else if (row.matchStatus === 'upcoming' && hoursToKickoff <= 24) {
              // 开赛前24h内仍缺数据
              let missDetail = '';
              let sev: 'low' | 'medium' = 'low';
              if (homeMissing && awayMissing) {
                missDetail = '双方球队攻防数据均为空';
                sev = 'medium';
              } else if (homeMissing) {
                missDetail = '主队攻防数据为空';
              } else {
                missDetail = '客队攻防数据为空';
              }
              footballResult.anomalies.push({
                id: row.id,
                matchNo: row.matchNo,
                league: row.league,
                homeTeam: row.homeTeam,
                awayTeam: row.awayTeam,
                kickoffTime: row.kickoffTime,
                anomalyType: 'missing_team_data',
                anomalyDetail: missDetail + `（距开赛${Math.round(hoursToKickoff)}小时）`,
                severity: sev,
              });
            }
          }
        }
      }
    }

    if (sportFilter === 'all' || sportFilter === 'basketball') {
      const bbRows = await this.db
        .select({
          id: basketballMatches.id,
          matchNo: basketballMatches.matchNo,
          league: basketballMatches.league,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          kickoffTime: basketballMatches.kickoffTime,
          homeWinProb: basketballMatches.homeWinProb,
          awayWinProb: basketballMatches.awayWinProb,
          predictionDirection: basketballMatches.predictionDirection,
          confidence: basketballMatches.confidence,
          handicapRecommendation: basketballMatches.handicapRecommendation,
          totalDirection: basketballMatches.totalDirection,
          overProb: basketballMatches.overProb,
          underProb: basketballMatches.underProb,
          handicapCoverProb: basketballMatches.handicapCoverProb,
          predictedTotal: basketballMatches.predictedTotal,
          totalLineNum: basketballMatches.totalLineNum,
          teamStats: basketballMatches.teamStats,
          matchStatus: basketballMatches.matchStatus,
          modelRules: basketballMatches.modelRules,
        })
        .from(basketballMatches)
        .where(sql`${basketballMatches.matchStatus} IN ('upcoming', 'live')`)
        .limit(1000);

      basketballResult.total = bbRows.length;
      basketballResult.waitCount = bbRows.filter((r) => !r.predictionDirection || r.predictionDirection === '观望').length;
      basketballResult.waitRate = basketballResult.total > 0 ? Math.round((basketballResult.waitCount / basketballResult.total) * 10000) / 100 : 0;

      for (const row of bbRows) {
        // 1. confidence=0 但有方向
        if (row.confidence === 0 && row.predictionDirection && row.predictionDirection !== '观望') {
          basketballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'zero_confidence_with_direction',
            anomalyDetail: `信心度为0但方向=${row.predictionDirection}`,
            severity: 'high',
          });
        }
        // 2. 胜负最高概率≥80%却标观望
        const hwpB = Number(row.homeWinProb) || 0;
        const awpB = Number(row.awayWinProb) || 0;
        const maxWdwProbB = Math.max(hwpB, awpB);
        if ((row.predictionDirection === '观望' || !row.predictionDirection) && maxWdwProbB >= 80) {
          basketballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'high_probability_still_wait',
            anomalyDetail: `胜负最高概率${maxWdwProbB}%但方向=观望`,
            severity: 'high',
          });
        }
        // 3. 让分/大小分概率≥65%却观望
        const handicapProbB = Number(row.handicapCoverProb) || 0;
        const overProbB = Number(row.overProb) || 0;
        if ((row.handicapRecommendation === '观望' || !row.handicapRecommendation) && handicapProbB >= 65) {
          basketballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'handicap_high_prob_wait',
            anomalyDetail: `让分赢盘概率${handicapProbB}%但让分推荐=观望`,
            severity: 'medium',
          });
        }
        if ((row.totalDirection === '观望' || !row.totalDirection) && overProbB >= 65) {
          basketballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'total_high_prob_wait',
            anomalyDetail: `大分概率${overProbB}%但大小分推荐=观望`,
            severity: 'medium',
          });
        }
        // 4. 概率矛盾 - 胜负 vs 让球
        if (hwpB > 85 && row.handicapRecommendation && row.handicapRecommendation.includes('让分客')) {
          basketballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'wdw_vs_handicap_conflict',
            anomalyDetail: `主胜概率${hwpB}%但让分方向=${row.handicapRecommendation}（深盘赢球不赢盘）`,
            severity: 'medium',
          });
        } else if (awpB > 85 && row.handicapRecommendation && row.handicapRecommendation.includes('让分主')) {
          basketballResult.anomalies.push({
            id: row.id,
            matchNo: row.matchNo,
            league: row.league,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffTime: row.kickoffTime,
            anomalyType: 'wdw_vs_handicap_conflict',
            anomalyDetail: `客胜概率${awpB}%但让分方向=${row.handicapRecommendation}（深盘赢球不赢盘）`,
            severity: 'medium',
          });
        }
        // 3. 概率矛盾 - 大小球（predictedTotal vs totalLine 方向相反）
        const pt = Number(row.predictedTotal) || 0;
        const tl = Number(row.totalLineNum) || 0;
        if (pt > 0 && tl > 0) {
          const predictedOver = pt > tl;
          const recommendOver = row.totalDirection === '大分';
          if (predictedOver !== recommendOver && row.totalDirection && row.totalDirection !== '观望') {
            basketballResult.anomalies.push({
              id: row.id,
              matchNo: row.matchNo,
              league: row.league,
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              kickoffTime: row.kickoffTime,
              anomalyType: 'total_vs_predicted_conflict',
              anomalyDetail: `预期总分${pt} vs 盘口${tl}，方向=${row.totalDirection}（预测与推荐相反）`,
              severity: 'medium',
            });
          }
        }
        // 5. 缺失球队数据（降噪：排除测试标签 + 仅开赛前24h + 主客区分 + 过期归为赛果同步异常 + 排除情报/进阶数据路径场）
        const bbTestLeagues = ['Diff Batch', 'Perf55b'];
        if (!bbTestLeagues.includes(row.league)) {
          const ts = row.teamStats as Record<string, unknown> | null | undefined;
          const homeStats = ts?.home as Record<string, unknown> | undefined;
          const awayStats = ts?.away as Record<string, unknown> | undefined;
          const homeMissing = !homeStats || Object.keys(homeStats).length === 0;
          const awayMissing = !awayStats || Object.keys(awayStats).length === 0;
          const now = new Date();
          const kickoff = new Date(row.kickoffTime);
          const hoursToKickoff = (kickoff.getTime() - now.getTime()) / (1000 * 60 * 60);
          const rules: string[] = Array.isArray(row.modelRules) ? row.modelRules.map((r: unknown) => String(r)) : [];
          const hasIntelPath = rules.some((r: string) =>
            r.includes('Sportradar') || r.includes('效率模型') || r.includes('ORtg') || r.includes('DRtg') ||
            r.includes('进阶统计') || r.includes('情报自洽') || r.includes('情报驱动') || r.includes('R83') || r.includes('R84')
          );
          const hasDirection = row.predictionDirection && row.predictionDirection !== '观望';

          if (homeMissing || awayMissing) {
            if (row.matchStatus === 'upcoming' && hoursToKickoff < 0) {
              basketballResult.anomalies.push({
                id: row.id,
                matchNo: row.matchNo,
                league: row.league,
                homeTeam: row.homeTeam,
                awayTeam: row.awayTeam,
                kickoffTime: row.kickoffTime,
                anomalyType: 'result_sync_anomaly',
                anomalyDetail: `开赛时间已过${Math.abs(Math.round(hoursToKickoff))}小时但状态仍为upcoming`,
                severity: 'medium',
              });
            } else if (row.matchStatus === 'upcoming' && hoursToKickoff <= 24 && !(hasDirection && hasIntelPath)) {
              let missDetail = '';
              let sev: 'low' | 'medium' = 'low';
              if (homeMissing && awayMissing) {
                missDetail = '双方球队数据均为空';
                sev = 'medium';
              } else if (homeMissing) {
                missDetail = '主队数据为空';
              } else {
                missDetail = '客队数据为空';
              }
              basketballResult.anomalies.push({
                id: row.id,
                matchNo: row.matchNo,
                league: row.league,
                homeTeam: row.homeTeam,
                awayTeam: row.awayTeam,
                kickoffTime: row.kickoffTime,
                anomalyType: 'missing_team_data',
                anomalyDetail: missDetail + `（距开赛${Math.round(hoursToKickoff)}小时）`,
                severity: sev,
              });
            }
          }
        }
      }
    }

    const totalScanned = footballResult.total + basketballResult.total;

    void this.auditService.logAction({
      actionType: 'trigger_sync',
      targetType: 'inspection',
      detail: JSON.stringify({ sport: sportFilter, totalScanned, fbAnomalies: footballResult.anomalies.length, bbAnomalies: basketballResult.anomalies.length }),
      operatorId: admin.userId,
      ipAddress: this.getClientIp(req),
      result: 'success',
    });

    return {
      scanTime,
      totalScanned,
      football: footballResult,
      basketball: basketballResult,
    };
  }

  // ==================== 三、任务失败告警 ====================

  @Get('alerts/failed-tasks')
  async getFailedTaskAlerts(
    @Req() req: Request,
  ): Promise<{
    failedCount: number;
    items: Array<{
      id: string;
      taskName: string;
      trigger: string;
      startedAt: Date;
      errorMessage: string | null;
      dataSource: string | null;
    }>;
  }> {
    await this.requireAdmin(req);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const items = await this.db
      .select({
        id: syncTaskLogs.id,
        taskName: syncTaskLogs.taskName,
        trigger: syncTaskLogs.trigger,
        startedAt: syncTaskLogs.startedAt,
        errorMessage: syncTaskLogs.errorMessage,
        dataSource: syncTaskLogs.dataSource,
      })
      .from(syncTaskLogs)
      .where(and(
        eq(syncTaskLogs.status, 'failed'),
        gte(syncTaskLogs.startedAt, since),
      ))
      .orderBy(desc(syncTaskLogs.startedAt))
      .limit(20);

    return {
      failedCount: items.length,
      items,
    };
  }

  // ==================== 四、自动化任务管理 ====================

  @Get('automation/tasks')
  async getAutomationTasks(
    @Req() req: Request,
  ): Promise<{
    items: Array<{
      name: string;
      description: string;
      cron: string;
      trigger: string;
      enabled: boolean;
      isRunning: boolean;
      lastRunAt: string | null;
      lastStatus: string | null;
      lastErrorMessage: string | null;
      lastRecordsUpdated: number;
      isPlatformManaged: boolean;
    }>;
  }> {
    await this.requireAdmin(req);

    // 平台托管任务（从 sync_task_logs 反推状态）
    const platformTaskNames = ['daily_wnba_full_sync', 'hourly_onsale_capture', 'daily_review'];
    const platformDescriptions: Record<string, { description: string; cron: string }> = {
      daily_wnba_full_sync: { description: '每日全量 WNBA 数据同步（平台托管）', cron: '平台定时' },
      hourly_onsale_capture: { description: '开售即抓 + 赛果回填（平台托管）', cron: '每小时' },
      daily_review: { description: '每日赛果复盘（平台托管）', cron: '平台定时' },
    };

    const platformLogs = await this.db
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
          WHERE task_name IN (${sql.join(platformTaskNames.map((n) => sql`${n}`), sql`, `)})
          ORDER BY task_name, started_at DESC
        )
      `);

    const platformLogMap = new Map<string, typeof platformLogs[number]>();
    for (const log of platformLogs) {
      platformLogMap.set(log.taskName, log);
    }

    const platformItems = platformTaskNames.map((name) => {
      const log = platformLogMap.get(name);
      return {
        name,
        description: platformDescriptions[name]?.description ?? name,
        cron: platformDescriptions[name]?.cron ?? '平台定时',
        trigger: 'platform-cron',
        enabled: true,
        isRunning: log?.status === 'running',
        lastRunAt: log?.startedAt ? new Date(log.startedAt).toISOString() : null,
        lastStatus: log?.status ?? null,
        lastErrorMessage: log?.errorMessage ?? null,
        lastRecordsUpdated: log?.recordsUpdated ?? 0,
        isPlatformManaged: true,
      };
    });

    // 进程内 cron 任务
    const inProcStatuses = await this.syncSchedulerService.getAllTaskStatuses();
    const inProcItems = inProcStatuses.map((s) => ({
      name: s.taskName,
      description: s.description,
      cron: s.cron,
      trigger: 'cron',
      enabled: s.enabled,
      isRunning: s.isRunning,
      lastRunAt: s.lastRunAt,
      lastStatus: s.lastStatus,
      lastErrorMessage: s.lastErrorMessage,
      lastRecordsUpdated: s.lastRecordsUpdated,
      isPlatformManaged: false,
    }));

    return {
      items: [...platformItems, ...inProcItems],
    };
  }

  @Post('automation/tasks/:taskName/toggle')
  async toggleAutomationTask(
    @Req() req: Request,
    @Param('taskName') taskName: string,
    @Body() body: { enabled: boolean },
  ): Promise<{ taskName: string; enabled: boolean }> {
    const admin = await this.requireAdmin(req);

    // 平台托管任务禁止修改
    const platformTasks = ['daily_wnba_full_sync', 'hourly_onsale_capture', 'daily_review'];
    if (platformTasks.includes(taskName)) {
      throw new BadRequestException('平台托管任务不支持启停操作');
    }

    const ok = this.syncSchedulerService.setTaskEnabled(taskName, body.enabled);
    if (!ok) {
      throw new NotFoundException('任务不存在');
    }

    void this.auditService.logAction({
      actionType: 'trigger_sync',
      targetType: 'automation_task',
      targetId: taskName,
      detail: `enabled -> ${body.enabled}`,
      operatorId: admin.userId,
      ipAddress: this.getClientIp(req),
      result: 'success',
    });

    return { taskName, enabled: body.enabled };
  }

  @Post('automation/tasks/:taskName/run')
  async runAutomationTask(
    @Req() req: Request,
    @Param('taskName') taskName: string,
  ): Promise<{ taskName: string; ok: boolean; message: string }> {
    const admin = await this.requireAdmin(req);

    const platformTasks = ['daily_wnba_full_sync', 'hourly_onsale_capture', 'daily_review'];
    if (platformTasks.includes(taskName)) {
      throw new BadRequestException('平台托管任务暂不支持手动触发');
    }

    const result = await this.syncSchedulerService.runTask(taskName, 'manual');

    void this.auditService.logAction({
      actionType: 'trigger_sync',
      targetType: 'automation_task',
      targetId: taskName,
      detail: `manual run: ${result.message}`,
      operatorId: admin.userId,
      ipAddress: this.getClientIp(req),
      result: result.ok ? 'success' : 'failed',
    });

    return { taskName, ok: result.ok, message: result.message };
  }

  // ==================== 五、监控大盘 ====================

  @Get('monitor/overview')
  async getMonitorOverview(
    @Req() req: Request,
  ): Promise<{
    syncHealth: Array<{
      taskName: string;
      totalRuns: number;
      successRuns: number;
      failedRuns: number;
      successRate: number;
      lastRunAt: Date | null;
      lastStatus: string | null;
    }>;
    dataAccuracy: {
      football: Array<{
        date: string;
        wdwHitRate: number;
        handicapHitRate: number;
        overunderHitRate: number;
        total: number;
      }>;
      basketball: Array<{
        date: string;
        wdwHitRate: number;
        handicapHitRate: number;
        overunderHitRate: number;
        total: number;
      }>;
    };
    dataHealth: {
      footballTotal: number;
      basketballTotal: number;
      footballUpcoming: number;
      basketballUpcoming: number;
      footballLive: number;
      basketballLive: number;
      footballFinished: number;
      basketballFinished: number;
      anomalyCount: number;
      waitRateFootball: number;
      waitRateBasketball: number;
    };
    accuracySummary: {
      football7d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
      football30d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
      basketball7d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
      basketball30d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
    };
    dataSourceStatus: Array<{
      dataSource: string;
      totalRuns: number;
      successRuns: number;
      failedRuns: number;
      successRate: number;
      lastRunAt: Date | null;
    }>;
    failedAlerts: Array<{
      id: string;
      taskName: string;
      trigger: string;
      startedAt: Date;
      errorMessage: string | null;
      dataSource: string | null;
    }>;
    recentRuns: Array<{
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
    }>;
    engineInfo: {
      version: string;
      versionName: string;
      buildDate: string;
      football: {
        upcomingTotal: number;
        eloCount: number;
        eloCoverage: number;
        xgCount: number;
        xgCoverage: number;
        mlCount: number;
        mlCoverage: number;
      };
      basketball: {
        upcomingTotal: number;
        eloCount: number;
        eloCoverage: number;
        xgCount: number;
        xgCoverage: number;
        mlCount: number;
        mlCoverage: number;
      };
    };
    injuryHealth: {
      footballUpcomingTotal: number;
      footballInjuryCovered: number;
      footballInjuryCoverage: number;
      basketballUpcomingTotal: number;
      basketballInjuryCovered: number;
      basketballInjuryCoverage: number;
      totalReports: number;
      highImpactReports: number;
      mediumImpactReports: number;
      lowImpactReports: number;
      sourceLastSync: Array<{
        dataSource: string;
        sport: string;
        lastSyncAt: string | null;
        hoursSince: number;
        status: 'ok' | 'warn' | 'stale';
      }>;
      missingInjury24h: number;
    };
  }> {
    await this.requireAdmin(req);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // 1. syncHealth: 近7天各任务运行统计
    const syncHealthRaw = await this.db
      .select({
        taskName: syncTaskLogs.taskName,
        status: syncTaskLogs.status,
        startedAt: syncTaskLogs.startedAt,
      })
      .from(syncTaskLogs)
      .where(gte(syncTaskLogs.startedAt, sevenDaysAgo));

    const taskStats = new Map<string, { total: number; success: number; failed: number; lastRunAt: Date | null; lastStatus: string | null }>();
    for (const row of syncHealthRaw) {
      const stat = taskStats.get(row.taskName) ?? { total: 0, success: 0, failed: 0, lastRunAt: null, lastStatus: null };
      stat.total++;
      if (row.status === 'success') stat.success++;
      else if (row.status === 'failed') stat.failed++;
      if (!stat.lastRunAt || new Date(row.startedAt) > stat.lastRunAt) {
        stat.lastRunAt = new Date(row.startedAt);
        stat.lastStatus = row.status;
      }
      taskStats.set(row.taskName, stat);
    }

    const syncHealth = Array.from(taskStats.entries()).map(([taskName, stat]) => ({
      taskName,
      totalRuns: stat.total,
      successRuns: stat.success,
      failedRuns: stat.failed,
      successRate: stat.total > 0 ? Math.round((stat.success / stat.total) * 10000) / 100 : 0,
      lastRunAt: stat.lastRunAt,
      lastStatus: stat.lastStatus,
    }));

    // 2. dataAccuracy: 近30天命中率（日维度）
    const fbAccuracyRaw = await this.db.execute(sql`
      SELECT
        DATE(kickoff_time AT TIME ZONE 'Asia/Shanghai') as match_date,
        COUNT(*) as total,
        COUNT(CASE WHEN hit_wdw = true THEN 1 END) as wdw_hit,
        COUNT(CASE WHEN hit_handicap = true THEN 1 END) as handicap_hit,
        COUNT(CASE WHEN hit_overunder = true THEN 1 END) as ou_hit
      FROM matches
      WHERE match_status = 'finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND kickoff_time >= ${thirtyDaysAgo.toISOString()}
      GROUP BY DATE(kickoff_time AT TIME ZONE 'Asia/Shanghai')
      ORDER BY match_date DESC
      LIMIT 30
    `);

    const bbAccuracyRaw = await this.db.execute(sql`
      SELECT
        DATE(kickoff_time AT TIME ZONE 'Asia/Shanghai') as match_date,
        COUNT(*) as total,
        COUNT(CASE WHEN hit_wdw = true THEN 1 END) as wdw_hit,
        COUNT(CASE WHEN hit_handicap = true THEN 1 END) as handicap_hit,
        COUNT(CASE WHEN hit_overunder = true THEN 1 END) as ou_hit
      FROM basketball_matches
      WHERE match_status = 'finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND kickoff_time >= ${thirtyDaysAgo.toISOString()}
      GROUP BY DATE(kickoff_time AT TIME ZONE 'Asia/Shanghai')
      ORDER BY match_date DESC
      LIMIT 30
    `);

    const fbRows = (fbAccuracyRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
    const bbRows = (bbAccuracyRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];

    const footballAccuracy = fbRows.map((row) => {
      const total = Number(row.total) || 0;
      const wdwHit = Number(row.wdw_hit) || 0;
      const handicapHit = Number(row.handicap_hit) || 0;
      const ouHit = Number(row.ou_hit) || 0;
      return {
        date: String(row.match_date),
        wdwHitRate: total > 0 ? Math.round((wdwHit / total) * 10000) / 100 : 0,
        handicapHitRate: total > 0 ? Math.round((handicapHit / total) * 10000) / 100 : 0,
        overunderHitRate: total > 0 ? Math.round((ouHit / total) * 10000) / 100 : 0,
        total,
      };
    });

    const basketballAccuracy = bbRows.map((row) => {
      const total = Number(row.total) || 0;
      const wdwHit = Number(row.wdw_hit) || 0;
      const handicapHit = Number(row.handicap_hit) || 0;
      const ouHit = Number(row.ou_hit) || 0;
      return {
        date: String(row.match_date),
        wdwHitRate: total > 0 ? Math.round((wdwHit / total) * 10000) / 100 : 0,
        handicapHitRate: total > 0 ? Math.round((handicapHit / total) * 10000) / 100 : 0,
        overunderHitRate: total > 0 ? Math.round((ouHit / total) * 10000) / 100 : 0,
        total,
      };
    });

    // 3. dataHealth
    const [
      fbTotal,
      bbTotal,
      fbUpcoming,
      bbUpcoming,
      fbLive,
      bbLive,
      fbFinished,
      bbFinished,
      fbWait,
      bbWait,
      fbZeroConfWithDir,
      bbZeroConfWithDir,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(matches),
      this.db.select({ count: count() }).from(basketballMatches),
      this.db.select({ count: count() }).from(matches).where(eq(matches.matchStatus, 'upcoming')),
      this.db.select({ count: count() }).from(basketballMatches).where(eq(basketballMatches.matchStatus, 'upcoming')),
      this.db.select({ count: count() }).from(matches).where(eq(matches.matchStatus, 'live')),
      this.db.select({ count: count() }).from(basketballMatches).where(eq(basketballMatches.matchStatus, 'live')),
      this.db.select({ count: count() }).from(matches).where(eq(matches.matchStatus, 'finished')),
      this.db.select({ count: count() }).from(basketballMatches).where(eq(basketballMatches.matchStatus, 'finished')),
      this.db.select({ count: count() }).from(matches).where(or(eq(matches.predictionDirection, '观望'), eq(matches.predictionDirection, ''))),
      this.db.select({ count: count() }).from(basketballMatches).where(or(eq(basketballMatches.predictionDirection, '观望'), eq(basketballMatches.predictionDirection, ''))),
      this.db.select({ count: count() }).from(matches).where(and(eq(matches.confidence, 0), sql`${matches.predictionDirection} NOT IN ('', '观望')`)),
      this.db.select({ count: count() }).from(basketballMatches).where(and(eq(basketballMatches.confidence, 0), sql`${basketballMatches.predictionDirection} NOT IN ('', '观望')`)),
    ]);

    const ft = Number(fbUpcoming[0]?.count ?? 0) + Number(fbLive[0]?.count ?? 0);
    const bt = Number(bbUpcoming[0]?.count ?? 0) + Number(bbLive[0]?.count ?? 0);

    const fbWaitActive = await this.db.select({ count: count() }).from(matches).where(and(or(eq(matches.matchStatus, 'upcoming'), eq(matches.matchStatus, 'live')), or(eq(matches.predictionDirection, '观望'), eq(matches.predictionDirection, ''))));
    const bbWaitActive = await this.db.select({ count: count() }).from(basketballMatches).where(and(or(eq(basketballMatches.matchStatus, 'upcoming'), eq(basketballMatches.matchStatus, 'live')), or(eq(basketballMatches.predictionDirection, '观望'), eq(basketballMatches.predictionDirection, ''))));

    // 3.5 命中率汇总（近7天和近30天）
    const calcSummary = (rows: Array<{ date: string; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number; total: number }>, days: number) => {
      const slice = rows.slice(0, days);
      const totalMatches = slice.reduce((sum: number, r) => sum + r.total, 0);
      const wdwSum = slice.reduce((sum: number, r) => sum + (r.total * r.wdwHitRate / 100), 0);
      const handicapSum = slice.reduce((sum: number, r) => sum + (r.total * r.handicapHitRate / 100), 0);
      const ouSum = slice.reduce((sum: number, r) => sum + (r.total * r.overunderHitRate / 100), 0);
      return {
        totalMatches,
        wdwHitRate: totalMatches > 0 ? Math.round((wdwSum / totalMatches) * 10000) / 100 : 0,
        handicapHitRate: totalMatches > 0 ? Math.round((handicapSum / totalMatches) * 10000) / 100 : 0,
        overunderHitRate: totalMatches > 0 ? Math.round((ouSum / totalMatches) * 10000) / 100 : 0,
      };
    };

    const accuracySummary = {
      football7d: calcSummary(footballAccuracy, 7),
      football30d: calcSummary(footballAccuracy, 30),
      basketball7d: calcSummary(basketballAccuracy, 7),
      basketball30d: calcSummary(basketballAccuracy, 30),
    };

    // 3.6 同步链路状态（按 data_source 分组，统计最近状态）
    const dsRaw = await this.db.execute(sql`
      SELECT
        data_source,
        COUNT(*) as total_runs,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_runs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_runs,
        MAX(started_at) as last_run_at
      FROM sync_task_logs
      WHERE started_at >= ${sevenDaysAgo.toISOString()}
        AND data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY last_run_at DESC
    `);
    const dsRows = (dsRaw as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
    const dataSourceStatus = dsRows.map((row) => {
      const total = Number(row.total_runs) || 0;
      const succ = Number(row.success_runs) || 0;
      return {
        dataSource: String(row.data_source),
        totalRuns: total,
        successRuns: succ,
        failedRuns: Number(row.failed_runs) || 0,
        successRate: total > 0 ? Math.round((succ / total) * 10000) / 100 : 0,
        lastRunAt: row.last_run_at ? new Date(String(row.last_run_at)) : null,
      };
    });

    // 3.7 近24h失败告警
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedAlertRaw = await this.db
      .select({
        id: syncTaskLogs.id,
        taskName: syncTaskLogs.taskName,
        trigger: syncTaskLogs.trigger,
        startedAt: syncTaskLogs.startedAt,
        errorMessage: syncTaskLogs.errorMessage,
        dataSource: syncTaskLogs.dataSource,
      })
      .from(syncTaskLogs)
      .where(and(
        eq(syncTaskLogs.status, 'failed'),
        gte(syncTaskLogs.startedAt, oneDayAgo),
        sql`${syncTaskLogs.errorMessage} NOT LIKE '%watchdog cleanup%'`,
      ))
      .orderBy(desc(syncTaskLogs.startedAt))
      .limit(20);

    // 4. recentRuns
    const recentRuns = await this.syncSchedulerService.getRecentLogs(20);

    // 5. engineInfo 引擎升级信息
    const fbUpcomingCount = Number(fbUpcoming[0]?.count ?? 0);
    const bbUpcomingCount = Number(bbUpcoming[0]?.count ?? 0);
    const fbEloRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM matches
      WHERE match_status = 'upcoming' AND elo_home IS NOT NULL AND elo_away IS NOT NULL
    `);
    const fbXgRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM matches
      WHERE match_status = 'upcoming' AND model_rules::text LIKE '%R-XG-PROXY%'
    `);
    const fbMlRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM matches
      WHERE match_status = 'upcoming' AND model_rules::text LIKE '%R-ML-ENSEMBLE%'
    `);
    const bbEloRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM basketball_matches
      WHERE match_status = 'upcoming' AND elo_home IS NOT NULL AND elo_away IS NOT NULL
    `);
    const bbXgRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM basketball_matches
      WHERE match_status = 'upcoming' AND model_rules::text LIKE '%R-XG%'
    `);
    const bbMlRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM basketball_matches
      WHERE match_status = 'upcoming' AND model_rules::text LIKE '%R-ML%'
    `);
    const fbEloCnt = Number((fbEloRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const fbXgCnt = Number((fbXgRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const fbMlCnt = Number((fbMlRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const bbEloCnt = Number((bbEloRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const bbXgCnt = Number((bbXgRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const bbMlCnt = Number((bbMlRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);
    const pct = (n: number, total: number): number =>
      total > 0 ? Math.round((n / total) * 10000) / 100 : 0;

    // 6. injuryHealth 情报健康度
    const nowMs = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    const warnHours = 6;
    const staleHours = 12;

    const basketballInjuryRaw = await this.db.execute(sql`
      SELECT COUNT(DISTINCT bm.id) as covered
      FROM basketball_matches bm
      JOIN injury_reports ir ON ir.match_id = bm.id AND ir.sport = 'basketball'
      WHERE bm.match_status = 'upcoming'
    `);
    const footballInjuryRaw = await this.db.execute(sql`
      SELECT COUNT(DISTINCT m.id) as covered
      FROM matches m
      JOIN injury_reports ir ON ir.match_id = m.id AND ir.sport = 'football'
      WHERE m.match_status = 'upcoming'
    `);
    const totalInjuryRaw = await this.db
      .select({
        impactRating: injuryReports.impactRating,
        count: sql<number>`count(*)`,
      })
      .from(injuryReports)
      .groupBy(injuryReports.impactRating);
    const sourceLastSyncRaw = await this.db
      .select({
        dataSource: injuryReports.dataSource,
        sport: injuryReports.sport,
        lastSyncAt: sql<string>`max(${injuryReports.createdAt})::text`,
        reportCount: sql<number>`count(*)`,
      })
      .from(injuryReports)
      .groupBy(injuryReports.dataSource, injuryReports.sport);
    const missingInjury24hRaw = await this.db.execute(sql`
      SELECT COUNT(*) as cnt FROM basketball_matches
      WHERE match_status = 'upcoming'
        AND kickoff_time >= NOW()
        AND kickoff_time <= NOW() + interval '24 hours'
        AND id NOT IN (SELECT match_id FROM injury_reports WHERE sport = 'basketball')
        AND league NOT LIKE '%测试%'
        AND home_team NOT LIKE '%测试%'
    `);

    const fbInjuryCovered = Number((footballInjuryRaw as unknown as { rows: Array<{ covered: string }> }).rows?.[0]?.covered ?? 0);
    const bbInjuryCovered = Number((basketballInjuryRaw as unknown as { rows: Array<{ covered: string }> }).rows?.[0]?.covered ?? 0);
    const missingInjury24h = Number((missingInjury24hRaw as unknown as { rows: Array<{ cnt: string }> }).rows?.[0]?.cnt ?? 0);

    let highCnt = 0;
    let medCnt = 0;
    let lowCnt = 0;
    let totalReports = 0;
    for (const r of totalInjuryRaw) {
      const n = Number(r.count) || 0;
      totalReports += n;
      if (r.impactRating === 'high') highCnt = n;
      else if (r.impactRating === 'medium') medCnt = n;
      else if (r.impactRating === 'low') lowCnt = n;
    }

    const sourceLastSync = sourceLastSyncRaw.map((r) => {
      const lastStr = r.lastSyncAt;
      let hoursSince = 999;
      let status: 'ok' | 'warn' | 'stale' = 'stale';
      if (lastStr) {
        const t = new Date(lastStr).getTime();
        hoursSince = Math.round((nowMs - t) / oneHourMs * 10) / 10;
        if (hoursSince <= warnHours) status = 'ok';
        else if (hoursSince <= staleHours) status = 'warn';
        else status = 'stale';
      }
      return {
        dataSource: r.dataSource || 'unknown',
        sport: r.sport || 'unknown',
        lastSyncAt: lastStr || null,
        hoursSince,
        status,
      };
    });

    return {
      syncHealth,
      dataAccuracy: {
        football: footballAccuracy,
        basketball: basketballAccuracy,
      },
      accuracySummary,
      dataHealth: {
        footballTotal: Number(fbTotal[0]?.count ?? 0),
        basketballTotal: Number(bbTotal[0]?.count ?? 0),
        footballUpcoming: Number(fbUpcoming[0]?.count ?? 0),
        basketballUpcoming: Number(bbUpcoming[0]?.count ?? 0),
        footballLive: Number(fbLive[0]?.count ?? 0),
        basketballLive: Number(bbLive[0]?.count ?? 0),
        footballFinished: Number(fbFinished[0]?.count ?? 0),
        basketballFinished: Number(bbFinished[0]?.count ?? 0),
        anomalyCount: Number(fbZeroConfWithDir[0]?.count ?? 0) + Number(bbZeroConfWithDir[0]?.count ?? 0),
        waitRateFootball: ft > 0 ? Math.round((Number(fbWaitActive[0]?.count ?? 0) / ft) * 10000) / 100 : 0,
        waitRateBasketball: bt > 0 ? Math.round((Number(bbWaitActive[0]?.count ?? 0) / bt) * 10000) / 100 : 0,
      },
      dataSourceStatus,
      failedAlerts: failedAlertRaw,
      recentRuns,
      engineInfo: {
        version: 'v11.0-P1',
        versionName: 'V11 统一引擎（Elo + 近期战绩 + H2H + 伤停融合）',
        buildDate: '2026-10-19',
        football: {
          upcomingTotal: fbUpcomingCount,
          eloCount: fbEloCnt,
          eloCoverage: pct(fbEloCnt, fbUpcomingCount),
          xgCount: fbXgCnt,
          xgCoverage: pct(fbXgCnt, fbUpcomingCount),
          mlCount: fbMlCnt,
          mlCoverage: pct(fbMlCnt, fbUpcomingCount),
        },
        basketball: {
          upcomingTotal: bbUpcomingCount,
          eloCount: bbEloCnt,
          eloCoverage: pct(bbEloCnt, bbUpcomingCount),
          xgCount: bbXgCnt,
          xgCoverage: pct(bbXgCnt, bbUpcomingCount),
          mlCount: bbMlCnt,
          mlCoverage: pct(bbMlCnt, bbUpcomingCount),
        },
      },
      injuryHealth: {
        footballUpcomingTotal: fbUpcomingCount,
        footballInjuryCovered: fbInjuryCovered,
        footballInjuryCoverage: pct(fbInjuryCovered, fbUpcomingCount),
        basketballUpcomingTotal: bbUpcomingCount,
        basketballInjuryCovered: bbInjuryCovered,
        basketballInjuryCoverage: pct(bbInjuryCovered, bbUpcomingCount),
        totalReports,
        highImpactReports: highCnt,
        mediumImpactReports: medCnt,
        lowImpactReports: lowCnt,
        sourceLastSync,
        missingInjury24h: missingInjury24h,
      },
    };
  }
}
