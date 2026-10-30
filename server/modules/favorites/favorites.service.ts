import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { favorites, matches, basketballMatches } from '@server/database/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

import type {
  MatchItem,
  BasketballMatchItem,
  FavoriteItem,
  BasketballFavoriteItem,
  FavoriteListResponse,
  SportType,
} from '@shared/api.interface';

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
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

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
          `favorite auth query failed (attempt ${attempt + 1}/3), code=${code ?? 'unknown'}, retrying=${isRlsError || isVerifyError}: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < 2 && (isRlsError || isVerifyError)) continue;
        break;
      }
    }
    throw lastError;
  }

  private toFootballMatchItem(row: typeof matches.$inferSelect): MatchItem {
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
      matchDate: String(row.matchDate),
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
      injuries: this.normalizeToText(row.injuries),
      mediaConsensus: row.mediaConsensus ?? '',
      expertPicks: row.expertPicks ?? '',
      keyPlayers: this.normalizeToText(row.keyPlayers),
      intelUpdatedAt: row.intelUpdatedAt ? row.intelUpdatedAt.toISOString() : undefined,
    };
  }

  private toBasketballMatchItem(row: typeof basketballMatches.$inferSelect): BasketballMatchItem {
    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      matchDate: String(row.matchDate),
      businessDate: String(row.businessDate),
      venue: row.venue,
      homeWinProb: row.homeWinProb,
      awayWinProb: row.awayWinProb,
      predictionDirection: row.predictionDirection,
      handicap: row.handicap,
      handicapCoverProb: row.handicapCoverProb,
      handicapRecommendation: row.handicapRecommendation,
      handicapPick: row.handicapPick ?? '',
      handicapPickProb: row.handicapPickProb,
      totalLine: row.totalLine,
      overProb: row.overProb,
      underProb: row.underProb,
      totalDirection: row.totalDirection,
      totalPick: row.totalPick ?? '',
      totalPickProb: row.totalPickProb,
      predictedHomeScore: row.predictedHomeScore,
      predictedAwayScore: row.predictedAwayScore,
      confidence: row.confidence,
      intel: row.intel,
      riskWarning: row.riskWarning,
      matchStatus: row.matchStatus as BasketballMatchItem['matchStatus'],
      homeScore: row.homeScore ?? null,
      awayScore: row.awayScore ?? null,
      hitWdw: row.hitWdw ?? null,
      hitHandicap: row.hitHandicap ?? null,
      hitOverunder: row.hitOverunder ?? null,
      isNeutral: row.isNeutral,
      category: row.category as BasketballMatchItem['category'],
      handicapOddsHome: row.handicapOddsHome !== null && row.handicapOddsHome !== undefined ? Number(row.handicapOddsHome) : null,
      handicapOddsAway: row.handicapOddsAway !== null && row.handicapOddsAway !== undefined ? Number(row.handicapOddsAway) : null,
      totalOddsOver: row.totalOddsOver !== null && row.totalOddsOver !== undefined ? Number(row.totalOddsOver) : null,
      totalOddsUnder: row.totalOddsUnder !== null && row.totalOddsUnder !== undefined ? Number(row.totalOddsUnder) : null,
      homeWinOdds: row.homeWinOdds !== null && row.homeWinOdds !== undefined ? Number(row.homeWinOdds) : null,
      awayWinOdds: row.awayWinOdds !== null && row.awayWinOdds !== undefined ? Number(row.awayWinOdds) : null,
      spreadProb1_5: row.spreadProb15,
      spreadProb6_10: row.spreadProb610,
      spreadProb11_15: row.spreadProb1115,
      spreadProb16_20: row.spreadProb1620,
      spreadProb21Plus: row.spreadProb21Plus,
      spreadTopRange: row.spreadTopRange ?? '',
      modelRules: row.modelRules,
      dataUpdatedAt: row.dataUpdatedAt.toISOString(),
      homeStats: (row.teamStats as unknown as { home?: BasketballMatchItem['homeStats'] })?.home ?? null,
      awayStats: (row.teamStats as unknown as { away?: BasketballMatchItem['awayStats'] })?.away ?? null,
      homeRadar: (row.radarData as unknown as { home?: BasketballMatchItem['homeRadar'] })?.home ?? null,
      awayRadar: (row.radarData as unknown as { away?: BasketballMatchItem['awayRadar'] })?.away ?? null,
      homeRecentForm: (row.recentForm as unknown as { home?: BasketballMatchItem['homeRecentForm'] })?.home ?? null,
      awayRecentForm: (row.recentForm as unknown as { away?: BasketballMatchItem['awayRecentForm'] })?.away ?? null,
      homeInjuries: null,
      awayInjuries: null,
      h2hHistory: row.h2hHistory as unknown as BasketballMatchItem['h2hHistory'],
      predHtHome: row.predHtHome ?? 0,
      predHtAway: row.predHtAway ?? 0,
      intelSummary: row.intelSummary ?? '',
      upsetWarning: row.upsetWarning ?? '',
      homeKeyPlayers: (row.keyPlayers as unknown as { home?: BasketballMatchItem['homeKeyPlayers'] })?.home ?? null,
      awayKeyPlayers: (row.keyPlayers as unknown as { away?: BasketballMatchItem['awayKeyPlayers'] })?.away ?? null,
      handicapLineNum: row.handicapLineNum !== null && row.handicapLineNum !== undefined ? Number(row.handicapLineNum) : 0,
      totalLineNum: row.totalLineNum !== null && row.totalLineNum !== undefined ? Number(row.totalLineNum) : 0,
      teamNews: row.teamNews ?? '',
      injuries: this.normalizeToText(row.injuries),
      mediaConsensus: row.mediaConsensus ?? '',
      expertPicks: row.expertPicks ?? '',
      keyPlayers: this.normalizeToText(row.keyPlayers),
      intelUpdatedAt: row.intelUpdatedAt ? row.intelUpdatedAt.toISOString() : undefined,
    };
  }

  private normalizeToText(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  async getList(userId: string, sportType: SportType = 'football'): Promise<FavoriteListResponse> {
    try {
      if (sportType === 'basketball') {
        const rows = await this.db
          .select({
            favorite: favorites,
            match: basketballMatches,
          })
          .from(favorites)
          .innerJoin(basketballMatches, eq(favorites.matchId, basketballMatches.id))
          .where(and(
            eq(favorites.userId, userId),
            eq(favorites.sportType, 'basketball'),
          ))
          .orderBy(desc(favorites.createdAt));

        const items: BasketballFavoriteItem[] = rows.map((row) => ({
          id: row.favorite.id,
          matchId: row.favorite.matchId,
          sportType: 'basketball',
          createdAt: row.favorite.createdAt.toISOString(),
          match: this.toBasketballMatchItem(row.match),
        }));

        return { items, sportType: 'basketball' };
      }

      // football (default)
      const rows = await this.db
        .select({
          favorite: favorites,
          match: matches,
        })
        .from(favorites)
        .innerJoin(matches, eq(favorites.matchId, matches.id))
        .where(and(
          eq(favorites.userId, userId),
          eq(favorites.sportType, 'football'),
        ))
        .orderBy(desc(favorites.createdAt));

      const items: FavoriteItem[] = rows.map((row) => ({
        id: row.favorite.id,
        matchId: row.favorite.matchId,
        sportType: 'football',
        createdAt: row.favorite.createdAt.toISOString(),
        match: this.toFootballMatchItem(row.match),
      }));

      return { items, sportType: 'football' };
    } catch (error) {
      this.logger.error(`获取收藏列表失败 userId=${userId} sportType=${sportType}`, JSON.stringify(error));
      throw error;
    }
  }

  async add(userId: string, matchId: string, sportType: SportType = 'football'): Promise<FavoriteItem | BasketballFavoriteItem> {
    try {
      if (sportType === 'basketball') {
        const matchRows = await this.db
          .select()
          .from(basketballMatches)
          .where(eq(basketballMatches.id, matchId))
          .limit(1);

        if (matchRows.length === 0) {
          throw new NotFoundException('比赛不存在');
        }

        const { inserted, favRow } = await this.withUserAuth(userId, async (tx) => {
          const insertResult = await tx
            .insert(favorites)
            .values({
              userId,
              matchId,
              sportType: 'basketball',
            })
            .onConflictDoNothing()
            .returning();

          let row: typeof favorites.$inferSelect | undefined;
          if (insertResult.length > 0) {
            row = insertResult[0];
          } else {
            const existing = await tx
              .select()
              .from(favorites)
              .where(and(
                eq(favorites.userId, userId),
                eq(favorites.matchId, matchId),
                eq(favorites.sportType, 'basketball'),
              ))
              .limit(1);
            row = existing[0];
          }
          return { inserted: insertResult.length > 0, favRow: row };
        });

        if (!favRow) {
          throw new NotFoundException('收藏记录不存在');
        }

        return {
          id: favRow.id,
          matchId: favRow.matchId,
          sportType: 'basketball',
          createdAt: favRow.createdAt.toISOString(),
          match: this.toBasketballMatchItem(matchRows[0]),
        };
      }

      // football (default)
      const matchRows = await this.db
        .select()
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);

      if (matchRows.length === 0) {
        throw new NotFoundException('比赛不存在');
      }

      const { favRow } = await this.withUserAuth(userId, async (tx) => {
        const insertResult = await tx
          .insert(favorites)
          .values({
            userId,
            matchId,
            sportType: 'football',
          })
          .onConflictDoNothing()
          .returning();

        let row: typeof favorites.$inferSelect | undefined;
        if (insertResult.length > 0) {
          row = insertResult[0];
        } else {
          const existing = await tx
            .select()
            .from(favorites)
            .where(and(
              eq(favorites.userId, userId),
              eq(favorites.matchId, matchId),
              eq(favorites.sportType, 'football'),
            ))
            .limit(1);
          row = existing[0];
        }
        return { favRow: row };
      });

      if (!favRow) {
        throw new NotFoundException('收藏记录不存在');
      }

      return {
        id: favRow.id,
        matchId: favRow.matchId,
        sportType: 'football',
        createdAt: favRow.createdAt.toISOString(),
        match: this.toFootballMatchItem(matchRows[0]),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`添加收藏失败 userId=${userId} matchId=${matchId} sportType=${sportType}`, JSON.stringify(error));
      throw error;
    }
  }

  async remove(userId: string, matchId: string, sportType: SportType = 'football'): Promise<{ success: boolean }> {
    try {
      const rows = await this.withUserAuth(userId, async (tx) => {
        return tx
          .delete(favorites)
          .where(and(
            eq(favorites.userId, userId),
            eq(favorites.matchId, matchId),
            eq(favorites.sportType, sportType),
          ))
          .returning({ id: favorites.id });
      });

      if (rows.length === 0) {
        throw new NotFoundException('收藏记录不存在');
      }

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`取消收藏失败 userId=${userId} matchId=${matchId} sportType=${sportType}`, JSON.stringify(error));
      throw error;
    }
  }

  async isFavorited(userId: string, matchId: string, sportType: SportType = 'football'): Promise<boolean> {
    try {
      const rows = await this.db
        .select({ id: favorites.id })
        .from(favorites)
        .where(and(
          eq(favorites.userId, userId),
          eq(favorites.matchId, matchId),
          eq(favorites.sportType, sportType),
        ))
        .limit(1);

      return rows.length > 0;
    } catch (error) {
      this.logger.error(`检查收藏状态失败 userId=${userId} matchId=${matchId} sportType=${sportType}`, JSON.stringify(error));
      throw error;
    }
  }
}
