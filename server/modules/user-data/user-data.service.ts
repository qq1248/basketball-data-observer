import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { userData, predictionRecords, favorites, followedTeams, matches } from '@server/database/schema';
import { eq, count, inArray, or, sql, and } from 'drizzle-orm';

export interface UserDataResponse {
  favorites: any[];
  followedTeams: any[];
  settings: Record<string, any>;
  records: any[];
  updatedAt: string;
}

export interface UserDataUpdate {
  favorites?: any[];
  followedTeams?: any[];
  settings?: Record<string, any>;
  records?: any[];
}

@Injectable()
export class UserDataService {
  private readonly logger = new Logger(UserDataService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getUserData(userId: string): Promise<UserDataResponse> {
    const result = await this.db
      .select()
      .from(userData)
      .where(eq(userData.userId, userId))
      .limit(1);

    const row = result[0];
    if (!row) {
      return {
        favorites: [],
        followedTeams: [],
        settings: {},
        records: [],
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      favorites: row.favorites as any[],
      followedTeams: row.followedTeams as any[],
      settings: row.settings as Record<string, any>,
      records: row.records as any[],
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateUserData(userId: string, data: UserDataUpdate): Promise<UserDataResponse> {
    const now = new Date();

    type UserDataInsert = typeof userData.$inferInsert;
    const insertValues: UserDataInsert = {
      userId,
      favorites: data.favorites ?? [],
      followedTeams: data.followedTeams ?? [],
      settings: data.settings ?? {},
      records: data.records ?? [],
      updatedAt: now,
    };

    type UserDataUpdateSet = Partial<UserDataInsert>;
    const updateSet: UserDataUpdateSet = { updatedAt: now };
    if (data.favorites !== undefined) updateSet.favorites = data.favorites;
    if (data.followedTeams !== undefined) updateSet.followedTeams = data.followedTeams;
    if (data.settings !== undefined) updateSet.settings = data.settings;
    if (data.records !== undefined) updateSet.records = data.records;

    const [result] = await this.db
      .insert(userData)
      .values(insertValues)
      .onConflictDoUpdate({
        target: userData.userId,
        set: updateSet,
      })
      .returning();

    return {
      favorites: result.favorites as any[],
      followedTeams: result.followedTeams as any[],
      settings: result.settings as Record<string, any>,
      records: result.records as any[],
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  async getUserStats(userId: string): Promise<{
    viewed: number;
    favorites: number;
    followedTeams: number;
    hitRate: string;
  }> {
    const [viewedResult, favoritesResult, followedTeamsResult] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(predictionRecords)
        .where(and(
          eq(predictionRecords.userId, userId),
          eq(predictionRecords.actionType, 'viewed'),
        )),
      this.db
        .select({ count: count() })
        .from(favorites)
        .where(eq(favorites.userId, userId)),
      this.db
        .select({ count: count() })
        .from(followedTeams)
        .where(eq(followedTeams.userId, userId)),
    ]);

    const viewed = Number(viewedResult[0]?.count ?? 0);
    const favoritesCount = Number(favoritesResult[0]?.count ?? 0);
    const followedTeamsCount = Number(followedTeamsResult[0]?.count ?? 0);

    // 计算命中率：收藏的比赛 + 关注球队的比赛，合并去重
    const [favMatchRows, followedTeamRows] = await Promise.all([
      this.db
        .select({ matchId: favorites.matchId })
        .from(favorites)
        .where(eq(favorites.userId, userId)),
      this.db
        .select({ teamName: followedTeams.teamName })
        .from(followedTeams)
        .where(eq(followedTeams.userId, userId)),
    ]);

    const favMatchIds: string[] = favMatchRows.map((r) => r.matchId);
    const followedTeamNames: string[] = followedTeamRows.map((r) => r.teamName);

    let finishedCount = 0;
    let hitCount = 0;

    // 从收藏比赛中统计
    if (favMatchIds.length > 0) {
      const favFinished = await this.db
        .select({
          id: matches.id,
          hitWdw: matches.hitWdw,
        })
        .from(matches)
        .where(and(
          inArray(matches.id, favMatchIds),
          eq(matches.matchStatus, 'finished'),
        ));
      for (const m of favFinished) {
        finishedCount += 1;
        if (m.hitWdw) hitCount += 1;
      }
    }

    // 从关注球队的比赛中统计（去重：排除已在收藏中的比赛）
    if (followedTeamNames.length > 0) {
      const teamFinished = await this.db
        .select({
          id: matches.id,
          hitWdw: matches.hitWdw,
        })
        .from(matches)
        .where(and(
          eq(matches.matchStatus, 'finished'),
          or(
            ...followedTeamNames.map((name) => eq(matches.homeTeam, name)),
            ...followedTeamNames.map((name) => eq(matches.awayTeam, name)),
          ),
        ));
      const favSet = new Set(favMatchIds);
      for (const m of teamFinished) {
        if (favSet.has(m.id)) continue;
        finishedCount += 1;
        if (m.hitWdw) hitCount += 1;
      }
    }

    const hitRate = finishedCount === 0
      ? '0%'
      : `${((hitCount / finishedCount) * 100).toFixed(1)}%`;

    return {
      viewed,
      favorites: favoritesCount,
      followedTeams: followedTeamsCount,
      hitRate,
    };
  }
}
