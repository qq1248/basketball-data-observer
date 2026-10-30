import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, asc, sql, inArray } from 'drizzle-orm';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';

import { EloService } from './elo.service';
import {
  teamsElo,
  matches,
  basketballMatches,
} from '@server/database/schema';

/**
 * Elo 历史回算服务
 *
 * 从 matches / basketball_matches 历史完赛数据滚动计算 Elo，
 * 按联赛隔离评分，批量处理以保证内存效率与一致性。
 *
 * 处理流程：
 * 1. 按 kickoff_time 升序批量读取完赛数据（每批 100 场）
 * 2. 收集本批所有球队，用 OR 条件批量查询当前 Elo（内存缓存跨批累积）
 * 3. 顺序处理每场比赛，滚动更新内存中的球队评分
 * 4. 事务内批量写回 teams_elo 表（upsert）+ 比赛表 elo 字段
 */

// ---- 常量配置 ----

/** 每批处理的比赛数量 */
const BATCH_SIZE: number = 100;

/** 足球默认 K 值 */
const FOOTBALL_K_FACTOR: number = 32;

/** 篮球默认 K 值 */
const BASKETBALL_K_FACTOR: number = 32;

/** 足球默认初始评分 */
const FOOTBALL_INITIAL_RATING: number = 1500;

/** 篮球默认初始评分 */
const BASKETBALL_INITIAL_RATING: number = 1500;

const LEAGUE_ALIAS_MAP: Record<string, string> = {
  '欧联': '欧罗巴',
  '欧协联': '欧协联',
  '解放者杯': '解放者杯',
  '阿甲': '阿甲',
  '英甲': '英甲',
  '日职': '日职联',
  '日乙': '日职乙',
  '韩职': 'K联赛',
  '德甲': '德甲',
  '英超': '英超',
  '西甲': '西甲',
  '意甲': '意甲',
  '法甲': '法甲',
};

const TEAM_ALIAS_MAP: Record<string, string> = {
  '拉普体操': '体操队',
  '拉普大学': '拉普拉塔大学生',
  '安德莱赫': '安德莱赫特',
  '贝西克塔': '贝西克塔斯',
  '比亚韦': '比亚韦斯托克',
  '萨迪纳摩': '萨格勒布迪纳摩',
  '费伦茨瓦': '费伦茨瓦罗斯',
  'OFI克里': 'OFI克里特',
  '奥林匹亚': '奥林匹亚科斯',
  '曼斯菲德': '曼斯菲尔德',
  '帕佛斯': '帕福斯',
  '亚布洛': '亚布洛内茨',
  '格风暴': '格拉茨风暴',
  '索列夫': '索非亚列夫斯基',
  '亚拉腊': '亚拉腊山',
  '比尔森': '比尔森胜利',
  '飓风': '飓风队',
};

// ---- 内部类型 ----

interface MatchRow {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  league: string;
  isOfficialLocked: boolean;
}

interface TeamEloEntry {
  id: string;
  rating: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  initialRating: number;
  kFactor: number;
  homeAdvantage: number;
}

interface TeamEloMap {
  [key: string]: TeamEloEntry;
}

interface MatchEloUpdate {
  id: string;
  eloHome: number;
  eloAway: number;
  eloGap: number;
}

interface BatchResult {
  processed: number;
  teamsCount: number;
}

@Injectable()
export class EloHistoryService {
  private readonly logger: Logger = new Logger(EloHistoryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly eloService: EloService,
  ) {}

  /**
   * 批量查询指定球队的当前 Elo 评分
   * 返回 Map，key = teamName（不按联赛隔离，解决联赛名不一致问题）
   * 同一球队名有多个联赛评分时取 matchesPlayed 最多的那个
   */
  async getTeamRatings(
    sport: 'football' | 'basketball',
    teams: Array<{ teamName: string }>,
  ): Promise<Map<string, { rating: number; matchesPlayed: number }>> {
    const result = new Map<string, { rating: number; matchesPlayed: number }>();
    if (teams.length === 0) return result;

    const uniqueNames = Array.from(new Set(teams.map((t) => t.teamName)));
    const BATCH = 200;

    for (let i = 0; i < uniqueNames.length; i += BATCH) {
      const batch = uniqueNames.slice(i, i + BATCH);
      const rows = await this.db
        .select({
          teamName: teamsElo.teamName,
          eloRating: teamsElo.eloRating,
          matchesPlayed: teamsElo.matchesPlayed,
        })
        .from(teamsElo)
        .where(
          and(
            eq(teamsElo.sport, sport),
            inArray(teamsElo.teamName, batch),
          ),
        );

      for (const row of rows) {
        const name = row.teamName;
        const mp = Number(row.matchesPlayed);
        const existing = result.get(name);
        if (!existing || mp > existing.matchesPlayed) {
          result.set(name, {
            rating: Number(row.eloRating),
            matchesPlayed: mp,
          });
        }
      }
    }

    return result;
  }

