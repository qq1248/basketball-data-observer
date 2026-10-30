import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { players as playersTable } from '@server/database/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import type { PlayerItem } from '@shared/api.interface';

@Injectable()
export class PlayersService {
  private readonly logger = new Logger(PlayersService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private toPlayerItem(row: typeof playersTable.$inferSelect): PlayerItem {
    return {
      id: row.id,
      name: row.name,
      team: row.team,
      position: row.position,
      nationality: row.nationality ?? undefined,
      age: row.age ?? undefined,
      rating: Number(row.rating),
      goals: row.goals,
      assists: row.assists,
      appearances: row.appearances,
      injuryStatus: row.injuryStatus,
      recentRatings: (row.recentRatings as unknown as number[]) ?? [],
    };
  }

  async getByTeam(teamName: string): Promise<PlayerItem[]> {
    try {
      const rows = await this.db
        .select()
        .from(playersTable)
        .where(eq(playersTable.team, teamName))
        .orderBy(desc(playersTable.rating));

      return rows.map((row: typeof playersTable.$inferSelect) => this.toPlayerItem(row));
    } catch (error) {
      this.logger.error(`按球队查询球员失败 teamName=${teamName}`, JSON.stringify(error));
      throw error;
    }
  }

  async getById(id: string): Promise<PlayerItem> {
    try {
      const rows = await this.db
        .select()
        .from(playersTable)
        .where(eq(playersTable.id, id))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundException('球员不存在');
      }

      return this.toPlayerItem(rows[0]);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`查询球员详情失败 id=${id}`, JSON.stringify(error));
      throw error;
    }
  }

  async getKeyPlayers(
    homeTeam: string,
    awayTeam: string,
  ): Promise<{ home: PlayerItem[]; away: PlayerItem[] }> {
    try {
      const allPlayers = await this.db
        .select()
        .from(playersTable)
        .where(inArray(playersTable.team, [homeTeam, awayTeam]))
        .orderBy(desc(playersTable.rating));

      const home: PlayerItem[] = [];
      const away: PlayerItem[] = [];

      for (const row of allPlayers) {
        if (row.team === homeTeam && home.length < 3) {
          home.push(this.toPlayerItem(row));
        } else if (row.team === awayTeam && away.length < 3) {
          away.push(this.toPlayerItem(row));
        }
        if (home.length === 3 && away.length === 3) break;
      }

      return { home, away };
    } catch (error) {
      this.logger.error(
        `查询关键球员失败 homeTeam=${homeTeam} awayTeam=${awayTeam}`,
        JSON.stringify(error),
      );
      throw error;
    }
  }
}
