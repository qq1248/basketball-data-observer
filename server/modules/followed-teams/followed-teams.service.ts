import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { followedTeams } from '@server/database/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type {
  FollowedTeamItem,
  FollowedTeamListResponse,
} from '@shared/api.interface';

@Injectable()
export class FollowedTeamsService {
  private readonly logger = new Logger(FollowedTeamsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private toItem(row: typeof followedTeams.$inferSelect): FollowedTeamItem {
    return {
      id: row.id,
      teamName: row.teamName,
      teamLogo: row.teamLogo ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getList(userId: string): Promise<FollowedTeamListResponse> {
    try {
      const rows: (typeof followedTeams.$inferSelect)[] = await this.db
        .select()
        .from(followedTeams)
        .where(eq(followedTeams.userId, userId))
        .orderBy(desc(followedTeams.createdAt));

      const items: FollowedTeamItem[] = rows.map(
        (row: typeof followedTeams.$inferSelect) => this.toItem(row),
      );

      return { items };
    } catch (error) {
      this.logger.error(`获取关注球队列表失败 userId=${userId}`, JSON.stringify(error));
      throw error;
    }
  }

  async add(userId: string, teamName: string, teamLogo?: string): Promise<FollowedTeamItem> {
    try {
      const logoSql = teamLogo !== undefined ? sql`, ${teamLogo}` : sql`, NULL`;
      const result = await this.db.execute(sql`
        INSERT INTO ${followedTeams} (user_id, team_name, team_logo)
        VALUES (ROW(${userId})::user_profile, ${teamName}${logoSql})
        ON CONFLICT ((user_id).user_id, team_name) DO NOTHING
        RETURNING id, user_id, team_name, team_logo, _created_at
      `);

      let row: typeof followedTeams.$inferSelect;
      if (result.length > 0) {
        const raw = result[0] as Record<string, unknown>;
        row = {
          id: raw.id as string,
          userId: raw.user_id as string,
          teamName: raw.team_name as string,
          teamLogo: raw.team_logo as string | null,
          createdAt: new Date(raw._created_at as string),
        };
      } else {
        const existing: (typeof followedTeams.$inferSelect)[] = await this.db
          .select()
          .from(followedTeams)
          .where(and(
            eq(followedTeams.userId, userId),
            eq(followedTeams.teamName, teamName),
          ))
          .limit(1);
        row = existing[0];
      }

      return this.toItem(row);
    } catch (error) {
      this.logger.error(
        `添加关注球队失败 userId=${userId} teamName=${teamName}`,
        JSON.stringify(error),
      );
      throw error;
    }
  }

  async remove(userId: string, teamName: string): Promise<{ success: boolean }> {
    try {
      const rows: { id: string }[] = await this.db
        .delete(followedTeams)
        .where(and(
          eq(followedTeams.userId, userId),
          eq(followedTeams.teamName, teamName),
        ))
        .returning({ id: followedTeams.id });

      if (rows.length === 0) {
        throw new NotFoundException('关注记录不存在');
      }

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        `取消关注球队失败 userId=${userId} teamName=${teamName}`,
        JSON.stringify(error),
      );
      throw error;
    }
  }

  async isFollowed(userId: string, teamName: string): Promise<boolean> {
    try {
      const rows: (typeof followedTeams.$inferSelect)[] = await this.db
        .select()
        .from(followedTeams)
        .where(and(
          eq(followedTeams.userId, userId),
          eq(followedTeams.teamName, teamName),
        ))
        .limit(1);

      return rows.length > 0;
    } catch (error) {
      this.logger.error(
        `检查关注状态失败 userId=${userId} teamName=${teamName}`,
        JSON.stringify(error),
      );
      throw error;
    }
  }
}