  /**
   * 足球历史回算
   * 按 kickoff_time 升序读取所有 match_status='finished' 的足球比赛，
   * 按联赛隔离评分，批量处理并写回 teams_elo 表和 matches 表的 elo 列。
   */
  async backfillFootballElo(): Promise<BatchResult> {
    const homeAdvantage: number =
      this.eloService.getDefaultHomeAdvantage('football');
    const kFactor: number = FOOTBALL_K_FACTOR;
    const initialRating: number = FOOTBALL_INITIAL_RATING;
    const teamRatings: TeamEloMap = {};
    let offset: number = 0;
    let totalProcessed: number = 0;

    while (true) {
      const batch: MatchRow[] = await this.fetchFootballMatchBatch(
        offset,
        BATCH_SIZE,
      );
      if (batch.length === 0) break;
      offset += batch.length;

      await this.loadBatchTeamsIfMissing(
        batch,
        'football',
        teamRatings,
        homeAdvantage,
        kFactor,
        initialRating,
      );

      await this.processFootballBatch(
        batch,
        teamRatings,
        homeAdvantage,
        kFactor,
        initialRating,
      );

      totalProcessed += batch.length;
      this.logger.log(
        `[football] 已处理 ${totalProcessed} 场比赛，` +
          `当前球队数：${Object.keys(teamRatings).length}`,
      );
    }

    return {
      processed: totalProcessed,
      teamsCount: Object.keys(teamRatings).length,
    };
  }

  /**
   * 篮球历史回算
   * 按 kickoff_time 升序读取所有 match_status='finished' 的篮球比赛，
   * 按联赛隔离评分，批量处理并写回 teams_elo 表和 basketball_matches 表的 elo 列。
   */
  async backfillBasketballElo(): Promise<BatchResult> {
    const homeAdvantage: number =
      this.eloService.getDefaultHomeAdvantage('basketball');
    const kFactor: number = BASKETBALL_K_FACTOR;
    const initialRating: number = BASKETBALL_INITIAL_RATING;
    const teamRatings: TeamEloMap = {};
    let offset: number = 0;
    let totalProcessed: number = 0;

    while (true) {
      const batch: MatchRow[] = await this.fetchBasketballMatchBatch(
        offset,
        BATCH_SIZE,
      );
      if (batch.length === 0) break;
      offset += batch.length;

      await this.loadBatchTeamsIfMissing(
        batch,
        'basketball',
        teamRatings,
        homeAdvantage,
        kFactor,
        initialRating,
      );

      await this.processBasketballBatch(
        batch,
        teamRatings,
        homeAdvantage,
        kFactor,
        initialRating,
      );

      totalProcessed += batch.length;
      this.logger.log(
        `[basketball] 已处理 ${totalProcessed} 场比赛，` +
          `当前球队数：${Object.keys(teamRatings).length}`,
      );
    }

    return {
      processed: totalProcessed,
      teamsCount: Object.keys(teamRatings).length,
    };
  }

  // ---- 足球表操作 ----

  private async fetchFootballMatchBatch(
    offset: number,
    limit: number,
  ): Promise<MatchRow[]> {
    const rows = await this.db
      .select({
        id: matches.id,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        league: matches.league,
        isOfficialLocked: matches.isOfficialLocked,
      })
      .from(matches)
      .where(eq(matches.matchStatus, 'finished'))
      .orderBy(asc(matches.kickoffTime))
      .limit(limit)
      .offset(offset);
    return rows;
  }

