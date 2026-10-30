import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { teams, matches, basketballMatches } from '@server/database/schema';
import { eq, and, ilike, asc, count, sql, desc, or } from 'drizzle-orm';
import type {
  TeamItem,
  TeamSearchResponse,
  TeamProfileResponse,
  TeamFormRecord,
  H2HRecord,
  TeamHomeAwayStats,
} from '@shared/api.interface';

interface SearchParams {
  keyword?: string;
  league?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private toTeamItem(row: typeof teams.$inferSelect): TeamItem {
    return {
      id: row.id,
      name: row.name,
      league: row.league,
      foundedYear: row.foundedYear ?? undefined,
      stadium: row.stadium ?? '',
      capacity: row.capacity ?? 0,
      rank: row.rank ?? 0,
      homeRecord: row.homeRecord ?? '',
      awayRecord: row.awayRecord ?? '',
      avgGoalsFor: Number(row.avgGoalsFor),
      avgGoalsAgainst: Number(row.avgGoalsAgainst),
      tacticSystem: row.tacticSystem ?? '',
      corePlayers: row.corePlayers,
      recentForm: row.recentForm,
      description: row.description,
      logoUrl: row.logoUrl ?? '',
    };
  }

  async search(params: SearchParams): Promise<TeamSearchResponse> {
    const { keyword, league, page, pageSize } = params;
    try {
      const conditions = [];
      if (keyword) {
        conditions.push(ilike(teams.name, `%${keyword}%`));
      }
      if (league) {
        conditions.push(ilike(teams.league, `%${league}%`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const countResult = await this.db
        .select({ count: count() })
        .from(teams)
        .where(whereClause);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await this.db
        .select()
        .from(teams)
        .where(whereClause)
        .orderBy(asc(teams.name))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const items: TeamItem[] = rows.map((row: typeof teams.$inferSelect) => this.toTeamItem(row));
      return { items, total };
    } catch (error) {
      this.logger.error(`搜索球队失败 keyword=${keyword}`, JSON.stringify(error));
      throw error;
    }
  }

  async getById(id: string): Promise<{ team: TeamItem }> {
    try {
      const rows = await this.db
        .select()
        .from(teams)
        .where(eq(teams.id, id))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundException('球队不存在');
      }

      return { team: this.toTeamItem(rows[0]) };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`获取球队详情失败 id=${id}`, JSON.stringify(error));
      throw error;
    }
  }

  async getByName(name: string): Promise<{ team: TeamItem }> {
    try {
      const rows = await this.db
        .select()
        .from(teams)
        .where(eq(teams.name, name))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundException('球队不存在');
      }

      return { team: this.toTeamItem(rows[0]) };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`按名称查询球队失败 name=${name}`, JSON.stringify(error));
      throw error;
    }
  }

  async getTeamProfile(
    teamName: string,
    sport: 'football' | 'basketball',
    opponent?: string,
  ): Promise<TeamProfileResponse> {
    const table = sport === 'football' ? matches : basketballMatches;
    const finishedStatus = 'finished';
    const teamNameDecoded = decodeURIComponent(teamName);

    // ===== Recent 10 matches =====
    const recentRows = await this.db
      .select({
        homeTeam: table.homeTeam,
        awayTeam: table.awayTeam,
        homeScore: table.homeScore,
        awayScore: table.awayScore,
        kickoffTime: table.kickoffTime,
        matchDate: table.matchDate,
        league: table.league,
      })
      .from(table)
      .where(and(
        eq(table.matchStatus, finishedStatus),
        or(
          eq(table.homeTeam, teamNameDecoded),
          eq(table.awayTeam, teamNameDecoded),
        ),
      ))
      .orderBy(desc(table.kickoffTime))
      .limit(10);

    const recentMatches: TeamFormRecord[] = recentRows.map((row) => {
      const isHome = row.homeTeam === teamNameDecoded;
      const scoreFor = isHome ? (row.homeScore ?? 0) : (row.awayScore ?? 0);
      const scoreAgainst = isHome ? (row.awayScore ?? 0) : (row.homeScore ?? 0);
      let result: 'win' | 'draw' | 'loss';
      if (scoreFor > scoreAgainst) {
        result = 'win';
      } else if (scoreFor < scoreAgainst) {
        result = 'loss';
      } else {
        result = sport === 'football' ? 'draw' : 'loss';
      }
      const dateStr = row.kickoffTime instanceof Date
        ? row.kickoffTime.toISOString().slice(0, 10)
        : String(row.matchDate);
      return {
        date: dateStr,
        opponent: isHome ? row.awayTeam : row.homeTeam,
        isHome,
        result,
        scoreFor: Number(scoreFor),
        scoreAgainst: Number(scoreAgainst),
        league: row.league,
      };
    });

    const recentCount = recentMatches.length;

    // ===== Home/Away stats =====
    const homeRow = await this.db
      .select({
        total: sql<number>`count(*)`,
        wins: sql<number>`count(*) filter (where ${table.homeScore} > ${table.awayScore})`,
      })
      .from(table)
      .where(and(
        eq(table.matchStatus, finishedStatus),
        eq(table.homeTeam, teamNameDecoded),
      ));

    const awayRow = await this.db
      .select({
        total: sql<number>`count(*)`,
        wins: sql<number>`count(*) filter (where ${table.awayScore} > ${table.homeScore})`,
      })
      .from(table)
      .where(and(
        eq(table.matchStatus, finishedStatus),
        eq(table.awayTeam, teamNameDecoded),
      ));

    const homeTotal = Number(homeRow[0]?.total ?? 0);
    const homeWins = Number(homeRow[0]?.wins ?? 0);
    const awayTotal = Number(awayRow[0]?.total ?? 0);
    const awayWins = Number(awayRow[0]?.wins ?? 0);

    const totalAll = homeTotal + awayTotal;
    const homeAwayStats: TeamHomeAwayStats = {
      homeWinRate: homeTotal > 0 ? Math.round((homeWins / homeTotal) * 100) : 0,
      homeTotal,
      awayWinRate: awayTotal > 0 ? Math.round((awayWins / awayTotal) * 100) : 0,
      awayTotal,
      sampleSufficient: totalAll >= 20,
    };

    // ===== H2H =====
    let h2h: H2HRecord[] = [];
    let h2hCount = 0;
    if (opponent && opponent.trim().length > 0) {
      const opponentDecoded = decodeURIComponent(opponent);
      const h2hRows = await this.db
        .select({
          homeTeam: table.homeTeam,
          awayTeam: table.awayTeam,
          homeScore: table.homeScore,
          awayScore: table.awayScore,
          kickoffTime: table.kickoffTime,
          matchDate: table.matchDate,
          league: table.league,
          matchStatus: table.matchStatus,
        })
        .from(table)
        .where(and(
          eq(table.matchStatus, finishedStatus),
          or(
            and(eq(table.homeTeam, teamNameDecoded), eq(table.awayTeam, opponentDecoded)),
            and(eq(table.homeTeam, opponentDecoded), eq(table.awayTeam, teamNameDecoded)),
          ),
        ))
        .orderBy(desc(table.kickoffTime))
        .limit(10);

      h2h = h2hRows.map((row) => ({
        date: row.kickoffTime instanceof Date
          ? row.kickoffTime.toISOString().slice(0, 10)
          : String(row.matchDate),
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeScore: row.homeScore != null ? Number(row.homeScore) : null,
        awayScore: row.awayScore != null ? Number(row.awayScore) : null,
        league: row.league,
        matchStatus: row.matchStatus,
      }));
      h2hCount = h2h.length;
    }

    return {
      teamName: teamNameDecoded,
      sport,
      recentMatches,
      recentCount,
      homeAwayStats,
      h2h,
      h2hCount,
      hasData: recentCount > 0,
      updatedAt: new Date().toISOString(),
    };
  }
}
