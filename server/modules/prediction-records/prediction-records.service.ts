import { Injectable, Inject, Logger, NotFoundException, BadRequestException, forwardRef } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { BasketballService } from '@server/modules/basketball/basketball.service';
import { predictionRecords, matches, basketballMatches } from '@server/database/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type {
  MatchItem,
  BasketballMatchItem,
  PredictionRecordItem,
  PredictionRecordListResponse,
} from '@shared/api.interface';

const VALID_ACTION_TYPES = ['viewed', 'favorited', 'hit', 'missed'];

const buildAuthUserIdSql = (userId: string) => sql`SET LOCAL app.auth_user_id = '${sql.raw(userId)}'`;

function extractPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

@Injectable()
export class PredictionRecordsService {
  private readonly logger = new Logger(PredictionRecordsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(forwardRef(() => BasketballService)) private readonly basketballService: BasketballService,
  ) {}

  private async withUserAuth<T>(userId: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.transaction(async (tx) => {
          await tx.execute(buildAuthUserIdSql(userId));
          const verifyResult = await tx.execute(sql<{ val: string }>`SELECT current_setting('app.auth_user_id', true) AS val`);
          const verified = Array.isArray(verifyResult) ? verifyResult[0]?.val : (verifyResult as unknown as { val: string })?.val;
          if (verified !== userId) {
            throw new Error(`auth_user_id verification failed: expected=${userId}, got=${verified ?? 'NULL'}`);
          }
          return await fn(tx);
        });
      } catch (err) {
        lastError = err;
        const code = extractPostgresErrorCode(err);
        const isRlsError = code === '42501';
        const isVerifyError = err instanceof Error && err.message.includes('auth_user_id verification failed');
        this.logger.warn(
          `prediction record auth query failed (attempt ${attempt + 1}/3), code=${code ?? 'unknown'}, retrying=${isRlsError || isVerifyError}: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < 2 && (isRlsError || isVerifyError)) continue;
        break;
      }
    }
    throw lastError;
  }

  private toMatchItem(row: typeof matches.$inferSelect): MatchItem {
    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      homeWinProb: row.homeWinProb,
      drawProb: row.drawProb,
      awayWinProb: row.awayWinProb,
      predictionDirection: row.predictionDirection,
      handicap: row.handicap,
      handicapRecommendation: row.handicapRecommendation,
      confidence: row.confidence,
      lowConfidence: row.lowConfidence,
      intel: row.intel,
      modelRules: row.modelRules,
      matchDate: row.matchDate,
      overUnder: row.overUnder,
      overProb: row.overProb,
      underProb: row.underProb,
      totalGoals: Number(row.totalGoals),
      mostLikelyScore: row.mostLikelyScore,
      scoreProbs: row.scoreProbs,
      totalGoalsProb: (row.totalGoalsProb as unknown as MatchItem['totalGoalsProb']) ?? [],
      halfFullProb: (row.halfFullProb as unknown as MatchItem['halfFullProb']) ?? [],
      advancedStats: (row.advancedStats as unknown as MatchItem['advancedStats']) ?? {
        xgHome: 0, xgAway: 0, xaHome: 0, xaAway: 0,
        shotsHome: 0, shotsAway: 0, shotsOnTargetHome: 0, shotsOnTargetAway: 0,
        cornersHome: 0, cornersAway: 0, possessionHome: 50, possessionAway: 50,
        foulsHome: 0, foulsAway: 0, passAccuracyHome: 0, passAccuracyAway: 0,
      },
      environment: (row.environment as unknown as MatchItem['environment']) ?? {
        weather: { temp: 0, condition: '', humidity: 0, wind: 0 },
        stadium: { name: '', capacity: 0, grass: '' },
        referee: { name: '', matches: 0, avgYellow: 0, avgRed: 0, penaltyRate: 0 },
      },
      matchStatus: row.matchStatus as MatchItem['matchStatus'],
      homeScore: row.homeScore ?? undefined,
      awayScore: row.awayScore ?? undefined,
      homeForm: row.homeForm,
      awayForm: row.awayForm,
      h2h: row.h2h,
      oddsOpenHome: row.oddsOpenHome !== null ? Number(row.oddsOpenHome) : undefined,
      oddsOpenDraw: row.oddsOpenDraw !== null ? Number(row.oddsOpenDraw) : undefined,
      oddsOpenAway: row.oddsOpenAway !== null ? Number(row.oddsOpenAway) : undefined,
      oddsLiveHome: row.oddsLiveHome !== null ? Number(row.oddsLiveHome) : undefined,
      oddsLiveDraw: row.oddsLiveDraw !== null ? Number(row.oddsLiveDraw) : undefined,
      oddsLiveAway: row.oddsLiveAway !== null ? Number(row.oddsLiveAway) : undefined,
      drawConfidence: row.drawConfidence as MatchItem['drawConfidence'] ?? '中',
      drawFactors: row.drawFactors ?? [],
      handicapWinProb: Number(row.handicapWinProb),
      handicapDrawProb: Number(row.handicapDrawProb),
      handicapLoseProb: Number(row.handicapLoseProb),
      kellyH: Number(row.kellyH),
      kellyD: Number(row.kellyD),
      kellyA: Number(row.kellyA),
      handicapSecondChoice: row.handicapSecondChoice ?? '',
      handicapValueRating: row.handicapValueRating ?? '中价值',
      rulesTriggered: (row.rulesTriggered as unknown as MatchItem['rulesTriggered']) ?? [],
      hitWdw: row.hitWdw ?? undefined,
      hitHandicap: row.hitHandicap ?? undefined,
      hitOverunder: row.hitOverunder ?? undefined,
      hitGoals: row.hitGoals ?? undefined,
      hitHalffull: row.hitHalffull ?? undefined,
      errorReason: row.errorReason ?? undefined,
      homeGoalsAvg: Number(row.homeGoalsAvg),
      awayGoalsAvg: Number(row.awayGoalsAvg),
      homeConcededAvg: Number(row.homeConcededAvg),
      awayConcededAvg: Number(row.awayConcededAvg),
      homeHomeRecord: row.homeHomeRecord ?? '',
      awayAwayRecord: row.awayAwayRecord ?? '',
      homeInjuries: row.homeInjuries ?? '',
      awayInjuries: row.awayInjuries ?? '',
      tacticsHome: row.tacticsHome ?? '',
      tacticsAway: row.tacticsAway ?? '',
      keyPlayersHome: row.keyPlayersHome ?? '',
      keyPlayersAway: row.keyPlayersAway ?? '',
      upsetWarning: row.upsetWarning ?? '',
      teamNews: row.teamNews ?? '',
      injuries: row.injuries ?? '',
      mediaConsensus: row.mediaConsensus ?? '',
      expertPicks: row.expertPicks ?? '',
      keyPlayers: row.keyPlayers ?? '',
      intelUpdatedAt: row.intelUpdatedAt ? row.intelUpdatedAt.toISOString() : undefined,
    };
  }

  private toBasketballMatchItem(row: typeof basketballMatches.$inferSelect): BasketballMatchItem {
    return this.basketballService.mapToItem(row);
  }

  async getList(userId: string, actionType?: string): Promise<PredictionRecordListResponse> {
    try {
      const conditions = [eq(predictionRecords.userId, userId)];
      if (actionType) {
        conditions.push(eq(predictionRecords.actionType, actionType));
      }

      const whereClause = conditions.length > 1
        ? and(...conditions)
        : conditions[0];

      const rows = await this.db
        .select({
          record: predictionRecords,
          match: matches,
        })
        .from(predictionRecords)
        .innerJoin(matches, eq(predictionRecords.matchId, matches.id))
        .where(whereClause)
        .orderBy(desc(predictionRecords.viewedAt), desc(predictionRecords.createdAt));

      const items: PredictionRecordItem[] = rows.map((row: { record: typeof predictionRecords.$inferSelect; match: typeof matches.$inferSelect }) => ({
        id: row.record.id,
        matchId: row.record.matchId,
        actionType: row.record.actionType,
        viewedAt: row.record.viewedAt ? row.record.viewedAt.toISOString() : '',
        createdAt: row.record.createdAt.toISOString(),
        match: this.toMatchItem(row.match),
      }));

      return { items };
    } catch (error) {
      this.logger.error(`获取预测记录失败 userId=${userId} actionType=${actionType}`, JSON.stringify(error));
      throw error;
    }
  }

  async upsert(
    userId: string,
    matchId: string,
    actionType: string,
    viewedAt?: string,
  ): Promise<PredictionRecordItem> {
    try {
      if (!VALID_ACTION_TYPES.includes(actionType)) {
        throw new BadRequestException(`无效的 actionType，取值范围: ${VALID_ACTION_TYPES.join(', ')}`);
      }

      const matchRows: (typeof matches.$inferSelect)[] = await this.db
        .select()
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);

      let matchType: 'football' | 'basketball' = 'football';
      let matchRow: typeof matches.$inferSelect | typeof basketballMatches.$inferSelect | null = null;

      if (matchRows.length > 0) {
        matchRow = matchRows[0];
        matchType = 'football';
      } else {
        const bbRows: (typeof basketballMatches.$inferSelect)[] = await this.db
          .select()
          .from(basketballMatches)
          .where(eq(basketballMatches.id, matchId))
          .limit(1);
        if (bbRows.length === 0) {
          throw new NotFoundException('比赛不存在');
        }
        matchRow = bbRows[0];
        matchType = 'basketball';
      }

      const viewedAtDate = viewedAt ? new Date(viewedAt) : new Date();

      const result = await this.withUserAuth(userId, async (tx) => {
        await tx
          .delete(predictionRecords)
          .where(and(
            eq(predictionRecords.userId, userId),
            eq(predictionRecords.matchId, matchId),
            eq(predictionRecords.actionType, actionType),
          ));

        const inserted = await tx
          .insert(predictionRecords)
          .values({
            userId,
            matchId,
            actionType,
            viewedAt: viewedAtDate,
          })
          .returning();

        return inserted[0];
      });

      const matchData = matchType === 'football'
        ? this.toMatchItem(matchRow as typeof matches.$inferSelect)
        : (this.toBasketballMatchItem(matchRow as typeof basketballMatches.$inferSelect) as unknown as MatchItem);

      return {
        id: result.id,
        matchId: result.matchId,
        actionType: result.actionType,
        viewedAt: result.viewedAt ? result.viewedAt.toISOString() : '',
        createdAt: result.createdAt.toISOString(),
        match: matchData,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`新增预测记录失败 userId=${userId} matchId=${matchId} actionType=${actionType}`, JSON.stringify(error));
      throw error;
    }
  }
}