  private async processFootballBatch(
    batch: MatchRow[],
    teamRatings: TeamEloMap,
    homeAdvantage: number,
    kFactor: number,
    initialRating: number,
  ): Promise<void> {
    const { matchUpdates, teamKeysInBatch } = this.calculateBatchInMemory(
      batch,
      teamRatings,
      'football',
      homeAdvantage,
      kFactor,
      initialRating,
    );

    await this.db.transaction(async (tx) => {
      // 1. 批量 upsert 球队 Elo
      const teamUpsertValues = this.buildTeamUpsertValues(
        teamKeysInBatch,
        teamRatings,
        'football',
      );
      if (teamUpsertValues.length > 0) {
        await tx
          .insert(teamsElo)
          .values(teamUpsertValues)
          .onConflictDoUpdate({
            target: [teamsElo.teamName, teamsElo.sport, teamsElo.league],
            set: {
              eloRating: sql`EXCLUDED.elo_rating`,
              matchesPlayed: sql`EXCLUDED.matches_played`,
              wins: sql`EXCLUDED.wins`,
              draws: sql`EXCLUDED.draws`,
              losses: sql`EXCLUDED.losses`,
              goalsFor: sql`EXCLUDED.goals_for`,
              goalsAgainst: sql`EXCLUDED.goals_against`,
            },
          });
      }

      // 2. 更新比赛表 elo 字段
      for (const update of matchUpdates) {
        await tx
          .update(matches)
          .set({
            eloHome: String(update.eloHome),
            eloAway: String(update.eloAway),
            eloGap: String(update.eloGap),
          })
          .where(eq(matches.id, update.id));
      }
    });
  }

  // ---- 篮球表操作 ----

