import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { injuries, matches, injuryReports } from '@server/database/schema';
import { eq, and, asc, desc, sql, ilike, count } from 'drizzle-orm';
import type { InjuryItem, MatchInjuriesResponse } from '@shared/api.interface';

@Injectable()
export class InjuriesService {
  private readonly logger = new Logger(InjuriesService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private toInjuryItem(row: typeof injuries.$inferSelect): InjuryItem {
    return {
      id: row.id,
      teamId: row.teamId ?? undefined,
      teamName: row.teamName,
      playerName: row.playerName,
      position: row.position ?? '',
      injuryType: row.injuryType ?? '',
      impactLevel: (row.impactLevel ?? 'medium') as InjuryItem['impactLevel'],
      expectedReturn: row.expectedReturn ? String(row.expectedReturn) : undefined,
      status: row.status ?? 'out',
    };
  }

  async getByMatch(matchId: string): Promise<MatchInjuriesResponse> {
    try {
      const matchRows = await this.db
        .select({
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
        })
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);

      if (matchRows.length === 0) {
        throw new NotFoundException('比赛不存在');
      }

      const { homeTeam, awayTeam } = matchRows[0];

      const reportRows = await this.db
        .select()
        .from(injuryReports)
        .where(and(eq(injuryReports.matchId, matchId), eq(injuryReports.sport, 'football')))
        .orderBy(
          sql`CASE ${injuryReports.impactRating} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`,
          asc(injuryReports.teamSide),
          asc(injuryReports.playerName),
        );

      if (reportRows.length > 0) {
        const sources = Array.from(new Set(reportRows.map((r) => r.dataSource).filter(Boolean) as string[]));
        const home: InjuryItem[] = reportRows
          .filter((r) => r.teamSide === 'home')
          .map((r) => ({
            id: r.id,
            teamId: undefined,
            teamName: r.teamName,
            playerName: r.playerName,
            position: r.position ?? '',
            injuryType: r.injuryType ?? '',
            impactLevel: (r.impactRating === 'high' || r.impactRating === 'medium' || r.impactRating === 'low')
              ? r.impactRating
              : 'medium',
            expectedReturn: r.injuryDate ? String(r.injuryDate).slice(0, 10) : undefined,
            status: r.status ?? 'out',
          }));
        const away: InjuryItem[] = reportRows
          .filter((r) => r.teamSide === 'away')
          .map((r) => ({
            id: r.id,
            teamId: undefined,
            teamName: r.teamName,
            playerName: r.playerName,
            position: r.position ?? '',
            injuryType: r.injuryType ?? '',
            impactLevel: (r.impactRating === 'high' || r.impactRating === 'medium' || r.impactRating === 'low')
              ? r.impactRating
              : 'medium',
            expectedReturn: r.injuryDate ? String(r.injuryDate).slice(0, 10) : undefined,
            status: r.status ?? 'out',
          }));
        return { home, away, dataSources: sources };
      }

      const allRows = await this.db
        .select()
        .from(injuries)
        .where(and(
          eq(injuries.status, 'out'),
        ))
        .orderBy(asc(injuries.playerName));

      const home: InjuryItem[] = allRows
        .filter((row: typeof injuries.$inferSelect) => row.teamName === homeTeam)
        .map((row: typeof injuries.$inferSelect) => this.toInjuryItem(row));

      const away: InjuryItem[] = allRows
        .filter((row: typeof injuries.$inferSelect) => row.teamName === awayTeam)
        .map((row: typeof injuries.$inferSelect) => this.toInjuryItem(row));

      return { home, away };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`获取比赛伤停失败 matchId=${matchId}`, JSON.stringify(error));
      throw error;
    }
  }

  async getList(params: {
    teamName?: string;
    impactLevel?: string;
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: InjuryItem[]; total: number; page: number; pageSize: number }> {
    try {
      const { teamName, impactLevel, status: statusFilter, page, pageSize } = params;

      const conditions = [];
      if (teamName) conditions.push(ilike(injuries.teamName, `%${teamName}%`));
      if (impactLevel) conditions.push(eq(injuries.impactLevel, impactLevel));
      if (statusFilter) conditions.push(eq(injuries.status, statusFilter));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const countResult = await this.db
        .select({ total: count() })
        .from(injuries)
        .where(whereClause);
      const total: number = Number(countResult[0]?.total ?? 0);

      const rows = await this.db
        .select()
        .from(injuries)
        .where(whereClause)
        .orderBy(
          sql`CASE ${injuries.impactLevel} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`,
          asc(injuries.teamName),
          asc(injuries.playerName),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const items: InjuryItem[] = rows.map((row: typeof injuries.$inferSelect) =>
        this.toInjuryItem(row),
      );

      return { items, total, page, pageSize };
    } catch (error) {
      this.logger.error('获取伤停列表失败', JSON.stringify(error));
      throw error;
    }
  }

  async getByTeam(teamId: string): Promise<{ items: InjuryItem[] }> {
    try {
      const rows = await this.db
        .select()
        .from(injuries)
        .where(eq(injuries.teamId, teamId))
        .orderBy(asc(injuries.playerName));

      const items: InjuryItem[] = rows
        .map((row: typeof injuries.$inferSelect) => this.toInjuryItem(row));

      return { items };
    } catch (error) {
      this.logger.error(`获取球队伤停失败 teamId=${teamId}`, JSON.stringify(error));
      throw error;
    }
  }
}