  private async fetchBasketballMatchBatch(
    offset: number,
    limit: number,
  ): Promise<MatchRow[]> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        league: basketballMatches.league,
        isOfficialLocked: basketballMatches.isOfficialLocked,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.matchStatus, 'finished'))
      .orderBy(asc(basketballMatches.kickoffTime))
      .limit(limit)
      .offset(offset);
    return rows;
  }

  private async processBasketballBatch(
    batch: MatchRow[],
    teamRatings: TeamEloMap,
    homeAdvantage: number,
    kFactor: number,
    initialRating: number,
  ): Promise<void> {
    const { matchUpdates, teamKeysInBatch } = this.calculateBatchInMemory(
      batch,
      teamRatings,
      'basketball',
      homeAdvantage,
      kFactor,
      initialRating,
    );

    await this.db.transaction(async (tx) => {
      // 1. 批量 upsert 球队 Elo
      const teamUpsertValues = this.buildTeamUpsertValues(
        teamKeysInBatch,
        teamRatings,
        'basketball',
      );
      if (teamUpsertValues.length > 0) {
        await tx
          .insert(teamsElo)
          .values(teamUpsertValues)
          .onConflictDoUpdate({
            target: [teamsElo.teamName, teamsElo.sport, teamsElo.league],
            set: {
              eloRating: sql`EXCLUDED.elo_rating`,
              matchesPlayed: sql`EXCLUDED.matches_played`,
              wins: sql`EXCLUDED.wins`,
              draws: sql`EXCLUDED.draws`,
              losses: sql`EXCLUDED.losses`,
              goalsFor: sql`EXCLUDED.goals_for`,
              goalsAgainst: sql`EXCLUDED.goals_against`,
            },
          });
      }

      // 2. 更新比赛表 elo 字段
      for (const update of matchUpdates) {
        await tx
          .update(basketballMatches)
          .set({
            eloHome: String(update.eloHome),
            eloAway: String(update.eloAway),
            eloGap: String(update.eloGap),
          })
          .where(eq(basketballMatches.id, update.id));
      }
    });
  }

  // ---- 通用内存计算（纯逻辑，无 DB 操作） ----

  /**
   * 内存中滚动计算一批比赛的 Elo，返回需要写回 DB 的结果
   */
  private calculateBatchInMemory(
    batch: MatchRow[],
    teamRatings: TeamEloMap,
    sport: 'football' | 'basketball',
    homeAdvantage: number,
    kFactor: number,
    initialRating: number,
  ): {
    matchUpdates: MatchEloUpdate[];
    teamKeysInBatch: Set<string>;
  } {
    const matchUpdates: MatchEloUpdate[] = [];
    const teamKeysInBatch: Set<string> = new Set();

    for (const match of batch) {
      const homeName: string = match.homeTeam ?? '';
      const awayName: string = match.awayTeam ?? '';
      if (!homeName || !awayName) continue;

      const homeKey: string = this.teamKey(homeName, match.league);
      const awayKey: string = this.teamKey(awayName, match.league);
      const homeScore: number = match.homeScore ?? 0;
      const awayScore: number = match.awayScore ?? 0;

      teamKeysInBatch.add(homeKey);
      teamKeysInBatch.add(awayKey);

      const homeTeam: TeamEloEntry = this.getOrInitTeam(
        homeKey,
        teamRatings,
        initialRating,
        kFactor,
        homeAdvantage,
      );
      const awayTeam: TeamEloEntry = this.getOrInitTeam(
        awayKey,
        teamRatings,
        initialRating,
        kFactor,
        homeAdvantage,
      );

      // 赛前 Elo（写入比赛表）
      const preHomeRating: number = homeTeam.rating;
      const preAwayRating: number = awayTeam.rating;
      const eloGap: number = preHomeRating + homeAdvantage - preAwayRating;

      // 计算更新
      const updated = this.eloService.updateRatings(
        preHomeRating,
        preAwayRating,
        homeScore,
        awayScore,
        kFactor,
        homeAdvantage,
        sport,
      );

      // 更新内存评分
      homeTeam.rating = updated.newHomeRating;
      awayTeam.rating = updated.newAwayRating;
      homeTeam.matchesPlayed += 1;
      awayTeam.matchesPlayed += 1;
      homeTeam.goalsFor += homeScore;
      homeTeam.goalsAgainst += awayScore;
      awayTeam.goalsFor += awayScore;
      awayTeam.goalsAgainst += homeScore;

      if (homeScore > awayScore) {
        homeTeam.wins += 1;
        awayTeam.losses += 1;
      } else if (homeScore === awayScore) {
        homeTeam.draws += 1;
        awayTeam.draws += 1;
      } else {
        homeTeam.losses += 1;
        awayTeam.wins += 1;
      }

      // 官方锁定场次跳过 elo 写入（但仍参与评分滚动）
      if (!match.isOfficialLocked) {
        matchUpdates.push({
          id: match.id,
          eloHome: preHomeRating,
          eloAway: preAwayRating,
          eloGap,
        });
      }
    }

    return { matchUpdates, teamKeysInBatch };
  }

  /**
   * 构造 teams_elo 表的 upsert values 数组
   */
  private buildTeamUpsertValues(
    teamKeysInBatch: Set<string>,
    teamRatings: TeamEloMap,
    sport: 'football' | 'basketball',
  ): Array<typeof teamsElo.$inferInsert> {
    const result: Array<typeof teamsElo.$inferInsert> = [];
    for (const key of teamKeysInBatch) {
      const team: TeamEloEntry | undefined = teamRatings[key];
      if (!team) continue;
      const parts: string[] = this.splitTeamKey(key);
      const teamName: string = parts[0];
      const league: string = parts[1];

      result.push({
        teamName,
        sport,
        league,
        eloRating: String(team.rating),
        initialRating: String(team.initialRating),
        kFactor: team.kFactor,
        homeAdvantage: String(team.homeAdvantage),
        matchesPlayed: team.matchesPlayed,
        wins: team.wins,
        draws: team.draws,
        losses: team.losses,
        goalsFor: team.goalsFor,
        goalsAgainst: team.goalsAgainst,
      });
    }
    return result;
  }

  /**
   * 收集本批出现的所有（球队+联赛）组合，对尚未加载的球队批量查询
   * 使用 OR 条件组合实现 inArray 式批量查找
   */
  private async loadBatchTeamsIfMissing(
    batch: MatchRow[],
    sport: 'football' | 'basketball',
    teamRatings: TeamEloMap,
    defaultHomeAdvantage: number,
    defaultKFactor: number,
    defaultInitialRating: number,
  ): Promise<void> {
    const missingTeams: Array<{ teamName: string; league: string; originalKey: string }> = [];
    const seenKeys: Set<string> = new Set();

    for (const match of batch) {
      const homeName: string = match.homeTeam ?? '';
      const awayName: string = match.awayTeam ?? '';
      if (!homeName || !awayName) continue;

      const homeKey: string = this.teamKey(homeName, match.league);
      const awayKey: string = this.teamKey(awayName, match.league);

      for (const { key, name } of [
        { key: homeKey, name: homeName },
        { key: awayKey, name: awayName },
      ]) {
        if (teamRatings[key]) continue;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        missingTeams.push({ teamName: name, league: match.league, originalKey: key });
      }
    }

    if (missingTeams.length === 0) {
      return;
    }

    const queryCombos = new Set<string>();
    for (const t of missingTeams) {
      const leagueAliases = this.getLeagueAliasVariants(t.league);
      const teamAliases = this.getTeamAliasVariants(t.teamName);
      for (const lg of leagueAliases) {
        for (const tn of teamAliases) {
          queryCombos.add(`${tn}||${lg}`);
        }
      }
    }

    const queryList: Array<{ teamName: string; league: string }> = [];
    for (const combo of queryCombos) {
      const parts = combo.split('||');
      queryList.push({ teamName: parts[0], league: parts[1] });
    }

    const conditions = queryList.map(
      (t) =>
        and(
          eq(teamsElo.teamName, t.teamName),
          eq(teamsElo.sport, sport),
          eq(teamsElo.league, t.league),
        ),
    );

    const existing = await this.db
      .select({
        id: teamsElo.id,
        teamName: teamsElo.teamName,
        league: teamsElo.league,
        eloRating: teamsElo.eloRating,
        matchesPlayed: teamsElo.matchesPlayed,
        wins: teamsElo.wins,
        draws: teamsElo.draws,
        losses: teamsElo.losses,
        goalsFor: teamsElo.goalsFor,
        goalsAgainst: teamsElo.goalsAgainst,
        initialRating: teamsElo.initialRating,
        kFactor: teamsElo.kFactor,
        homeAdvantage: teamsElo.homeAdvantage,
      })
      .from(teamsElo)
      .where(sql`(${sql.join(conditions, sql` OR `)})`);

    const foundByOriginalKey = new Map<string, TeamEloEntry>();
    for (const row of existing) {
      const entry: TeamEloEntry = {
        id: row.id,
        rating: Number(row.eloRating),
        matchesPlayed: row.matchesPlayed,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        initialRating: Number(row.initialRating) || defaultInitialRating,
        kFactor: row.kFactor || defaultKFactor,
        homeAdvantage: Number(row.homeAdvantage) || defaultHomeAdvantage,
      };
      const dbKey = this.teamKey(row.teamName, row.league);
      teamRatings[dbKey] = entry;

      for (const t of missingTeams) {
        if (foundByOriginalKey.has(t.originalKey)) continue;
        const leagueAliases = this.getLeagueAliasVariants(t.league);
        const teamAliases = this.getTeamAliasVariants(t.teamName);
        if (leagueAliases.includes(row.league) && teamAliases.includes(row.teamName)) {
          foundByOriginalKey.set(t.originalKey, entry);
        }
      }
    }

    let aliasMatched: number = 0;
    for (const t of missingTeams) {
      const matched = foundByOriginalKey.get(t.originalKey);
      if (!matched) continue;
      if (!teamRatings[t.originalKey]) {
        teamRatings[t.originalKey] = { ...matched };
        aliasMatched++;
      }
    }

    this.logger.debug(
      `[${sport}] 本批新增查询 ${missingTeams.length} 支球队，` +
        `命中 ${existing.length} 条已有记录（别名补命中 ${aliasMatched}）`,
    );
  }

  private getLeagueAliasVariants(league: string): string[] {
    const variants: string[] = [league];
    const normalized = LEAGUE_ALIAS_MAP[league];
    if (normalized && normalized !== league && !variants.includes(normalized)) {
      variants.push(normalized);
    }
    return variants;
  }

  private getTeamAliasVariants(teamName: string): string[] {
    const variants: string[] = [teamName];
    const alias = TEAM_ALIAS_MAP[teamName];
    if (alias && alias !== teamName && !variants.includes(alias)) {
      variants.push(alias);
    }
    return variants;
  }

  /**
   * 获取或初始化球队 Elo 记录（内存兜底）
   */
  private getOrInitTeam(
    key: string,
    teamRatings: TeamEloMap,
    initialRating: number,
    kFactor: number,
    homeAdvantage: number,
  ): TeamEloEntry {
    if (!teamRatings[key]) {
      teamRatings[key] = {
        id: '', // 新球队，由 upsert 生成 ID
        rating: initialRating,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        initialRating,
        kFactor,
        homeAdvantage,
      };
    }
    return teamRatings[key];
  }

  /**
   * 生成球队唯一键：team_name + league
   * 同一球队在不同联赛视为不同实体
   */
  private teamKey(teamName: string, league: string): string {
    return `${teamName}||${league}`;
  }

  /**
   * 从键中拆分球队名和联赛名
   */
  private splitTeamKey(key: string): string[] {
    const idx: number = key.indexOf('||');
    if (idx === -1) {
      return [key, ''];
    }
    return [key.slice(0, idx), key.slice(idx + 2)];
  }
}
