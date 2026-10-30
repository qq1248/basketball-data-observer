import { eq, and, inArray, sql, like, desc, isNotNull, lt, gte, type SQL, count } from 'drizzle-orm';
import { basketballMatches } from '../../database/schema';
import { teamsElo } from '../../database/schema';
import { injuryReports } from '../../database/schema';
import { teamSeasonStats } from '../../database/schema';
import { normalizeBasketballTeamName } from '../sporttery/team-mappings';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface DataDrivenPrediction {
  matchId: string;
  matchNo: string;
  league: string;
  leagueKey: string;
  baselineTotal: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  isOfficialLocked: boolean;
  dataQuality: 'high' | 'medium' | 'low';
  missingData: string[];
  eloHome: number | null;
  eloAway: number | null;
  eloMatchesHome: number;
  eloMatchesAway: number;
  homePpg: number | null;
  awayPpg: number | null;
  homeOppg: number | null;
  awayOppg: number | null;
  coreInjuriesHome: number;
  coreInjuriesAway: number;
  h2h: H2hGameDetail[] | null;
  modelExpectedSpread: number;
  modelExpectedTotal: number;
  handicapLineNum: number;
  totalLineNum: number;
  handicapCoverProb: number;
  handicapRecommendation: string;
  handicapConfidence: '高' | '中' | '低';
  totalDirection: '大分' | '小分' | '观望' | '待线值';
  totalProb: number;
  totalConfidence: '高' | '中' | '低';
  computationBasis: string[];
  homeWinProb: number;
  awayWinProb: number;
  confidence: number;
  lowSampleRisk: boolean;
  predGeneratedAt: string;
  recentFormDetail: { home: RecentGameDetail[]; away: RecentGameDetail[]; computedAt: string } | null;
  recent10Detail?: {
    homePd: number;
    awayPd: number;
    homePpg: number;
    awayPpg: number;
    homeOppg: number;
    awayOppg: number;
    homeCount: number;
    awayCount: number;
  };
  recent20Detail?: {
    homePd: number;
    awayPd: number;
    homePpg: number;
    awayPpg: number;
    homeOppg: number;
    awayOppg: number;
    homeCount: number;
    awayCount: number;
  };
}

export interface LineRecalcInput {
  matchId: string;
  matchNo?: string;
}

export interface LineRecalcOutcome {
  matchId: string;
  matchNo: string;
  before: {
    handicapRecommendation: string | null;
    handicapCoverProb: number | null;
    totalDirection: string | null;
    overProb: number | null;
    confidence: number | null;
    ouConfidence: string | null;
  };
  after: {
    handicapRecommendation: string;
    handicapCoverProb: number;
    totalDirection: string;
    overProb: number;
    confidence: number;
    ouConfidence: string;
  } | null;
  applied: boolean;
  skippedReason: string | null;
  recalcReason: string | null;
}

type ComputationRow = {
  id: string;
  matchNo: string | null;
  league: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  kickoffTime: unknown;
  matchStatus: string | null;
  modelRules: unknown;
  teamStats: unknown;
  injuries: unknown;
  recentForm: unknown;
  recentFormDetail?: unknown;
  handicapLineNum: unknown;
  totalLineNum: unknown;
  homeWinOdds: unknown;
  awayWinOdds: unknown;
  oddsOpenHandicapLine?: string | null;
  oddsOpenTotalLine?: string | null;
};

export interface RecentGameDetail {
  date: string;
  opponent: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
  pointDiff: number;
  result: 'win' | 'loss';
}

export interface H2hGameDetail {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeWin: boolean;
  pointDiff: number;
  league: string | null;
}

@Injectable()
export class BasketballDataDrivenPredictionService {
  private readonly logger = new Logger(BasketballDataDrivenPredictionService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * Append a prediction snapshot to prediction_history JSONB array.
   * Only appends when the patch contains prediction field updates.
   * 数组上限 30 条，超出时丢弃最旧的。
   */
  private appendPredictionHistory(
    patch: Record<string, unknown>,
    trigger: string,
  ): void {
    const hasPredictionUpdate =
      patch.handicapRecommendation !== undefined ||
      patch.totalDirection !== undefined ||
      patch.confidence !== undefined ||
      patch.predEngineVersion !== undefined;
    if (!hasPredictionUpdate) return;

    const handicapProbRaw =
      patch.handicapPickProb !== undefined
        ? patch.handicapPickProb
        : patch.handicapCoverProb;
    const handicapProb = Number(handicapProbRaw) || 0;

    const totalProbRaw =
      patch.totalPickProb !== undefined
        ? patch.totalPickProb
        : Math.max(
            Number(patch.overProb) || 0,
            Number(patch.underProb) || 0,
          );
    const totalProb = Number(totalProbRaw) || 0;

    const snapshot = {
      at: new Date().toISOString(),
      trigger,
      handicapDirection: String(patch.handicapRecommendation ?? ''),
      handicapProb,
      handicapLine: Number(patch.handicapLineNum) || 0,
      totalDirection: String(patch.totalDirection ?? ''),
      totalProb,
      totalLine: Number(patch.totalLineNum) || 0,
      confidence: Number(patch.confidence) || 0,
      engine: String(patch.predEngineVersion ?? 'unknown'),
    };

    const snapshotJson = JSON.stringify(snapshot);
    patch.predictionHistory = sql`
      CASE
        WHEN jsonb_array_length(${basketballMatches.predictionHistory}) >= 30
        THEN (${basketballMatches.predictionHistory} - 0) || ${snapshotJson}::jsonb
        ELSE ${basketballMatches.predictionHistory} || ${snapshotJson}::jsonb
      END
    `;
  }

  private normalCdf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1 + sign * y);
  }

  private leagueKey(league: string): string {
    const name = league || '';
    if (name.includes('WNBA')) return 'WNBA';
    if (name.includes('NBA') || name.includes('美职篮') || name.includes('美国职业篮球')) return 'NBA';
    if (name.includes('欧篮') || name.includes('Euro') || name.includes('欧冠篮') || name.includes('欧洲篮球')) return 'EuroLeague';
    if (name.includes('西篮') || name.includes('ACB') || name.includes('西班牙')) return 'Liga ACB';
    if (name.includes('德篮') || name.includes('BBL') || name.includes('德国')) return 'BBL';
    if (name.includes('澳篮') || name.includes('NBL') || name.includes('澳大利亚') || name.includes('澳NBL')) return 'NBL';
    if (name.includes('日篮') || name.includes('B联') || name.includes('B League') || name.includes('日本')) return 'B.League';
    return 'default';
  }

  private computeInjuryAggregate(
    items: Array<{ teamSide: string; impactRating: string; injuryDate: Date | null }>,
    kickoffTime: Date,
  ): { homeTotal: number; awayTotal: number; homeFresh: number; awayFresh: number } {
    const freshCutoffMs = 21 * 24 * 60 * 60 * 1000;
    let homeTotal = 0;
    let awayTotal = 0;
    let homeFresh = 0;
    let awayFresh = 0;
    for (const it of items) {
      const high = it.impactRating === 'high' ? 1 : 0;
      const med = it.impactRating === 'medium' ? 0.5 : 0;
      const weight = high + med;
      const isFresh = !it.injuryDate
        || (kickoffTime.getTime() - it.injuryDate.getTime() <= freshCutoffMs);
      if (it.teamSide === 'home') {
        homeTotal += weight;
        if (isFresh) homeFresh += weight;
      } else if (it.teamSide === 'away') {
        awayTotal += weight;
        if (isFresh) awayFresh += weight;
      }
    }
    return {
      homeTotal: Math.floor(homeTotal * 2) / 2,
      awayTotal: Math.floor(awayTotal * 2) / 2,
      homeFresh: Math.floor(homeFresh * 2) / 2,
      awayFresh: Math.floor(awayFresh * 2) / 2,
    };
  }

  private getLeagueBaseline(league: string): { total: number; homeAdv: number; spreadSigma: number; totalSigma: number } {
    const name = league || '';
    if (name.includes('NBA') || name.includes('美职篮') || name.includes('美国职业篮球')) {
      return { total: 232, homeAdv: 2.5, spreadSigma: 12, totalSigma: 12.6 };
    }
    if (name.includes('WNBA')) {
      return { total: 166, homeAdv: 2.5, spreadSigma: 10, totalSigma: 10.5 };
    }
    if (name.includes('欧篮') || name.includes('Euro') || name.includes('欧冠篮') || name.includes('欧洲篮球')) {
      return { total: 173, homeAdv: 2.5, spreadSigma: 11, totalSigma: 11.5 };
    }
    if (name.includes('澳NBL') || name.includes('澳大利亚') || name.includes('NBL')) {
      return { total: 188, homeAdv: 3, spreadSigma: 11.5, totalSigma: 12 };
    }
    if (name.includes('CBA') || name.includes('中职篮')) {
      return { total: 195, homeAdv: 3, spreadSigma: 12, totalSigma: 12.5 };
    }
    if (name.includes('西篮') || name.includes('西班牙') || name.includes('ACB') || name.includes('西甲篮')) {
      return { total: 186, homeAdv: 2.5, spreadSigma: 11.5, totalSigma: 12 };
    }
    if (name.includes('德篮') || name.includes('BBL') || name.includes('德国')) {
      return { total: 173, homeAdv: 3, spreadSigma: 11.5, totalSigma: 12 };
    }
    return { total: 170, homeAdv: 2.5, spreadSigma: 11.5, totalSigma: 12 };
  }

  private computeCombinedSigma(
    baseSigma: number,
    sampleHome: number,
    sampleAway: number,
    uncertaintyFactor: number,
  ): number {
    const minSample = Math.max(1, Math.min(sampleHome, sampleAway));
    const totalSample = sampleHome + sampleAway;
    const estimationNoise = uncertaintyFactor * Math.sqrt(2 / Math.max(4, minSample));
    const sampleSizeAdjustment = totalSample < 10 ? 1 + (10 - totalSample) * 0.05 : 1;
    return baseSigma * sampleSizeAdjustment + estimationNoise;
  }

  private estimateTeamStatsFromElo(
    eloRating: number,
    matchesPlayed: number,
    goalsFor: number,
    goalsAgainst: number,
    leagueBaselineTotal: number,
  ): { ppg: number; oppg: number; sampleSize: number } {
    if (matchesPlayed <= 0 || goalsFor <= 0) {
      return { ppg: leagueBaselineTotal / 2, oppg: leagueBaselineTotal / 2, sampleSize: 0 };
    }
    const ppg = goalsFor / matchesPlayed;
    const oppg = goalsAgainst / matchesPlayed;
    return { ppg, oppg, sampleSize: matchesPlayed };
  }

  /**
   * 从库内完赛记录计算球队近期战绩详情（跨联赛）。
   * 同一球队在所有联赛的完赛记录，按开赛时间倒序取前 N 场。
   * 返回 map: teamName -> RecentGameDetail[]
   */
  private async fetchRecentGamesFromDb(
    teamLeaguePairs: Array<{ teamName: string; league: string; beforeTime: Date }>,
    limit: number = 10,
    dbs: PostgresJsDatabase = this.db,
  ): Promise<Map<string, RecentGameDetail[]>> {
    const result = new Map<string, RecentGameDetail[]>();
    if (teamLeaguePairs.length === 0) return result;

    const allRows: Array<{
      teamName: string;
      date: string;
      opponent: string;
      isHome: boolean;
      scoreFor: number;
      scoreAgainst: number;
    }> = [];

    const teamNames = Array.from(new Set(teamLeaguePairs.map((p) => p.teamName).filter(Boolean)));
    for (const teamName of teamNames) {
      result.set(teamName, []);
      const pair = teamLeaguePairs.find((p) => p.teamName === teamName);
      if (!pair) continue;
      const beforeTime = pair.beforeTime;

      const homeGames = await dbs
        .select({
          date: basketballMatches.kickoffTime,
          opponent: basketballMatches.awayTeam,
          scoreFor: basketballMatches.homeScore,
          scoreAgainst: basketballMatches.awayScore,
        })
        .from(basketballMatches)
        .where(
          and(
            eq(basketballMatches.homeTeam, teamName),
            eq(basketballMatches.matchStatus, 'finished'),
            lt(basketballMatches.kickoffTime, beforeTime),
            isNotNull(basketballMatches.homeScore),
            isNotNull(basketballMatches.awayScore),
          ),
        )
        .orderBy(desc(basketballMatches.kickoffTime))
        .limit(limit);

      for (const g of homeGames) {
        const sf = Number(g.scoreFor) || 0;
        const sa = Number(g.scoreAgainst) || 0;
        if (sf <= 0 && sa <= 0) continue;
        allRows.push({
          teamName,
          date: g.date instanceof Date ? g.date.toISOString() : String(g.date),
          opponent: g.opponent || '',
          isHome: true,
          scoreFor: sf,
          scoreAgainst: sa,
        });
      }

      const awayGames = await dbs
        .select({
          date: basketballMatches.kickoffTime,
          opponent: basketballMatches.homeTeam,
          scoreFor: basketballMatches.awayScore,
          scoreAgainst: basketballMatches.homeScore,
        })
        .from(basketballMatches)
        .where(
          and(
            eq(basketballMatches.awayTeam, teamName),
            eq(basketballMatches.matchStatus, 'finished'),
            lt(basketballMatches.kickoffTime, beforeTime),
            isNotNull(basketballMatches.homeScore),
            isNotNull(basketballMatches.awayScore),
          ),
        )
        .orderBy(desc(basketballMatches.kickoffTime))
        .limit(limit);

      for (const g of awayGames) {
        const sf = Number(g.scoreFor) || 0;
        const sa = Number(g.scoreAgainst) || 0;
        if (sf <= 0 && sa <= 0) continue;
        allRows.push({
          teamName,
          date: g.date instanceof Date ? g.date.toISOString() : String(g.date),
          opponent: g.opponent || '',
          isHome: false,
          scoreFor: sf,
          scoreAgainst: sa,
        });
      }

      const exactCount = homeGames.length + awayGames.length;
      if (exactCount < limit) {
        const normTarget = normalizeBasketballTeamName(teamName);
        const keyword = this.extractTeamKeyword(normTarget || teamName);
        if (keyword && keyword.length >= 2) {
          const fuzzyRows = await dbs
            .select({
              date: basketballMatches.kickoffTime,
              homeTeam: basketballMatches.homeTeam,
              awayTeam: basketballMatches.awayTeam,
              homeScore: basketballMatches.homeScore,
              awayScore: basketballMatches.awayScore,
            })
            .from(basketballMatches)
            .where(
              and(
                eq(basketballMatches.matchStatus, 'finished'),
                lt(basketballMatches.kickoffTime, beforeTime),
                isNotNull(basketballMatches.homeScore),
                isNotNull(basketballMatches.awayScore),
                sql`(
                  lower(${basketballMatches.homeTeam}) LIKE ${'%' + keyword.toLowerCase() + '%'}
                  OR lower(${basketballMatches.awayTeam}) LIKE ${'%' + keyword.toLowerCase() + '%'}
                )`,
              ),
            )
            .orderBy(desc(basketballMatches.kickoffTime))
            .limit(limit * 5);

          for (const g of fuzzyRows) {
            const hNorm = normalizeBasketballTeamName(g.homeTeam || '');
            const aNorm = normalizeBasketballTeamName(g.awayTeam || '');
            const isHomeMatch = hNorm === normTarget;
            const isAwayMatch = aNorm === normTarget;
            if (!isHomeMatch && !isAwayMatch) continue;

            const hs = Number(g.homeScore) || 0;
            const as = Number(g.awayScore) || 0;
            if (hs <= 0 && as <= 0) continue;

            const already = allRows.some(
              (r) =>
                r.teamName === teamName &&
                r.date === (g.date instanceof Date ? g.date.toISOString() : String(g.date)) &&
                ((r.isHome && r.opponent === g.awayTeam) || (!r.isHome && r.opponent === g.homeTeam)),
            );
            if (already) continue;

            allRows.push({
              teamName,
              date: g.date instanceof Date ? g.date.toISOString() : String(g.date),
              opponent: isHomeMatch ? (g.awayTeam || '') : (g.homeTeam || ''),
              isHome: isHomeMatch,
              scoreFor: isHomeMatch ? hs : as,
              scoreAgainst: isHomeMatch ? as : hs,
            });
          }
        }
      }
    }

    for (const row of allRows) {
      const key = row.teamName;
      const arr = result.get(key) ?? [];
      arr.push({
        date: row.date,
        opponent: row.opponent,
        isHome: row.isHome,
        scoreFor: row.scoreFor,
        scoreAgainst: row.scoreAgainst,
        pointDiff: row.scoreFor - row.scoreAgainst,
        result: row.scoreFor > row.scoreAgainst ? 'win' : 'loss',
      });
      result.set(key, arr);
    }

    for (const [key, games] of result.entries()) {
      games.sort((a: RecentGameDetail, b: RecentGameDetail) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      result.set(key, games.slice(0, limit));
    }

    return result;
  }

  /**
   * 从队名中提取用于模糊匹配的核心关键词（城市名/主体名）。
   * 去除常见后缀：女篮、男篮、Basketball、BC、FC、联队、俱乐部 等。
   */
  private extractTeamKeyword(name: string): string {
    if (!name) return '';
    const cleaned: string = name
      .replace(/\s+/g, ' ')
      .replace(/（.*?）/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/女篮|男篮|篮球俱乐部|俱乐部|联队|篮球队|队$/g, '')
      .replace(/\b(FC|BC|CB|MBB|WBB|Basketball)\b/gi, '')
      .trim();
    const tokens: string[] = cleaned.split(/[\s_\-/]/).filter(Boolean);
    if (tokens.length === 0) return '';
    if (tokens.length === 1) return tokens[0];
    return tokens.slice(-1)[0];
  }

  /**
   * 从库内完赛记录对查两队直接交锋历史（H2H）。
   * 双向匹配：homeTeam vs awayTeam 无论主客场，取最近 N 场。
   */
  private async fetchH2hFromDb(
    pairs: Array<{ homeTeam: string; awayTeam: string; beforeTime: Date }>,
    limit: number = 5,
    dbs: PostgresJsDatabase = this.db,
  ): Promise<Map<string, H2hGameDetail[]>> {
    const result = new Map<string, H2hGameDetail[]>();
    if (pairs.length === 0) return result;

    for (const pair of pairs) {
      const { homeTeam, awayTeam, beforeTime } = pair;
      const key = `${homeTeam}__vs__${awayTeam}`;
      if (!homeTeam || !awayTeam) {
        result.set(key, []);
        continue;
      }

      const homeSide = await dbs
        .select({
          date: basketballMatches.kickoffTime,
          homeScore: basketballMatches.homeScore,
          awayScore: basketballMatches.awayScore,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          league: basketballMatches.league,
        })
        .from(basketballMatches)
        .where(
          and(
            eq(basketballMatches.homeTeam, homeTeam),
            eq(basketballMatches.awayTeam, awayTeam),
            eq(basketballMatches.matchStatus, 'finished'),
            lt(basketballMatches.kickoffTime, beforeTime),
            isNotNull(basketballMatches.homeScore),
            isNotNull(basketballMatches.awayScore),
          ),
        )
        .orderBy(desc(basketballMatches.kickoffTime))
        .limit(limit);

      const awaySide = await dbs
        .select({
          date: basketballMatches.kickoffTime,
          homeScore: basketballMatches.homeScore,
          awayScore: basketballMatches.awayScore,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          league: basketballMatches.league,
        })
        .from(basketballMatches)
        .where(
          and(
            eq(basketballMatches.homeTeam, awayTeam),
            eq(basketballMatches.awayTeam, homeTeam),
            eq(basketballMatches.matchStatus, 'finished'),
            lt(basketballMatches.kickoffTime, beforeTime),
            isNotNull(basketballMatches.homeScore),
            isNotNull(basketballMatches.awayScore),
          ),
        )
        .orderBy(desc(basketballMatches.kickoffTime))
        .limit(limit);

      const homeNorm = normalizeBasketballTeamName(homeTeam);
      const awayNorm = normalizeBasketballTeamName(awayTeam);

      const exactHome = homeSide.length;
      const exactAway = awaySide.length;

      if (exactHome + exactAway < 2) {
        const keywordHome = this.extractTeamKeyword(homeNorm || homeTeam);
        const keywordAway = this.extractTeamKeyword(awayNorm || awayTeam);
        if (keywordHome && keywordAway && keywordHome !== keywordAway) {
          const fuzzyLimit = limit * 4;
          const fuzzyRows = await dbs
            .select({
              date: basketballMatches.kickoffTime,
              homeScore: basketballMatches.homeScore,
              awayScore: basketballMatches.awayScore,
              homeTeam: basketballMatches.homeTeam,
              awayTeam: basketballMatches.awayTeam,
              league: basketballMatches.league,
            })
            .from(basketballMatches)
            .where(
              and(
                eq(basketballMatches.matchStatus, 'finished'),
                lt(basketballMatches.kickoffTime, beforeTime),
                isNotNull(basketballMatches.homeScore),
                isNotNull(basketballMatches.awayScore),
                sql`(
                  lower(${basketballMatches.homeTeam}) LIKE ${'%' + keywordHome.toLowerCase() + '%'}
                  AND lower(${basketballMatches.awayTeam}) LIKE ${'%' + keywordAway.toLowerCase() + '%'}
                ) OR (
                  lower(${basketballMatches.homeTeam}) LIKE ${'%' + keywordAway.toLowerCase() + '%'}
                  AND lower(${basketballMatches.awayTeam}) LIKE ${'%' + keywordHome.toLowerCase() + '%'}
                )`,
              ),
            )
            .orderBy(desc(basketballMatches.kickoffTime))
            .limit(fuzzyLimit);

          for (const g of fuzzyRows) {
            const ghn = normalizeBasketballTeamName(g.homeTeam || '');
            const gan = normalizeBasketballTeamName(g.awayTeam || '');
            const matchExact =
              (ghn === homeNorm && gan === awayNorm) ||
              (ghn === awayNorm && gan === homeNorm);
            if (matchExact) {
              const already = [...homeSide, ...awaySide].some(
                (e: { date: Date | string; homeTeam: string | null; awayTeam: string | null }) =>
                  (e.homeTeam === g.homeTeam && e.awayTeam === g.awayTeam &&
                   new Date(e.date).getTime() === new Date(g.date).getTime()),
              );
              if (!already) {
                (homeSide as typeof homeSide).push(g as typeof homeSide[number]);
              }
            }
          }
        }
      }

      const allGames: H2hGameDetail[] = [];
      for (const g of [...homeSide, ...awaySide]) {
        const hs = Number(g.homeScore) || 0;
        const as = Number(g.awayScore) || 0;
        if (hs <= 0 && as <= 0) continue;
        allGames.push({
          date: g.date instanceof Date ? g.date.toISOString() : String(g.date),
          homeTeam: g.homeTeam || '',
          awayTeam: g.awayTeam || '',
          homeScore: hs,
          awayScore: as,
          homeWin: hs > as,
          pointDiff: hs - as,
          league: g.league ?? null,
        });
      }
      allGames.sort((a: H2hGameDetail, b: H2hGameDetail) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      result.set(key, allGames.slice(0, limit));
    }

    return result;
  }

  /**
   * 用近期战绩计算净胜分校准值（时间加权：越近权重越高）。
   * 返回 { adjustedSpread, recentGames, weightedPd, confidence } 
   * adjustedSpread 用于和 Elo 预期净胜分融合；样本少时权重更高。
   */
  private computeRecentFormAdjustment(
    homeGames: RecentGameDetail[],
    awayGames: RecentGameDetail[],
  ): {
    recent10: { homePd: number; awayPd: number; homePpg: number; awayPpg: number; homeOppg: number; awayOppg: number; homeCount: number; awayCount: number };
    recent20: { homePd: number; awayPd: number; homePpg: number; awayPpg: number; homeOppg: number; awayOppg: number; homeCount: number; awayCount: number };
  } {
    const calcWeighted = (games: RecentGameDetail[], limit: number): { pd: number; ppg: number; oppg: number; count: number } => {
      const slice = games.slice(0, limit);
      if (slice.length === 0) return { pd: 0, ppg: 0, oppg: 0, count: 0 };
      let totalWeight = 0;
      let weightedPd = 0;
      let weightedPpg = 0;
      let weightedOppg = 0;
      for (let i = 0; i < slice.length; i += 1) {
        const weight = 1 - i * 0.08;
        const w = Math.max(0.3, weight);
        weightedPd += slice[i].pointDiff * w;
        weightedPpg += slice[i].scoreFor * w;
        weightedOppg += slice[i].scoreAgainst * w;
        totalWeight += w;
      }
      if (totalWeight === 0) return { pd: 0, ppg: 0, oppg: 0, count: slice.length };
      return {
        pd: weightedPd / totalWeight,
        ppg: weightedPpg / totalWeight,
        oppg: weightedOppg / totalWeight,
        count: slice.length,
      };
    };

    const h10 = calcWeighted(homeGames, 10);
    const a10 = calcWeighted(awayGames, 10);
    const h20 = calcWeighted(homeGames, 20);
    const a20 = calcWeighted(awayGames, 20);
    return {
      recent10: {
        homePd: h10.pd,
        awayPd: a10.pd,
        homePpg: h10.ppg,
        awayPpg: a10.ppg,
        homeOppg: h10.oppg,
        awayOppg: a10.oppg,
        homeCount: h10.count,
        awayCount: a10.count,
      },
      recent20: {
        homePd: h20.pd,
        awayPd: a20.pd,
        homePpg: h20.ppg,
        awayPpg: a20.ppg,
        homeOppg: h20.oppg,
        awayOppg: a20.oppg,
        homeCount: h20.count,
        awayCount: a20.count,
      },
    };
  }

  /**
   * 按行计算 data-driven 预测。
   * 两个公开方法分别做各自的 SELECT，Elo/伤停查询与行级计算都在此方法内完成。
   * 两个公开方法分别做各自的 SELECT，Elo/伤停查询与行级计算都在此方法内完成。
   */
  private async computePredictionsForRows(
    rows: ComputationRow[],
    dbs: PostgresJsDatabase = this.db,
  ): Promise<DataDrivenPrediction[]> {
    const nbaCount = rows.filter((r) => {
      const lg = r.league || '';
      return (lg.includes('NBA') || lg.includes('美职篮') || lg.includes('美国职业篮球')) && !lg.includes('WNBA');
    }).length;
    this.logger.error(`[COMPUTE-DEBUG] totalRows=${rows.length}, nbaRows=${nbaCount}`);
    if (nbaCount > 0) {
      const sample = rows.find((r) => {
        const lg = r.league || '';
        return (lg.includes('NBA') || lg.includes('美职篮') || lg.includes('美国职业篮球')) && !lg.includes('WNBA');
      });
      if (sample) {
          this.logger.error(`[COMPUTE-DEBUG] sample: matchNo=${sample.matchNo}, home=${sample.homeTeam}, league=${sample.league}`);
      }
    }
    if (rows.length === 0) return [];

    // --- Elo 查询 ---
    const teamNames = new Set<string>();
    for (const r of rows) {
      if (r.homeTeam) {
        teamNames.add(r.homeTeam);
        teamNames.add(normalizeBasketballTeamName(r.homeTeam));
      }
      if (r.awayTeam) {
        teamNames.add(r.awayTeam);
        teamNames.add(normalizeBasketballTeamName(r.awayTeam));
      }
    }
    const eloRows = await dbs
      .select({
        teamName: teamsElo.teamName,
        eloRating: teamsElo.eloRating,
        matchesPlayed: teamsElo.matchesPlayed,
        goalsFor: teamsElo.goalsFor,
        goalsAgainst: teamsElo.goalsAgainst,
        currentForm: teamsElo.currentForm,
      })
      .from(teamsElo)
      .where(
        and(
          eq(teamsElo.sport, 'basketball'),
          inArray(teamsElo.teamName, Array.from(teamNames)),
        ),
      );

    const eloMap = new Map<string, { rating: number; matches: number; gf: number; ga: number; form: string[] }>();
    for (const r of eloRows) {
      const mp = Number(r.matchesPlayed) || 0;
      const keys = [r.teamName, normalizeBasketballTeamName(r.teamName)];
      for (const k of keys) {
        if (!k) continue;
        const existing = eloMap.get(k);
        if (!existing || mp > existing.matches) {
          eloMap.set(k, {
            rating: Number(r.eloRating) || 1500,
            matches: mp,
            gf: Number(r.goalsFor) || 0,
            ga: Number(r.goalsAgainst) || 0,
            form: (r.currentForm as unknown as string[] | null) ?? [],
          });
        }
      }
    }

    function getElo(name: string): { rating: number; matches: number; gf: number; ga: number; form: string[] } | undefined {
      if (!name) return undefined;
      return eloMap.get(name) ?? eloMap.get(normalizeBasketballTeamName(name));
    }

    // --- 伤停聚合 ---
    const matchIds = rows.map((r) => r.id).filter(Boolean);
    const injuryRows = matchIds.length > 0
      ? await dbs
          .select({
            matchId: injuryReports.matchId,
            teamSide: injuryReports.teamSide,
            impactRating: injuryReports.impactRating,
            injuryDate: injuryReports.injuryDate,
          })
          .from(injuryReports)
          .where(inArray(injuryReports.matchId, matchIds))
      : [];
    type InjuryItem = { teamSide: string; impactRating: string; injuryDate: Date | null };
    const injuryRawMap = new Map<string, InjuryItem[]>();
    for (const ir of injuryRows) {
      if (!ir.matchId) continue;
      const list = injuryRawMap.get(ir.matchId) ?? [];
      list.push({ teamSide: ir.teamSide, impactRating: ir.impactRating, injuryDate: ir.injuryDate ?? null });
      injuryRawMap.set(ir.matchId, list);
    }

    // --- 赛季基线兜底（上赛季PPG/Oppg） ---
    // 当近期战绩样本不足时，用上赛季整季数据作为攻防效率先验
    const nbaTeamNames = new Set<string>();
    for (const r of rows) {
      const lg = r.league || '';
      const isNbaLeague = (lg.includes('NBA') || lg.includes('美职篮') || lg.includes('美国职业篮球')) && !lg.includes('WNBA');
      if (!isNbaLeague) continue;
      if (r.homeTeam) nbaTeamNames.add(normalizeBasketballTeamName(r.homeTeam));
      if (r.awayTeam) nbaTeamNames.add(normalizeBasketballTeamName(r.awayTeam));
    }
    const seasonBaselineMap = new Map<string, { ppg: number; oppg: number; gamesPlayed: number }>();
    if (nbaTeamNames.size > 0) {
      const baselineRows = await dbs
        .select({
          teamName: teamSeasonStats.teamName,
          ppg: teamSeasonStats.ppg,
          oppg: teamSeasonStats.oppg,
          gamesPlayed: teamSeasonStats.gamesPlayed,
        })
        .from(teamSeasonStats)
        .where(
          and(
            eq(teamSeasonStats.sport, 'basketball'),
            eq(teamSeasonStats.season, '2024-25'),
          ),
        );
      for (const br of baselineRows) {
        const norm = normalizeBasketballTeamName(br.teamName);
        seasonBaselineMap.set(norm, {
          ppg: Number(br.ppg) || 0,
          oppg: Number(br.oppg) || 0,
          gamesPlayed: br.gamesPlayed ?? 0,
        });
        if (norm !== br.teamName) {
          seasonBaselineMap.set(br.teamName, {
            ppg: Number(br.ppg) || 0,
            oppg: Number(br.oppg) || 0,
            gamesPlayed: br.gamesPlayed ?? 0,
          });
        }
      }
    }

    // --- 近期战绩详情查询 ---
    const recentPairs: Array<{ teamName: string; league: string; beforeTime: Date }> = [];
    for (const r of rows) {
      if (!r.homeTeam || !r.league) continue;
      const kt = r.kickoffTime instanceof Date ? r.kickoffTime : new Date(String(r.kickoffTime));
      recentPairs.push({ teamName: r.homeTeam, league: r.league, beforeTime: kt });
      if (r.awayTeam) {
        recentPairs.push({ teamName: r.awayTeam, league: r.league, beforeTime: kt });
      }
    }
    const recentGamesMap = await this.fetchRecentGamesFromDb(recentPairs, 20, dbs);

    // --- H2H 历史交锋查询（库内完赛记录对查） ---
    const h2hPairs: Array<{ homeTeam: string; awayTeam: string; beforeTime: Date }> = [];
    for (const r of rows) {
      if (!r.homeTeam || !r.awayTeam) continue;
      const kt = r.kickoffTime instanceof Date ? r.kickoffTime : new Date(String(r.kickoffTime));
      h2hPairs.push({ homeTeam: r.homeTeam, awayTeam: r.awayTeam, beforeTime: kt });
    }
    const h2hMap = await this.fetchH2hFromDb(h2hPairs, 5, dbs);

    // --- 行级计算 ---
    const results: DataDrivenPrediction[] = [];
    for (const row of rows) {
      const rowRules = (row.modelRules as unknown as string[] | null) ?? [];
      const isOfficialLocked = rowRules.some((r) => r.includes('官方数据锁定'));

      const league = row.league || 'default';
      const baseline = this.getLeagueBaseline(league);

      const homeElo = getElo(row.homeTeam || '');
      const awayElo = getElo(row.awayTeam || '');
      const eloHome = homeElo?.rating ?? null;
      const eloAway = awayElo?.rating ?? null;
      const eloGap = (eloHome != null && eloAway != null) ? eloHome - eloAway : 0;

      const homePpgRaw = homeElo
        ? this.estimateTeamStatsFromElo(homeElo.rating, homeElo.matches, homeElo.gf, homeElo.ga, baseline.total)
        : { ppg: 0, oppg: 0, sampleSize: 0 };
      const awayPpgRaw = awayElo
        ? this.estimateTeamStatsFromElo(awayElo.rating, awayElo.matches, awayElo.gf, awayElo.ga, baseline.total)
        : { ppg: 0, oppg: 0, sampleSize: 0 };

      let homePpg: number | null = homePpgRaw.ppg > 0 ? homePpgRaw.ppg : null;
      let awayPpg: number | null = awayPpgRaw.ppg > 0 ? awayPpgRaw.ppg : null;
      let homeOppg: number | null = homePpgRaw.oppg > 0 ? homePpgRaw.oppg : null;
      let awayOppg: number | null = awayPpgRaw.oppg > 0 ? awayPpgRaw.oppg : null;

      const ts = row.teamStats as Record<string, unknown> | null;
      let hasEfficiency = false;
      let effExpectedSpread = 0;
      let effExpectedTotal = 0;
      const basis: string[] = [];

      if (ts && ts.home && ts.away) {
        const hs = ts.home as Record<string, unknown>;
        const as = ts.away as Record<string, unknown>;
        const hOrtg = Number(hs.offensiveRating ?? hs.ortg ?? 0);
        const aOrtg = Number(as.offensiveRating ?? as.ortg ?? 0);
        const hDrtg = Number(hs.defensiveRating ?? hs.drtg ?? 0);
        const aDrtg = Number(as.defensiveRating ?? as.drtg ?? 0);
        const pace = Number(hs.pace ?? as.pace ?? 0);
        if (hOrtg > 0 && aOrtg > 0 && pace > 0) {
          hasEfficiency = true;
          const homeOff = (hOrtg + aDrtg) / 2 / 100 * pace;
          const awayOff = (aOrtg + hDrtg) / 2 / 100 * pace;
          effExpectedSpread = homeOff - awayOff + baseline.homeAdv;
          effExpectedTotal = homeOff + awayOff;
          basis.push(`ORtg/DRtg效率模型（主队ORtg=${hOrtg.toFixed(1)} DRtg=${hDrtg.toFixed(1)}；客队ORtg=${aOrtg.toFixed(1)} DRtg=${aDrtg.toFixed(1)}；Pace=${pace.toFixed(1)}）`);
        }
        const hPpg = Number(hs.pointsPerGame ?? hs.ppg ?? 0);
        const aPpg = Number(as.pointsPerGame ?? as.ppg ?? 0);
        const hOppg = Number(hs.oppg ?? hs.pointsAllowedPerGame ?? 0);
        const aOppg = Number(as.oppg ?? as.pointsAllowedPerGame ?? 0);
        if (hPpg > 0) homePpg = hPpg;
        if (aPpg > 0) awayPpg = aPpg;
        if (hOppg > 0) homeOppg = hOppg;
        if (aOppg > 0) awayOppg = aOppg;
      }

      const eloExpectedSpread = (eloHome != null && eloAway != null && eloHome > 0 && eloAway > 0)
        ? eloGap / 25 + baseline.homeAdv
        : null;

      let sampleHome = homePpgRaw.sampleSize;
      let sampleAway = awayPpgRaw.sampleSize;

      const homeRecentKey = row.homeTeam;
      const awayRecentKey = row.awayTeam;
      const homeRecentGames = recentGamesMap.get(homeRecentKey) ?? [];
      const awayRecentGames = recentGamesMap.get(awayRecentKey) ?? [];

      const recentAdj = this.computeRecentFormAdjustment(homeRecentGames, awayRecentGames);
      let r10 = { ...recentAdj.recent10 };
      let r20 = { ...recentAdj.recent20 };

      // 赛季基线兜底：NBA球队近期战绩样本不足时，用上赛季整季PPG/Oppg作为先验
      // 上赛季数据=82场全样本，设为15个等效样本（低于真实20场，体现"先验"权重）
      const leagueName = league || '';
      const isNba = (leagueName.includes('NBA') || leagueName.includes('美职篮') || leagueName.includes('美国职业篮球')) && !leagueName.includes('WNBA');
      const SEASON_BASELINE_SAMPLE = 15;
      let homeBaseline: { ppg: number; oppg: number; gamesPlayed: number } | undefined;
      let awayBaseline: { ppg: number; oppg: number; gamesPlayed: number } | undefined;
       if (isNba && seasonBaselineMap.size > 0) {
         const homeNorm = normalizeBasketballTeamName(row.homeTeam || '');
         const awayNorm = normalizeBasketballTeamName(row.awayTeam || '');
         homeBaseline = seasonBaselineMap.get(homeNorm) ?? seasonBaselineMap.get(row.homeTeam || '');
         awayBaseline = seasonBaselineMap.get(awayNorm) ?? seasonBaselineMap.get(row.awayTeam || '');
         if (row.matchNo === '周三310') {
           this.logger.log(`[BASELINE-DEBUG] ${row.matchNo}: home=${row.homeTeam}, away=${row.awayTeam}, homeNorm=${homeNorm}, awayNorm=${awayNorm}, homeFound=${!!homeBaseline}, awayFound=${!!awayBaseline}, mapSize=${seasonBaselineMap.size}`);
         }

        if (homeBaseline && homeBaseline.ppg > 0 && r20.homeCount < SEASON_BASELINE_SAMPLE) {
          const isHomeFirstFill = r20.homeCount === 0;
          r20.homePpg = homeBaseline.ppg;
          r20.homeOppg = homeBaseline.oppg;
          r10.homePpg = homeBaseline.ppg;
          r10.homeOppg = homeBaseline.oppg;
          if (isHomeFirstFill) {
            r20.homeCount = SEASON_BASELINE_SAMPLE;
            r10.homeCount = SEASON_BASELINE_SAMPLE;
          } else {
            r20.homeCount = Math.max(r20.homeCount, SEASON_BASELINE_SAMPLE);
            r10.homeCount = Math.max(r10.homeCount, SEASON_BASELINE_SAMPLE);
          }
        }
        if (awayBaseline && awayBaseline.ppg > 0 && r20.awayCount < SEASON_BASELINE_SAMPLE) {
          const isAwayFirstFill = r20.awayCount === 0;
          r20.awayPpg = awayBaseline.ppg;
          r20.awayOppg = awayBaseline.oppg;
          r10.awayPpg = awayBaseline.ppg;
          r10.awayOppg = awayBaseline.oppg;
          if (isAwayFirstFill) {
            r20.awayCount = SEASON_BASELINE_SAMPLE;
            r10.awayCount = SEASON_BASELINE_SAMPLE;
          } else {
            r20.awayCount = Math.max(r20.awayCount, SEASON_BASELINE_SAMPLE);
            r10.awayCount = Math.max(r10.awayCount, SEASON_BASELINE_SAMPLE);
          }
        }
        if (homeBaseline || awayBaseline) {
          if (homeBaseline && sampleHome < SEASON_BASELINE_SAMPLE) {
            sampleHome = SEASON_BASELINE_SAMPLE;
          }
          if (awayBaseline && sampleAway < SEASON_BASELINE_SAMPLE) {
            sampleAway = SEASON_BASELINE_SAMPLE;
          }
          if (homeBaseline && homePpg == null) homePpg = homeBaseline.ppg;
          if (awayBaseline && awayPpg == null) awayPpg = awayBaseline.ppg;
          if (homeBaseline && (homeOppg == null || r20.homeCount < 5)) homeOppg = homeBaseline.oppg;
          if (awayBaseline && (awayOppg == null || r20.awayCount < 5)) awayOppg = awayBaseline.oppg;
          if (row.homeTeam && homeOppg == null) {
            this.logger.warn(`[DEBUG-DD-OPPG] ${row.homeTeam}: homeNorm=${homeNorm}, baselineFound=${!!homeBaseline}, baselineOppg=${homeBaseline?.oppg ?? 'N/A'}, mapSize=${seasonBaselineMap.size}`);
          }
          basis.push(`上赛季基线兜底（StatMuse 2024-25，等效${SEASON_BASELINE_SAMPLE}样本：主${homeBaseline ? homeBaseline.ppg.toFixed(1) : '--'}/${awayBaseline ? awayBaseline.ppg.toFixed(1) : '--'} PPG）`);
        }
      }

      const hasRecentData = r20.homeCount >= 2 || r20.awayCount >= 2;

      const homeWins10 = homeRecentGames.slice(0, 10).filter((g: RecentGameDetail) => g.result === 'win').length;
      const awayWins10 = awayRecentGames.slice(0, 10).filter((g: RecentGameDetail) => g.result === 'win').length;
      const homeWins20 = homeRecentGames.slice(0, 20).filter((g: RecentGameDetail) => g.result === 'win').length;
      const awayWins20 = awayRecentGames.slice(0, 20).filter((g: RecentGameDetail) => g.result === 'win').length;

      let modelExpectedSpread: number;
      let baselineUsedForSpread = false;
      const hasSeasonBaseline = isNba && seasonBaselineMap.size > 0 && !!homeBaseline && !!awayBaseline;
      let baselineSpread = 0;
      if (hasSeasonBaseline) {
        baselineSpread = (homeBaseline!.ppg - homeBaseline!.oppg) - (awayBaseline!.ppg - awayBaseline!.oppg) + baseline.homeAdv;
      }

      if (hasSeasonBaseline) {
        modelExpectedSpread = baselineSpread;
        baselineUsedForSpread = true;
        basis.push(`赛季基线净胜分（主净胜${(homeBaseline!.ppg - homeBaseline!.oppg).toFixed(1)} vs 客净胜${(awayBaseline!.ppg - awayBaseline!.oppg).toFixed(1)}，预期净胜${baselineSpread >= 0 ? '+' : ''}${baselineSpread.toFixed(1)}）`);
        if (hasEfficiency) {
          modelExpectedSpread = 0.7 * baselineSpread + 0.3 * effExpectedSpread;
          basis.push(`效率数据校准（权重30%，预期净胜${effExpectedSpread >= 0 ? '+' : ''}${effExpectedSpread.toFixed(1)}）`);
        }
      } else if (hasEfficiency && eloExpectedSpread != null) {
        modelExpectedSpread = 0.6 * effExpectedSpread + 0.4 * eloExpectedSpread;
        basis.push(`Elo融合（Elo差=${eloGap.toFixed(1)}，权重0.4）`);
      } else if (hasEfficiency) {
        modelExpectedSpread = effExpectedSpread;
      } else if (eloExpectedSpread != null) {
        modelExpectedSpread = eloExpectedSpread;
        basis.push(`Elo差推导净胜分（Elo差=${eloGap.toFixed(1)}，σ=25）`);
      } else {
        modelExpectedSpread = baseline.homeAdv;
        basis.push('无球队数据，仅主场优势作基准');
      }

      if (hasRecentData) {
        const recentSpread10 = r10.homePd - r10.awayPd + baseline.homeAdv;
        const recentSpread20 = r20.homePd - r20.awayPd + baseline.homeAdv;
        const sampleCount10 = Math.max(1, r10.homeCount + r10.awayCount);
        const sampleCount20 = Math.max(1, r20.homeCount + r20.awayCount);
        const w10 = sampleCount10 / (sampleCount10 + sampleCount20 * 0.5);
        const w20 = 1 - w10;
        const recentSpread = w10 * recentSpread10 + w20 * recentSpread20;

        const eloSample = Math.max(1, sampleHome + sampleAway);
        const recentSample = Math.max(1, r20.homeCount + r20.awayCount);
        const baseSample = baselineUsedForSpread ? SEASON_BASELINE_SAMPLE * 2 : 0;
        const anchorSample = eloSample + baseSample;

        if (baselineUsedForSpread) {
          const recentDeviation = recentSpread - modelExpectedSpread;
          const adjCap = 5.0;
          const sampleFactor = Math.min(1, recentSample / 30);
          const cappedAdj = Math.max(-adjCap * sampleFactor, Math.min(adjCap * sampleFactor, recentDeviation * 0.3));
          modelExpectedSpread = modelExpectedSpread + cappedAdj;
          basis.push(`近期战绩微调（偏差${recentDeviation >= 0 ? '+' : ''}${recentDeviation.toFixed(1)}分，实际调整${cappedAdj >= 0 ? '+' : ''}${cappedAdj.toFixed(1)}分，样本因子=${sampleFactor.toFixed(2)}）`);
        } else {
          const eloWeight = Math.min(0.7, anchorSample / (anchorSample + recentSample * 0.7));
          const recentWeight = 1 - eloWeight;
          if (eloExpectedSpread != null || hasEfficiency) {
            modelExpectedSpread = eloWeight * modelExpectedSpread + recentWeight * recentSpread;
          } else {
            modelExpectedSpread = recentSpread;
          }
          basis.push(`近期战绩校准（近10场权重=${(w10 * 100).toFixed(0)}%/近20场权重=${(w20 * 100).toFixed(0)}%，融合后净胜分差=${recentSpread.toFixed(1)}分，Elo融合权重=${(recentWeight * 100).toFixed(0)}%）`);
        }

        basis.push(`近期战绩(近10场): 主${homeWins10}胜${r10.homeCount - homeWins10}负 净胜分${r10.homePd >= 0 ? '+' : ''}${r10.homePd.toFixed(1)} 客${awayWins10}胜${r10.awayCount - awayWins10}负 净胜分${r10.awayPd >= 0 ? '+' : ''}${r10.awayPd.toFixed(1)}`);
        basis.push(`近期战绩(近20场): 主${homeWins20}胜${r20.homeCount - homeWins20}负 净胜分${r20.homePd >= 0 ? '+' : ''}${r20.homePd.toFixed(1)} 客${awayWins20}胜${r20.awayCount - awayWins20}负 净胜分${r20.awayPd >= 0 ? '+' : ''}${r20.awayPd.toFixed(1)}`);
      }

      const h2hKey = `${row.homeTeam}__vs__${row.awayTeam}`;
      const h2hGames = h2hMap.get(h2hKey) ?? [];
      const hasH2h = h2hGames.length >= 2;
      let h2hAvgHomePd = 0;
      if (hasH2h) {
        const calcH2hWeighted = (games: H2hGameDetail[]): { avgPd: number; homeWins: number; count: number } => {
          if (games.length === 0) return { avgPd: 0, homeWins: 0, count: 0 };
          let pdSum = 0;
          let hw = 0;
          let tw = 0;
          for (let i = 0; i < games.length; i += 1) {
            const g = games[i];
            const weight = 1 - i * 0.1;
            const w = Math.max(0.5, weight);
            const homePd = g.homeTeam === row.homeTeam ? g.pointDiff : -g.pointDiff;
            const homeWin = g.homeTeam === row.homeTeam ? g.homeWin : !g.homeWin;
            pdSum += homePd * w;
            if (homeWin) hw += 1;
            tw += w;
          }
          return { avgPd: tw > 0 ? pdSum / tw : 0, homeWins: hw, count: games.length };
        };

        const recentH2hGames = h2hGames.slice(0, 3);
        const historicalH2hGames = h2hGames.slice(3, 5);
        const recentH2h = calcH2hWeighted(recentH2hGames);
        const historicalH2h = calcH2hWeighted(historicalH2hGames);

        let totalH2hWeight = 0;
        let weightedH2hPd = 0;
        const recentH2hEnough = recentH2h.count >= 2;
        const historicalH2hEnough = historicalH2h.count >= 2;

        if (recentH2hEnough) {
          const w = Math.min(0.12, 0.03 + recentH2h.count * 0.03);
          weightedH2hPd += w * recentH2h.avgPd;
          totalH2hWeight += w;
          const recAwayWins = recentH2h.count - recentH2h.homeWins;
          basis.push(`近期交锋(近3次): 主${recentH2h.homeWins}胜客${recAwayWins}胜，主队净胜分${recentH2h.avgPd >= 0 ? '+' : ''}${recentH2h.avgPd.toFixed(1)}`);
        }
        if (historicalH2hEnough) {
          const w = Math.min(0.06, 0.015 + historicalH2h.count * 0.015);
          weightedH2hPd += w * historicalH2h.avgPd;
          totalH2hWeight += w;
          const histAwayWins = historicalH2h.count - historicalH2h.homeWins;
          basis.push(`历史交锋(更早): 主${historicalH2h.homeWins}胜客${histAwayWins}胜，主队净胜分${historicalH2h.avgPd >= 0 ? '+' : ''}${historicalH2h.avgPd.toFixed(1)}`);
        }

        if (totalH2hWeight === 0) {
          const overall = calcH2hWeighted(h2hGames);
          const w = Math.min(0.15, 0.03 + h2hGames.length * 0.024);
          weightedH2hPd = w * overall.avgPd;
          totalH2hWeight = w;
          const awayWins = h2hGames.length - overall.homeWins;
          basis.push(`历史交锋（近${h2hGames.length}次：主${overall.homeWins}胜客${awayWins}胜，主队加权净胜分差=${overall.avgPd.toFixed(1)}分，权重=${(w * 100).toFixed(0)}%）`);
        } else {
          totalH2hWeight = Math.min(0.15, totalH2hWeight);
        }

        h2hAvgHomePd = totalH2hWeight > 0 ? weightedH2hPd / totalH2hWeight : 0;
        const baseWeight = 1 - totalH2hWeight;
        modelExpectedSpread = baseWeight * modelExpectedSpread + totalH2hWeight * h2hAvgHomePd;
      }

      let minSample = Math.min(sampleHome, sampleAway);
      let totalSample = sampleHome + sampleAway;

      if (hasRecentData) {
        const effectiveSampleHome = Math.max(sampleHome, r20.homeCount);
        const effectiveSampleAway = Math.max(sampleAway, r20.awayCount);
        minSample = Math.min(effectiveSampleHome, effectiveSampleAway);
        totalSample = effectiveSampleHome + effectiveSampleAway;
      }

      const minRecent10Count = Math.min(r10.homeCount, r10.awayCount);

      let dataQuality: 'high' | 'medium' | 'low' = 'low';
      const missing: string[] = [];

      if (hasEfficiency && minSample >= 10) {
        dataQuality = 'high';
      } else if (hasEfficiency || (minRecent10Count >= 5 && totalSample >= 12)) {
        dataQuality = 'medium';
      } else {
        dataQuality = 'low';
      }
      if (!hasEfficiency) missing.push('team_stats效率(ORtg/DRtg/Pace)');
      if (sampleHome < 5) missing.push(`主队Elo样本量不足(${sampleHome}场)`);
      if (sampleAway < 5) missing.push(`客队Elo样本量不足(${sampleAway}场)`);
      if (r10.homeCount < 5) missing.push(`主队近10场样本不足(${r10.homeCount}场)`);
      if (r10.awayCount < 5) missing.push(`客队近10场样本不足(${r10.awayCount}场)`);

      const kt = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime));
      const injuryRaw = injuryRawMap.get(row.id) ?? [];
      const injuryInfo = this.computeInjuryAggregate(injuryRaw, kt);
      const coreInjuriesHome = injuryInfo.homeTotal;
      const coreInjuriesAway = injuryInfo.awayTotal;
      const freshCoreHome = injuryInfo.homeFresh;
      const freshCoreAway = injuryInfo.awayFresh;

      let injuryAdjust = 0;
      let injuryNote = '';
        if (freshCoreHome + freshCoreAway > 0) {
        // V11.12 伤停让分降权：单核心缺阵从2分降至1.5分，多人从4分降至3分
        // 回测显示伤停加权版让分命中率(52.5%)反而低于纯效率版(61%)，说明过度调整
        const perPerson = 1.5;
        const multiPerson = 3.0;
        if (freshCoreHome >= 2) {
          injuryAdjust -= multiPerson;
          injuryNote = `主队核心缺阵${freshCoreHome}人，向客队方向调${multiPerson}分`;
        } else if (freshCoreHome >= 1) {
          injuryAdjust -= perPerson;
          injuryNote = `主队核心缺阵1人，向客队方向调${perPerson}分`;
        }
        if (freshCoreAway >= 2) {
          injuryAdjust += multiPerson;
          injuryNote = injuryNote ? `${injuryNote}；客队核心缺阵${freshCoreAway}人，向主队方向调${multiPerson}分` : `客队核心缺阵${freshCoreAway}人，向主队方向调${multiPerson}分`;
        } else if (freshCoreAway >= 1) {
          injuryAdjust += perPerson;
          injuryNote = injuryNote ? `${injuryNote}；客队核心缺阵1人，向主队方向调${perPerson}分` : `客队核心缺阵1人，向主队方向调${perPerson}分`;
        }
        if (injuryNote) basis.push(`伤停调整：${injuryNote}（净调整${injuryAdjust >= 0 ? '+' : ''}${injuryAdjust}分）`);
      }
      if (!injuryNote && coreInjuriesHome + coreInjuriesAway > 0) {
        basis.push('伤停备注：均为老伤（已体现在近期战绩中），未做额外调整');
      }
      if (coreInjuriesHome === 0 && coreInjuriesAway === 0 && !injuryRawMap.has(row.id)) {
        basis.push('该联赛无伤停数据源，未做伤停调整');
        missing.push('伤停情报');
      }

      modelExpectedSpread += injuryAdjust;
      modelExpectedSpread = Math.round(modelExpectedSpread * 10) / 10;

      const hasFullOffDefData = homePpg != null && awayPpg != null && homeOppg != null && awayOppg != null;

      if (homePpg != null && awayPpg != null) {
        basis.push(`场均得分：主${homePpg.toFixed(1)} 客${awayPpg.toFixed(1)}（样本合计${totalSample}场）`);
      }
      if (homeOppg != null && awayOppg != null) {
        basis.push(`场均失分：主${homeOppg.toFixed(1)} 客${awayOppg.toFixed(1)}`);
      }

      const homePpgEff = homePpg ?? baseline.total / 2;
      const awayPpgEff = awayPpg ?? baseline.total / 2;
      const homeOppgEff = homeOppg ?? baseline.total / 2;
      const awayOppgEff = awayOppg ?? baseline.total / 2;
      let modelExpectedTotal: number;
      if (hasEfficiency) {
        modelExpectedTotal = effExpectedTotal;
      } else if (hasFullOffDefData) {
        modelExpectedTotal = (homePpgEff + awayOppgEff + awayPpgEff + homeOppgEff) / 2;
      } else {
        modelExpectedTotal = baseline.total;
      }

      if (hasRecentData && !hasEfficiency && hasFullOffDefData) {
        const recent10HomePpg = r10.homePpg > 0 ? r10.homePpg : homePpgEff;
        const recent10AwayPpg = r10.awayPpg > 0 ? r10.awayPpg : awayPpgEff;
        const recent10HomeOppg = r10.homeOppg > 0 ? r10.homeOppg : homeOppgEff;
        const recent10AwayOppg = r10.awayOppg > 0 ? r10.awayOppg : awayOppgEff;
        const recent10Total = (recent10HomePpg + recent10AwayOppg + recent10AwayPpg + recent10HomeOppg) / 2;

        const recent20HomePpg = r20.homePpg > 0 ? r20.homePpg : homePpgEff;
        const recent20AwayPpg = r20.awayPpg > 0 ? r20.awayPpg : awayPpgEff;
        const recent20HomeOppg = r20.homeOppg > 0 ? r20.homeOppg : homeOppgEff;
        const recent20AwayOppg = r20.awayOppg > 0 ? r20.awayOppg : awayOppgEff;
        const recent20Total = (recent20HomePpg + recent20AwayOppg + recent20AwayPpg + recent20HomeOppg) / 2;

        const sampleCount10 = Math.max(1, r10.homeCount + r10.awayCount);
        const sampleCount20 = Math.max(1, r20.homeCount + r20.awayCount);
        const w10total = sampleCount10 / (sampleCount10 + sampleCount20 * 0.5);
        const w20total = 1 - w10total;
        const recentTotal = w10total * recent10Total + w20total * recent20Total;

        const avgPpgSample = (sampleHome + sampleAway) / 2;
        const avgRecentSample = (r20.homeCount + r20.awayCount) / 2;
        const baseWeight = Math.min(0.85, avgPpgSample / (avgPpgSample + avgRecentSample * 0.4));
        if (homePpg != null || awayPpg != null) {
          modelExpectedTotal = baseWeight * modelExpectedTotal + (1 - baseWeight) * recentTotal;
        } else {
          modelExpectedTotal = recentTotal;
        }
        basis.push(`近期战绩总分校准（近10场权重=${(w10total * 100).toFixed(0)}%/近20场权重=${(w20total * 100).toFixed(0)}%，场均样本${avgPpgSample.toFixed(0)}场 vs 近期${avgRecentSample.toFixed(0)}场，融合权重=${((1 - baseWeight) * 100).toFixed(0)}%）`);
      }
      const isNbaLeague = ((league || '').includes('NBA') || (league || '').includes('美职篮') || (league || '').includes('美国职业篮球')) && !(league || '').includes('WNBA');
      const injuryPerPerson = isNbaLeague ? 0.4 : 1.5;
      const totalInjuryAdjust = -(coreInjuriesHome + coreInjuriesAway) * injuryPerPerson;
      modelExpectedTotal += totalInjuryAdjust;
      modelExpectedTotal = Math.round(modelExpectedTotal * 10) / 10;

      if (coreInjuriesHome + coreInjuriesAway > 0) {
        basis.push(`大小分伤停压小${Math.abs(totalInjuryAdjust).toFixed(1)}分（${coreInjuriesHome + coreInjuriesAway}人×${injuryPerPerson}）`);
      }

      let handicapLineNum = Number(row.handicapLineNum) || 0;
      let totalLineNum = Number(row.totalLineNum) || 0;
      if (handicapLineNum === 0 && row.oddsOpenHandicapLine) {
        const openStr = String(row.oddsOpenHandicapLine).replace(/[+\s]/g, '');
        const openHcp = Number(openStr);
        if (!Number.isNaN(openHcp) && openHcp !== 0) handicapLineNum = openHcp;
      }
      if (totalLineNum === 0 && row.oddsOpenTotalLine) {
        const openStr = String(row.oddsOpenTotalLine).replace(/[+\s]/g, '');
        const openTotal = Number(openStr);
        if (!Number.isNaN(openTotal) && openTotal > 0) totalLineNum = openTotal;
      }

      const kickoffDate =
        row.kickoffTime instanceof Date
          ? row.kickoffTime
          : new Date(String(row.kickoffTime || Date.now()));
      const kickoffMonth = kickoffDate.getMonth() + 1;
      const lineAbs = Math.abs(handicapLineNum);
      const isAwayFavorite = handicapLineNum > 0;

      if (handicapLineNum !== 0 && isAwayFavorite) {
        let awayAdj = 1.5;
        if (lineAbs >= 3.5 && lineAbs <= 6) awayAdj += 0.8;
        else if (lineAbs >= 10.5 && lineAbs <= 15) awayAdj += 0.6;
        const isWNBA = league.includes('WNBA');
        const isPlayoffLike = isWNBA && (kickoffMonth >= 9 || kickoffMonth <= 5);
        if (isPlayoffLike) awayAdj += 1.0;
        modelExpectedSpread += awayAdj;
        basis.push(`客队热门系统性降权（线${handicapLineNum}，向主队方向调${awayAdj.toFixed(1)}分）`);
      }

      if (totalLineNum > 0) {
        const isWNBA = league.includes('WNBA');
        let monthlyAdj = 0;
        if (isWNBA) {
          if (kickoffMonth === 6) monthlyAdj = 4;
          else if (kickoffMonth === 7) monthlyAdj = 3;
          else if (kickoffMonth === 8) monthlyAdj = -2.5;
          else if (kickoffMonth === 9) monthlyAdj = -1.5;
        }
        if (monthlyAdj !== 0) {
          modelExpectedTotal += monthlyAdj;
          basis.push(`大小分月份校准（${kickoffMonth}月${monthlyAdj > 0 ? '+' : ''}${monthlyAdj}分）`);
        }
      }

      let handicapRecommendation: string;
      let handicapCoverProb = 50;
      let hcConf: '高' | '中' | '低' = '低';

      if (handicapLineNum !== 0) {
        const spreadVsLine = modelExpectedSpread + handicapLineNum;
        const combinedSpreadSigma = this.computeCombinedSigma(
          baseline.spreadSigma,
          sampleHome,
          sampleAway,
          hasEfficiency ? 2 : 4,
        );
        const handicapCoverProbRaw = this.normalCdf(spreadVsLine / combinedSpreadSigma);
        handicapCoverProb = Math.round(handicapCoverProbRaw * 100);
        if (handicapCoverProb === 50) {
          handicapCoverProb = spreadVsLine > 0 ? 51 : 49;
        }

        const favoriteSide = handicapLineNum < 0 ? 'home' : 'away';
        const gapToLine = favoriteSide === 'home' ? spreadVsLine : -spreadVsLine;
        const isDeepLine = lineAbs >= 12 && lineAbs <= 24;
        const isUltraDeep = lineAbs >= 25;

        if (isUltraDeep && handicapCoverProb >= 47 && handicapCoverProb <= 53) {
          handicapRecommendation = favoriteSide === 'home' ? '让分主胜' : '让分客胜';
          hcConf = '低';
          basis.push('超深盘双向判定：概率接近50%，跟指数热门方低信心');
        } else if (gapToLine >= 2) {
          handicapRecommendation = favoriteSide === 'home' ? '让分主胜' : '让分客胜';
          basis.push(`v10双向判定：模型预期比让分线强${gapToLine.toFixed(1)}分，押热门方`);
        } else if (gapToLine <= -2) {
          handicapRecommendation = favoriteSide === 'home' ? '让分客胜' : '让分主胜';
          basis.push(`v10反向判定：模型预期比让分线弱${Math.abs(gapToLine).toFixed(1)}分，押受让方`);
        } else {
          handicapRecommendation = favoriteSide === 'home' ? '让分主胜' : '让分客胜';
          hcConf = '低';
          basis.push(`v10边缘判定：预期与线差${gapToLine >= 0 ? '+' : ''}${gapToLine.toFixed(1)}分，跟热门方低信心`);
        }

        if (hcConf === '低' && (dataQuality !== 'low' || hasEfficiency)) {
          const hcDeviation = Math.abs(handicapCoverProb - 50);
          if (hcDeviation >= 15) hcConf = '高';
          else if (hcDeviation >= 8) hcConf = '中';
        } else if (hcConf === '低') {
          const hcDeviation = Math.abs(handicapCoverProb - 50);
          const hcHighThreshold = 20;
          const hcMidThreshold = 10;
          if (hcDeviation >= hcHighThreshold) hcConf = '中';
          else if (hcDeviation >= hcMidThreshold) hcConf = '中';
        }
        if (isDeepLine && hcConf === '高') hcConf = '中';

        if (dataQuality === 'low' && !hasEfficiency) {
          const eloGapAbs = Math.abs(eloGap);
          const hasH2hSignals = hasH2h && Math.abs(h2hAvgHomePd) >= 5;
          const hasInjurySignals = coreInjuriesHome + coreInjuriesAway > 0;
          const isBaselineMechanical = eloGapAbs < 60 && !hasH2hSignals && !hasInjurySignals;
          if (isBaselineMechanical) {
            hcConf = '低';
            basis.push('低样本基线推导：方向由主场优势vs让分线机械决定，参考性有限');
          }
        }
      } else {
        handicapRecommendation = '待线值';
        missing.push('让分线值');
      }

      let totalDirection: '大分' | '小分' | '观望' | '待线值' = '待线值';
      let totalProb = 50;
      let totalConf: '高' | '中' | '低' = '低';

      if (totalLineNum > 0) {
        if (hasFullOffDefData) {
          const baseTotal = (homePpg + awayPpg + homeOppg + awayOppg) / 2;
          const offDefRatio = (homePpg * awayOppg) / Math.max(1, homeOppg * awayPpg);
          const asymAdjRaw = (offDefRatio - 1) * baseTotal / 2;
          const asymAdj = Math.max(-1.5, Math.min(1.5, asymAdjRaw));

          const coreInjuries = coreInjuriesHome + coreInjuriesAway;
          const injuryPerPerson = isNbaLeague ? 0.4 : 1.5;
          const injuryCap = isNbaLeague ? 2 : 6;
          const injuryThreshold = isNbaLeague ? 4 : 4;
          let injuryAdjustment = 0;
          if (coreInjuries > 0) {
            if (coreInjuries >= injuryThreshold) {
              injuryAdjustment = -injuryCap;
            } else {
              injuryAdjustment = -(coreInjuries * injuryPerPerson);
            }
          }

          const seasonBaselineUsed = basis.some((b: string) => b.includes('上赛季基线兜底'));
          let v11_2ExpectedTotal = Math.round((baseTotal + asymAdj + injuryAdjustment) * 10) / 10;

          // V11.12 赛季初数据收缩：使用上赛季基线兜底时，攻防效率模型向指数线收缩40%
          // 防止赛季初/揭幕战攻防基线偏差导致大小分方向大幅偏离市场共识
          if (seasonBaselineUsed && totalLineNum > 0) {
            const modelWeight = 0.6;
            const lineWeight = 0.4;
            const originalTotal = v11_2ExpectedTotal;
            v11_2ExpectedTotal = Math.round((originalTotal * modelWeight + totalLineNum * lineWeight) * 10) / 10;
            basis.push(
              `V11.12 赛季基线收缩：攻防效率模型向指数线收缩40%` +
                `（原${originalTotal.toFixed(1)}分 → ${v11_2ExpectedTotal.toFixed(1)}分）`,
            );
          }

          const totalDiff = v11_2ExpectedTotal - totalLineNum;
          const absDiff = Math.abs(totalDiff);

          if (absDiff >= 3) {
            const rawProb = 50 + absDiff * 2;
            totalProb = Math.round(Math.min(70, Math.max(30, rawProb)));
            totalProb = totalDiff > 0 ? totalProb : 100 - totalProb;
            totalDirection = totalDiff > 0 ? '大分' : '小分';
            const devFrom50 = Math.abs(totalProb - 50);
            if (devFrom50 >= 15) totalConf = '高';
            else if (devFrom50 >= 8) totalConf = '中';
            else totalConf = '低';
          } else {
            const lowConfProb = 50 + absDiff * (5 / 3);
            totalProb = totalDiff >= 0 ? Math.round(lowConfProb) : Math.round(100 - lowConfProb);
            if (totalProb === 50) totalProb = totalDiff >= 0 ? 51 : 49;
            totalDirection = totalDiff >= 0 ? '大分' : '小分';
            totalConf = '低';
          }

          const dataSourceLabel = seasonBaselineUsed ? '赛季基线' : '本赛季数据';
          basis.push(`V11.2 攻防效率均值模型（预期总分=${v11_2ExpectedTotal.toFixed(1)}，攻防不对称修正${asymAdj >= 0 ? '+' : ''}${asymAdj.toFixed(1)}分，基于${dataSourceLabel}）`);
        } else {
          const totalDiff = modelExpectedTotal - totalLineNum;
          const combinedTotalSigma = this.computeCombinedSigma(
            baseline.totalSigma,
            sampleHome,
            sampleAway,
            hasEfficiency ? 2.5 : 5,
          );
          const totalZ = totalDiff / combinedTotalSigma;
          totalProb = Math.round(this.normalCdf(totalZ) * 100);
          if (totalProb === 50) {
            totalProb = totalDiff > 0 ? 51 : 49;
          }

          const absDiff = Math.abs(totalDiff);
          let gateThreshold = 4;
          if (absDiff >= 15) gateThreshold = 3;
          else if (absDiff >= 8) gateThreshold = 2;

          const totalDeviation = Math.abs(totalProb - 50);
          if (absDiff >= gateThreshold && totalProb >= 40 && totalProb <= 60) {
            totalDirection = totalProb > 50 ? '大分' : '小分';
          } else if (totalProb > 60) {
            totalDirection = '大分';
          } else if (totalProb < 40) {
            totalDirection = '小分';
          } else {
            totalDirection = totalProb > 50 ? '大分' : '小分';
            totalConf = '低';
            basis.push(`v10大小分层闸门：差值${absDiff.toFixed(1)}分<阈值${gateThreshold}分，低信心`);
          }

          if (totalConf === '低') {
            const ouHighThreshold = dataQuality === 'low' ? 20 : 15;
            const ouMidThreshold = dataQuality === 'low' ? 10 : 8;
            if (totalDeviation >= ouHighThreshold) totalConf = dataQuality === 'low' ? '中' : '高';
            else if (totalDeviation >= ouMidThreshold) totalConf = '中';
          }
          if (dataQuality === 'low') {
            totalProb = totalProb > 50 ? Math.min(totalProb, 72) : Math.max(totalProb, 28);
          }
        }
      } else {
        totalDirection = '待线值';
        missing.push('大小分线值');
      }

      const homeWinRaw = this.normalCdf(modelExpectedSpread / baseline.spreadSigma);
      let homeWinProb = Math.round(homeWinRaw * 100);
      // 恰50/50时用预期净胜分打破平局，避免两端相等导致前端判为未分析
      if (homeWinProb === 50) {
        if (modelExpectedSpread > 0) homeWinProb = 51;
        else if (modelExpectedSpread < 0) homeWinProb = 49;
        else if (handicapLineNum < 0) homeWinProb = 49;
        else homeWinProb = 51;
      }
      const lowSampleRisk = totalSample < 10;
      if (lowSampleRisk) {
        basis.push(`小样本风险：合计${totalSample}场，预测参考性有限`);
      }

      if (coreInjuriesHome > 0 || coreInjuriesAway > 0) {
        basis.push(`核心伤停：主${coreInjuriesHome}人 客${coreInjuriesAway}人`);
      }

      const isNbaV119 = !league.includes('WNBA') && (league.includes('NBA') || league.includes('美职篮') || league.includes('美国职业篮球'));
      const minSampleV119 = Math.min(sampleHome, sampleAway);
      const isNbaEarlySeasonV119 = isNbaV119 && minSampleV119 < 5;
      const noOfficialLine = handicapLineNum === 0 && totalLineNum === 0;
      let finalConfidence = dataQuality === 'low'
        ? Math.max(15, Math.min(57, Math.max(homeWinProb, 100 - homeWinProb) - 10))
        : Math.max(homeWinProb, 100 - homeWinProb);
      if (isNbaEarlySeasonV119 && noOfficialLine && finalConfidence > 55) {
        finalConfidence = 55;
        basis.push('V11.9 NBA赛季初无盘口保护：数据驱动路径信心上限55%');
      }

      results.push({
        matchId: row.id,
        matchNo: row.matchNo || '',
        league,
        leagueKey: this.leagueKey(league),
        baselineTotal: baseline.total,
        homeTeam: row.homeTeam || '',
        awayTeam: row.awayTeam || '',
        kickoffTime: row.kickoffTime instanceof Date ? row.kickoffTime.toISOString() : String(row.kickoffTime),
        isOfficialLocked,
        dataQuality,
        missingData: missing,
        eloHome,
        eloAway,
        eloMatchesHome: sampleHome,
        eloMatchesAway: sampleAway,
        homePpg,
        awayPpg,
        homeOppg,
        awayOppg,
        coreInjuriesHome,
        coreInjuriesAway,
        h2h: h2hGames.length > 0 ? h2hGames : null,
        modelExpectedSpread,
        modelExpectedTotal,
        handicapLineNum,
        totalLineNum,
        handicapCoverProb,
        handicapRecommendation,
        handicapConfidence: hcConf,
        totalDirection,
        totalProb,
        totalConfidence: totalConf,
        computationBasis: basis,
        homeWinProb,
        awayWinProb: 100 - homeWinProb,
        confidence: finalConfidence,
        lowSampleRisk,
         recentFormDetail: {
          home: homeRecentGames,
          away: awayRecentGames,
          computedAt: new Date().toISOString(),
        },
        recent10Detail: {
          homePd: r10.homePd,
          awayPd: r10.awayPd,
          homePpg: r10.homePpg,
          awayPpg: r10.awayPpg,
          homeOppg: r10.homeOppg,
          awayOppg: r10.awayOppg,
          homeCount: r10.homeCount,
          awayCount: r10.awayCount,
        },
         recent20Detail: {
          homePd: r20.homePd,
          awayPd: r20.awayPd,
          homePpg: r20.homePpg,
          awayPpg: r20.awayPpg,
          homeOppg: r20.homeOppg,
          awayOppg: r20.awayOppg,
          homeCount: r20.homeCount,
          awayCount: r20.awayCount,
        },
        predGeneratedAt: new Date().toISOString(),
      });
    }

    return results;
  }

  async predictUpcomingSporttery(date: string): Promise<DataDrivenPrediction[]> {
    return this.predictUpcomingBySource('sporttery', date);
  }

  async predictAllUpcomingBySource(source: string): Promise<DataDrivenPrediction[]> {
    this.logger.log(`[DD-ENTRY] predictAllUpcomingBySource called, source=${source}`);
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        modelRules: basketballMatches.modelRules,
        teamStats: basketballMatches.teamStats,
        injuries: basketballMatches.injuries,
        recentForm: basketballMatches.recentForm,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
        isPredictionFrozen: basketballMatches.isPredictionFrozen,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.source, source),
          eq(basketballMatches.matchStatus, 'upcoming'),
          eq(basketballMatches.isPredictionFrozen, false),
        ),
      )
      .orderBy(basketballMatches.kickoffTime);

    return this.computePredictionsForRows(rows);
  }

  async predictLiveBySource(source: string): Promise<DataDrivenPrediction[]> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        modelRules: basketballMatches.modelRules,
        teamStats: basketballMatches.teamStats,
        injuries: basketballMatches.injuries,
        recentForm: basketballMatches.recentForm,
         handicapLineNum: basketballMatches.handicapLineNum,
         totalLineNum: basketballMatches.totalLineNum,
         homeWinOdds: basketballMatches.homeWinOdds,
         awayWinOdds: basketballMatches.awayWinOdds,
         oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
         oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
       })
       .from(basketballMatches)
       .where(
         and(
           eq(basketballMatches.source, source),
           eq(basketballMatches.matchStatus, 'live'),
           eq(basketballMatches.isPredictionFrozen, false),
         ),
       )
       .orderBy(basketballMatches.kickoffTime);

    return this.computePredictionsForRows(rows);
  }

  async predictUpcomingBySource(source: string, date: string): Promise<DataDrivenPrediction[]> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        modelRules: basketballMatches.modelRules,
        teamStats: basketballMatches.teamStats,
        injuries: basketballMatches.injuries,
        recentForm: basketballMatches.recentForm,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.source, source),
          eq(basketballMatches.businessDate, date),
          eq(basketballMatches.matchStatus, 'upcoming'),
          eq(basketballMatches.isPredictionFrozen, false),
        ),
      )
      .orderBy(basketballMatches.kickoffTime);

    return this.computePredictionsForRows(rows);
  }

  async predictByIds(ids: string[]): Promise<DataDrivenPrediction[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        modelRules: basketballMatches.modelRules,
        teamStats: basketballMatches.teamStats,
        injuries: basketballMatches.injuries,
        recentForm: basketballMatches.recentForm,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
      })
      .from(basketballMatches)
      .where(inArray(basketballMatches.id, ids));
    return this.computePredictionsForRows(rows);
  }

  async backtestFinishedByLeague(
    leaguePattern: string,
    limit: number = 50,
  ): Promise<{
    total: number;
    games: Array<{
      matchNo: string;
      homeTeam: string;
      awayTeam: string;
      handicapLine: number;
      totalLine: number;
      homeScore: number;
      awayScore: number;
      actualHandicapCover: 'home' | 'away' | 'push';
      actualTotal: 'over' | 'under' | 'push';
      predictedHandicap: string;
      handicapCoverProb: number;
      predictedTotal: string;
      totalProb: number;
      dataQuality: string;
      recentGamesHome: number;
      recentGamesAway: number;
      computationBasis: string[];
    }>;
    handicapHitRate: number;
    totalHitRate: number;
  }> {
    const finishedRows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        modelRules: basketballMatches.modelRules,
        teamStats: basketballMatches.teamStats,
        injuries: basketballMatches.injuries,
        recentForm: basketballMatches.recentForm,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
      })
      .from(basketballMatches)
      .where(
        and(
          like(basketballMatches.league, `%${leaguePattern}%`),
          eq(basketballMatches.matchStatus, 'finished'),
          isNotNull(basketballMatches.handicapLineNum),
          isNotNull(basketballMatches.totalLineNum),
          isNotNull(basketballMatches.homeScore),
          isNotNull(basketballMatches.awayScore),
        ),
      )
      .orderBy(desc(basketballMatches.kickoffTime))
      .limit(limit);

    const preds = await this.computePredictionsForRows(finishedRows as unknown as ComputationRow[]);

    const games: Array<{
      matchNo: string;
      homeTeam: string;
      awayTeam: string;
      handicapLine: number;
      totalLine: number;
      homeScore: number;
      awayScore: number;
      actualHandicapCover: 'home' | 'away' | 'push';
      actualTotal: 'over' | 'under' | 'push';
      predictedHandicap: string;
      handicapCoverProb: number;
      predictedTotal: string;
      totalProb: number;
      dataQuality: string;
      recentGamesHome: number;
      recentGamesAway: number;
      computationBasis: string[];
    }> = [];

    let handicapHits = 0;
    let totalHits = 0;
    let validHandicap = 0;
    let validTotal = 0;

    for (const row of finishedRows) {
      const pred = preds.find((p) => p.matchId === row.id);
      if (!pred) continue;
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      const hLine = Number(row.handicapLineNum) || 0;
      const tLine = Number(row.totalLineNum) || 0;
      if (hLine === 0 || tLine === 0) continue;

      const spread = hs - as + hLine;
      let actualHc: 'home' | 'away' | 'push' = 'push';
      if (spread > 0) actualHc = 'home';
      else if (spread < 0) actualHc = 'away';

      const total = hs + as;
      let actualOu: 'over' | 'under' | 'push' = 'push';
      if (total > tLine) actualOu = 'over';
      else if (total < tLine) actualOu = 'under';

      const predHc = pred.handicapRecommendation;
      const predOu = pred.totalDirection;

      if (actualHc !== 'push' && predHc !== '观望') {
        validHandicap += 1;
        const predHomeCover = predHc === '让分主胜';
        if ((predHomeCover && actualHc === 'home') || (!predHomeCover && actualHc === 'away')) {
          handicapHits += 1;
        }
      }
      if (actualOu !== 'push' && predOu !== '观望') {
        validTotal += 1;
        const predOver = predOu === '大分';
        if ((predOver && actualOu === 'over') || (!predOver && actualOu === 'under')) {
          totalHits += 1;
        }
      }

      games.push({
        matchNo: row.matchNo || '',
        homeTeam: row.homeTeam || '',
        awayTeam: row.awayTeam || '',
        handicapLine: hLine,
        totalLine: tLine,
        homeScore: hs,
        awayScore: as,
        actualHandicapCover: actualHc,
        actualTotal: actualOu,
        predictedHandicap: predHc,
        handicapCoverProb: pred.handicapCoverProb,
        predictedTotal: predOu,
        totalProb: pred.totalProb,
        dataQuality: pred.dataQuality,
        recentGamesHome: pred.recentFormDetail?.home?.length ?? 0,
        recentGamesAway: pred.recentFormDetail?.away?.length ?? 0,
        computationBasis: pred.computationBasis,
      });
    }

    return {
      total: games.length,
      games,
      handicapHitRate: validHandicap > 0 ? Math.round((handicapHits / validHandicap) * 1000) / 10 : 0,
      totalHitRate: validTotal > 0 ? Math.round((totalHits / validTotal) * 1000) / 10 : 0,
    };
  }

  async backtestFinishedByDateRange(
    startDate: Date,
    endDate: Date,
    source?: string,
  ): Promise<{
    total: number;
    byLeague: Array<{
      league: string;
      total: number;
      wdwHitRate: number;
      wdwCorrect: number;
      wdwTotal: number;
      handicapHitRate: number;
      handicapCorrect: number;
      handicapTotal: number;
      totalHitRate: number;
      totalCorrect: number;
      totalTotal: number;
    }>;
    overall: { wdwHitRate: number; handicapHitRate: number; totalHitRate: number; total: number };
  }> {
    const whereConditions: SQL[] = [
      eq(basketballMatches.matchStatus, 'finished'),
      gte(basketballMatches.kickoffTime, startDate),
      lt(basketballMatches.kickoffTime, endDate),
      isNotNull(basketballMatches.homeScore),
      isNotNull(basketballMatches.awayScore),
    ];
    if (source) {
      whereConditions.push(eq(basketballMatches.source, source));
    }

    const finishedRows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        modelRules: basketballMatches.modelRules,
        teamStats: basketballMatches.teamStats,
        injuries: basketballMatches.injuries,
        recentForm: basketballMatches.recentForm,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
      })
      .from(basketballMatches)
      .where(and(...whereConditions))
      .orderBy(basketballMatches.kickoffTime);

    const preds = await this.computePredictionsForRows(finishedRows as unknown as ComputationRow[]);

    type LeagueStat = {
      league: string;
      total: number;
      wdwCorrect: number;
      wdwTotal: number;
      handicapCorrect: number;
      handicapTotal: number;
      totalCorrect: number;
      totalTotal: number;
    };
    const leagueMap = new Map<string, LeagueStat>();

    let overallWdwCorrect = 0;
    let overallWdwTotal = 0;
    let overallHandicapCorrect = 0;
    let overallHandicapTotal = 0;
    let overallTotalCorrect = 0;
    let overallTotalTotal = 0;

    for (const row of finishedRows) {
      const pred = preds.find((p) => p.matchId === row.id);
      if (!pred) continue;
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      const hLine = Number(row.handicapLineNum) || 0;
      const tLine = Number(row.totalLineNum) || 0;
      const league = row.league || 'unknown';

      const stat = leagueMap.get(league) ?? {
        league,
        total: 0,
        wdwCorrect: 0,
        wdwTotal: 0,
        handicapCorrect: 0,
        handicapTotal: 0,
        totalCorrect: 0,
        totalTotal: 0,
      };
      stat.total += 1;

      const homeWin = hs > as;
      const predHomeWin = pred.homeWinProb >= 50;
      stat.wdwTotal += 1;
      overallWdwTotal += 1;
      if (homeWin === predHomeWin) {
        stat.wdwCorrect += 1;
        overallWdwCorrect += 1;
      }

      if (hLine !== 0) {
        const spread = hs - as + hLine;
        if (spread !== 0) {
          const homeCover = spread > 0;
          const predHomeCover = pred.handicapRecommendation === '让分主胜';
          stat.handicapTotal += 1;
          overallHandicapTotal += 1;
          if (homeCover === predHomeCover) {
            stat.handicapCorrect += 1;
            overallHandicapCorrect += 1;
          }
        }
      }

      if (tLine > 0) {
        const totalScore = hs + as;
        if (totalScore !== tLine) {
          const over = totalScore > tLine;
          const predOver = pred.totalDirection === '大分';
          stat.totalTotal += 1;
          overallTotalTotal += 1;
          if (over === predOver) {
            stat.totalCorrect += 1;
            overallTotalCorrect += 1;
          }
        }
      }

      leagueMap.set(league, stat);
    }

    type LeagueStatWithRate = LeagueStat & {
      wdwHitRate: number;
      handicapHitRate: number;
      totalHitRate: number;
    };
    const byLeague: LeagueStatWithRate[] = [];
    for (const stat of leagueMap.values()) {
      byLeague.push({
        ...stat,
        wdwHitRate: stat.wdwTotal > 0 ? Math.round((stat.wdwCorrect / stat.wdwTotal) * 1000) / 10 : 0,
        handicapHitRate: stat.handicapTotal > 0 ? Math.round((stat.handicapCorrect / stat.handicapTotal) * 1000) / 10 : 0,
        totalHitRate: stat.totalTotal > 0 ? Math.round((stat.totalCorrect / stat.totalTotal) * 1000) / 10 : 0,
      });
    }
    byLeague.sort((a: LeagueStatWithRate, b: LeagueStatWithRate) => b.total - a.total);

    const total = finishedRows.length;
    const overall = {
      wdwHitRate: overallWdwTotal > 0 ? Math.round((overallWdwCorrect / overallWdwTotal) * 1000) / 10 : 0,
      handicapHitRate: overallHandicapTotal > 0 ? Math.round((overallHandicapCorrect / overallHandicapTotal) * 1000) / 10 : 0,
      totalHitRate: overallTotalTotal > 0 ? Math.round((overallTotalCorrect / overallTotalTotal) * 1000) / 10 : 0,
      total,
    };

    return { total, byLeague, overall };
  }

  async applyPredictions(
    preds: DataDrivenPrediction[],
    options: { force?: boolean } = {},
  ): Promise<{ updated: number; skippedLocked: number; errors: number; stabilized: number }> {
    let updated = 0;
    let skippedLocked = 0;
    let errors = 0;
    let stabilized = 0;

    const HYSTERESIS_LOW = 45;
    const HYSTERESIS_HIGH = 55;

    for (const p of preds) {
      if (p.isOfficialLocked) {
        skippedLocked += 1;
        continue;
      }
      try {
        const [existing] = await this.db.select({
          handicapPick: basketballMatches.handicapPick,
          handicapCoverProb: basketballMatches.handicapCoverProb,
          totalPick: basketballMatches.totalPick,
          overProb: basketballMatches.overProb,
          predictionDirection: basketballMatches.predictionDirection,
          homeWinProb: basketballMatches.homeWinProb,
          predEngineVersion: basketballMatches.predEngineVersion,
        })
          .from(basketballMatches)
          .where(eq(basketballMatches.id, p.matchId))
          .limit(1);

        const oldHcp = existing?.handicapPick ?? null;
        const oldTotal = existing?.totalPick ?? null;
        const oldWdw = null;
        const oldHcpProb = Number(existing?.handicapCoverProb ?? 0);
        const oldOverProb = Number(existing?.overProb ?? 0);
        const oldEngineIsDataDriven = existing?.predEngineVersion?.startsWith('data-driven') ?? false;

        let hcpRec = p.handicapRecommendation;
        let hcpCoverProb = p.handicapCoverProb;
        let hcpConf = p.handicapConfidence;
        let hcpStabilized = false;

        const hcpNonWatch = oldHcp && oldHcp !== '观望' && oldHcp !== '待线值' && oldHcp !== '' && oldHcp !== '未知';
        if (!options.force && oldEngineIsDataDriven && hcpNonWatch && hcpRec !== oldHcp && hcpCoverProb >= HYSTERESIS_LOW && hcpCoverProb <= HYSTERESIS_HIGH) {
          hcpRec = oldHcp;
          hcpCoverProb = Math.max(HYSTERESIS_LOW + 1, Math.min(HYSTERESIS_HIGH - 1, oldHcpProb || 51));
          hcpConf = '低';
          hcpStabilized = true;
          stabilized += 1;
        }

        let totalDir = p.totalDirection;
        let totalProb = p.totalProb;
        let totalConf = p.totalConfidence;

        let totalStabilized = false;
        const totalNonWatch = oldTotal && oldTotal !== '观望' && oldTotal !== '待线值' && oldTotal !== '' && oldTotal !== '未知';
        if (!options.force && oldEngineIsDataDriven && totalNonWatch && totalDir !== oldTotal && totalProb >= HYSTERESIS_LOW && totalProb <= HYSTERESIS_HIGH) {
          totalDir = oldTotal as '大分' | '小分';
          totalProb = Math.max(HYSTERESIS_LOW + 1, Math.min(HYSTERESIS_HIGH - 1, oldOverProb || 51));
          totalConf = '低';
          totalStabilized = true;
          if (!hcpStabilized) stabilized += 1;
        }

        // 胜负方向 hysteresis：旧方向非观望且新概率在阈值区间内→保持旧方向
        // 注意：保持方向但不回退概率到旧值，避免恰50/50时两端相等被判未分析
        const wdwNonWatch = oldWdw && oldWdw !== '观望' && oldWdw !== '待线值' && oldWdw !== '' && oldWdw !== '未知';
        let wdwDir = p.homeWinProb >= 50 ? '主胜' : '客胜';
        let wdwHomeProb = p.homeWinProb;
        let wdwStabilized = false;
        if (!options.force && wdwNonWatch && wdwDir !== oldWdw && wdwHomeProb >= HYSTERESIS_LOW && wdwHomeProb <= HYSTERESIS_HIGH) {
          wdwDir = oldWdw as '主胜' | '客胜';
          // 方向翻转但保持概率倾斜：旧方向是主胜则给51，客胜则给49
          // 不使用旧值50，避免两端相等导致前端判定为未分析
          if (wdwDir === '主胜' && wdwHomeProb <= 50) wdwHomeProb = 51;
          if (wdwDir === '客胜' && wdwHomeProb >= 50) wdwHomeProb = 49;
          if (!hcpStabilized && !totalStabilized) stabilized += 1;
          wdwStabilized = true;
        }

        // 最终保障：写入前确保homeWinProb永远不为50，避免两端相等被判未分析
        // 恰50/50时按modelExpectedSpread方向倾斜；spread为0时按handicapLine方向
        let wdwCriticalAdjusted = false;
        if (wdwHomeProb === 50) {
          if (p.modelExpectedSpread > 0) wdwHomeProb = 51;
          else if (p.modelExpectedSpread < 0) wdwHomeProb = 49;
          else if (p.handicapLineNum < 0) wdwHomeProb = 49;
          else wdwHomeProb = 51;
          wdwDir = wdwHomeProb > 50 ? '主胜' : '客胜';
          wdwCriticalAdjusted = true;
          if (!wdwStabilized) stabilized += 1;
        }

        const patch = {
          homeWinProb: wdwHomeProb,
          awayWinProb: 100 - wdwHomeProb,
          predictionDirection: wdwDir,
          confidence: p.confidence,
          handicapRecommendation: hcpRec,
          handicapPick: hcpRec,
          handicapCoverProb: hcpCoverProb,
          handicapPickProb: Math.round(hcpRec === '让分主胜' ? hcpCoverProb : 100 - hcpCoverProb),
          handicapConfidence: hcpConf,
          totalDirection: totalDir,
          overProb: Math.round(totalProb),
          underProb: Math.round(100 - totalProb),
          totalPick: totalDir,
          totalPickProb: Math.round(totalDir === '大分' ? totalProb : 100 - totalProb),
          ouConfidence: totalConf,
          predictedHomeScore: Math.round(p.modelExpectedTotal / 2 + p.modelExpectedSpread / 2),
          predictedAwayScore: Math.round(p.modelExpectedTotal / 2 - p.modelExpectedSpread / 2),
          predictedTotal: String(p.modelExpectedTotal),
          eloHome: p.eloHome != null ? String(p.eloHome) : null,
          eloAway: p.eloAway != null ? String(p.eloAway) : null,
          eloGap: (p.eloHome != null && p.eloAway != null) ? String(p.eloHome - p.eloAway) : null,
           modelRules: (() => {
               const rules = [
                  `数据驱动预测 v10.1（${p.leagueKey}基准总分${Math.round(p.baselineTotal)}分）`,
                 `数据质量: ${p.dataQuality}`,
                 `样本量: 主${p.eloMatchesHome}场/客${p.eloMatchesAway}场`,
                 ...p.computationBasis.slice(0, 6),
               ];
              const hcpPickProb2 = hcpRec === '让分主胜' ? hcpCoverProb : 100 - hcpCoverProb;
              const isHcpCritical = hcpPickProb2 >= 45 && hcpPickProb2 <= 55 && p.handicapLineNum !== 0;
              const tPickProb2 = totalDir === '大分' ? totalProb : 100 - totalProb;
              const isTotalCritical = tPickProb2 >= 45 && tPickProb2 <= 55 && p.totalLineNum > 0;
               const isWdwCriticalForRules = wdwCriticalAdjusted || (Math.abs(wdwHomeProb - 50) <= 5 && Math.abs(wdwHomeProb - 50) > 0);
               if (isHcpCritical || isTotalCritical || isWdwCriticalForRules) rules.push('临界场次：概率接近50%，方向参考性有限');
              const isLowSampleBaseline = p.computationBasis.some((b: string) => b.includes('低样本基线推导'));
              if (isLowSampleBaseline) rules.push('低样本基线推导：方向由主场优势vs让分线机械决定，参考性有限');
              return sql`array[${sql.join(rules.map((s: string) => sql`${s}`), sql`, `)}]::text[]`;
            })(),
          advancedDataReady: p.dataQuality !== 'low',
          advancedDataNotice: p.missingData.length > 0 ? `缺: ${p.missingData.join('、')}` : null,
           riskWarning: (() => {
              const warnings: string[] = [];
              if (p.lowSampleRisk) warnings.push('新赛季样本不足，预测参考性有限');
              const hcpPickProb = hcpRec === '让分主胜' ? hcpCoverProb : 100 - hcpCoverProb;
              const isHcpCritical = hcpPickProb >= 45 && hcpPickProb <= 55 && p.handicapLineNum !== 0;
              const tPickProb = totalDir === '大分' ? totalProb : 100 - totalProb;
              const isTotalCritical = tPickProb >= 45 && tPickProb <= 55 && p.totalLineNum > 0;
              const isWdwCritical = wdwCriticalAdjusted || (Math.abs(wdwHomeProb - 50) <= 5 && Math.abs(wdwHomeProb - 50) > 0);
              if (isHcpCritical || isTotalCritical || isWdwCritical) warnings.push('临界场次，参考性有限');
              const isLowSampleBaseline = p.computationBasis.some((b: string) => b.includes('低样本基线推导'));
              if (isLowSampleBaseline) warnings.push('低样本下方向由基线机械推导，参考性有限');
              return warnings.join('；');
            })(),
          recentFormDetail: p.recentFormDetail as unknown as Record<string, unknown>,
          h2hHistory: p.h2h != null && p.h2h.length > 0
            ? (p.h2h as unknown as Record<string, unknown>[])
            : null,
           predEngineVersion: 'data-driven-v10.1',
           predictionAnchor: 'data_driven',
           predGeneratedAt: new Date(),
           updatedAt: sql`CURRENT_TIMESTAMP`,
         };
        this.appendPredictionHistory(patch as Record<string, unknown>, 'data_driven_recalc');
        await this.db.update(basketballMatches)
          .set(patch)
          .where(eq(basketballMatches.id, p.matchId));
        updated += 1;
      } catch (e) {
        errors += 1;
        let errMsg = e instanceof Error ? e.message : String(e);
        let errStack = e instanceof Error ? e.stack : String(e);
        let cause: unknown = e instanceof Error ? e.cause : undefined;
        let depth = 0;
        while (cause && depth < 5) {
          const causeMsg = cause instanceof Error ? cause.message : String(cause);
          errMsg += ` [cause${depth}: ${causeMsg}]`;
          cause = cause instanceof Error ? cause.cause : undefined;
          depth += 1;
        }
        this.logger.error(`应用预测失败 ${p.matchNo}: ${errMsg}`, errStack);
      }
    }

    return { updated, skippedLocked, errors, stabilized };
  }

  /**
   * 线值变动触发的单场/批量重算。
   * 只在让分方向或大小分方向实际变化时写入，避免纯概率波动导致的无意义更新。
   */
  async recalcByLineTrigger(
    inputs: LineRecalcInput[],
    db?: PostgresJsDatabase,
  ): Promise<LineRecalcOutcome[]> {
    const dbs = db ?? this.db;
    const outcomes: LineRecalcOutcome[] = [];

    // 按 id 批量查符合条件的行
    const ids = inputs.map((input) => input.matchId).filter(Boolean);
    const matchMap = new Map<string, {
      id: string;
      matchNo: string | null;
      league: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      kickoffTime: Date;
      matchStatus: string | null;
      modelRules: unknown;
      teamStats: unknown;
      injuries: unknown;
      recentForm: unknown;
      handicapLineNum: unknown;
      totalLineNum: unknown;
      homeWinOdds: unknown;
      awayWinOdds: unknown;
      predEngineVersion: string | null;
      handicapRecommendation: string | null;
      handicapCoverProb: number | null;
      totalDirection: string | null;
      overProb: number | null;
      confidence: number | null;
      ouConfidence: string | null;
      handicapConfidence: string | null;
      predictionSnapshotHandicapLine: unknown;
      predictionSnapshotTotalLine: unknown;
      oddsMovements: unknown;
    }>();

    if (ids.length > 0) {
      const rows = await dbs
        .select({
          id: basketballMatches.id,
          matchNo: basketballMatches.matchNo,
          league: basketballMatches.league,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          kickoffTime: basketballMatches.kickoffTime,
          matchStatus: basketballMatches.matchStatus,
          modelRules: basketballMatches.modelRules,
          teamStats: basketballMatches.teamStats,
          injuries: basketballMatches.injuries,
          recentForm: basketballMatches.recentForm,
          handicapLineNum: basketballMatches.handicapLineNum,
          totalLineNum: basketballMatches.totalLineNum,
          homeWinOdds: basketballMatches.homeWinOdds,
          awayWinOdds: basketballMatches.awayWinOdds,
          predEngineVersion: basketballMatches.predEngineVersion,
          handicapRecommendation: basketballMatches.handicapRecommendation,
          handicapCoverProb: basketballMatches.handicapCoverProb,
          totalDirection: basketballMatches.totalDirection,
          overProb: basketballMatches.overProb,
          confidence: basketballMatches.confidence,
          ouConfidence: basketballMatches.ouConfidence,
          handicapConfidence: basketballMatches.handicapConfidence,
          predictionSnapshotHandicapLine: basketballMatches.predictionSnapshotHandicapLine,
          predictionSnapshotTotalLine: basketballMatches.predictionSnapshotTotalLine,
          oddsMovements: basketballMatches.oddsMovements,
        })
        .from(basketballMatches)
        .where(
          and(
            inArray(basketballMatches.id, ids),
            eq(basketballMatches.matchStatus, 'upcoming'),
            like(basketballMatches.predEngineVersion, 'data-driven%'),
          ),
        );
      for (const row of rows) {
        matchMap.set(row.id, row);
      }
    }

    type RecalcMatchRow = {
      id: string;
      matchNo: string | null;
      league: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      kickoffTime: Date;
      matchStatus: string | null;
      modelRules: unknown;
      teamStats: unknown;
      injuries: unknown;
      recentForm: unknown;
      handicapLineNum: unknown;
      totalLineNum: unknown;
      homeWinOdds: unknown;
      awayWinOdds: unknown;
      predEngineVersion: string | null;
      handicapRecommendation: string | null;
      handicapCoverProb: number | null;
      totalDirection: string | null;
      overProb: number | null;
      confidence: number | null;
      ouConfidence: string | null;
      handicapConfidence: string | null;
      predictionSnapshotHandicapLine: unknown;
      predictionSnapshotTotalLine: unknown;
      oddsMovements: unknown;
    };
    // 收集需要重算的行（未被跳过的）
    const toCompute: Array<{ input: LineRecalcInput; matchRow: RecalcMatchRow; before: LineRecalcOutcome['before'] }> = [];

    for (const input of inputs) {
      const match = matchMap.get(input.matchId);
      if (!match) {
        outcomes.push({
          matchId: input.matchId,
          matchNo: input.matchNo ?? '',
          before: {
            handicapRecommendation: null,
            handicapCoverProb: null,
            totalDirection: null,
            overProb: null,
            confidence: null,
            ouConfidence: null,
          },
          after: null,
          applied: false,
          skippedReason: '场次不存在或不符合 upcoming + data-driven 条件',
          recalcReason: null,
        });
        continue;
      }

      const rowRules = (match.modelRules as unknown as string[] | null) ?? [];
      const isOfficialLocked = rowRules.some((r) => r.includes('官方数据锁定'));
      if (isOfficialLocked) {
        outcomes.push({
          matchId: match.id,
          matchNo: match.matchNo ?? '',
          before: {
            handicapRecommendation: match.handicapRecommendation,
            handicapCoverProb: match.handicapCoverProb,
            totalDirection: match.totalDirection,
            overProb: match.overProb,
            confidence: match.confidence,
            ouConfidence: match.ouConfidence,
          },
          after: null,
          applied: false,
          skippedReason: '官方数据锁定，跳过重算',
          recalcReason: null,
        });
        continue;
      }

      const before: LineRecalcOutcome['before'] = {
        handicapRecommendation: match.handicapRecommendation,
        handicapCoverProb: match.handicapCoverProb,
        totalDirection: match.totalDirection,
        overProb: match.overProb,
        confidence: match.confidence,
        ouConfidence: match.ouConfidence,
      };

      toCompute.push({ input, matchRow: match, before });
    }

    if (toCompute.length === 0) return outcomes;

    // 构造计算行并批量计算
    const computeRows: ComputationRow[] = toCompute.map((item) => ({
      id: item.matchRow.id,
      matchNo: item.matchRow.matchNo,
      league: item.matchRow.league,
      homeTeam: item.matchRow.homeTeam,
      awayTeam: item.matchRow.awayTeam,
      kickoffTime: item.matchRow.kickoffTime,
      matchStatus: item.matchRow.matchStatus,
      modelRules: item.matchRow.modelRules,
      teamStats: item.matchRow.teamStats,
      injuries: item.matchRow.injuries,
      recentForm: item.matchRow.recentForm,
      handicapLineNum: item.matchRow.handicapLineNum,
      totalLineNum: item.matchRow.totalLineNum,
      homeWinOdds: item.matchRow.homeWinOdds,
      awayWinOdds: item.matchRow.awayWinOdds,
    }));

    const predictions = await this.computePredictionsForRows(computeRows, dbs);
    const predMap = new Map<string, DataDrivenPrediction>();
    for (const p of predictions) {
      predMap.set(p.matchId, p);
    }

    // 逐个对比并决定是否写入
    const outcomeByIndex: Map<number, LineRecalcOutcome> = new Map();

    for (let i = 0; i < toCompute.length; i += 1) {
      const item = toCompute[i];
      const pred = predMap.get(item.matchRow.id);

      if (!pred) {
        outcomeByIndex.set(i, {
          matchId: item.matchRow.id,
          matchNo: item.matchRow.matchNo ?? '',
          before: item.before,
          after: null,
          applied: false,
          skippedReason: '预测计算失败',
          recalcReason: null,
        });
        continue;
      }

      const after: LineRecalcOutcome['after'] = {
        handicapRecommendation: pred.handicapRecommendation,
        handicapCoverProb: pred.handicapCoverProb,
        totalDirection: pred.totalDirection,
        overProb: pred.totalProb,
        confidence: pred.confidence,
        ouConfidence: pred.totalConfidence,
      };

      const hcpChanged = item.before.handicapRecommendation !== pred.handicapRecommendation
        && item.before.handicapRecommendation !== null
        && item.before.handicapRecommendation !== '';
      const totalChanged = item.before.totalDirection !== pred.totalDirection
        && item.before.totalDirection !== null
        && item.before.totalDirection !== '';

      if (!hcpChanged && !totalChanged) {
        outcomeByIndex.set(i, {
          matchId: item.matchRow.id,
          matchNo: item.matchRow.matchNo ?? '',
          before: item.before,
          after,
          applied: false,
          skippedReason: '方向未变化，跳过写入',
          recalcReason: null,
        });
        continue;
      }

      // 构建重算原因字符串
      const reasonParts: string[] = [];

      const snapshotHcp = Number(item.matchRow.predictionSnapshotHandicapLine);
      const currentHcp = Number(item.matchRow.handicapLineNum) || 0;
      if (hcpChanged) {
        if (snapshotHcp > 0 && currentHcp > 0 && Math.abs(snapshotHcp - currentHcp) > 1e-9) {
          reasonParts.push(`让分 ${snapshotHcp}→${currentHcp}`);
        } else {
          // fallback: 从 oddsMovements 找第一条 handicap_line 变动
          const movements = (item.matchRow.oddsMovements as Array<{ type: string; oldValue: string; newValue: string }> | null) ?? [];
          const hcpMove = movements.find((m) => m.type === 'handicap_line');
          if (hcpMove) {
            reasonParts.push(`让分 ${hcpMove.oldValue}→${hcpMove.newValue}`);
          } else {
            reasonParts.push(`让分线值变动`);
          }
        }
      }

      const snapshotTotal = Number(item.matchRow.predictionSnapshotTotalLine);
      const currentTotal = Number(item.matchRow.totalLineNum) || 0;
      if (totalChanged) {
        if (snapshotTotal > 0 && currentTotal > 0 && Math.abs(snapshotTotal - currentTotal) > 1e-9) {
          reasonParts.push(`大小分 ${snapshotTotal}→${currentTotal}`);
        } else {
          const movements = (item.matchRow.oddsMovements as Array<{ type: string; oldValue: string; newValue: string }> | null) ?? [];
          const totalMove = movements.find((m) => m.type === 'total_line');
          if (totalMove) {
            reasonParts.push(`大小分 ${totalMove.oldValue}→${totalMove.newValue}`);
          } else {
            reasonParts.push(`大小分线值变动`);
          }
        }
      }

      const recalcReason = reasonParts.length > 0
        ? `线值变动触发：${reasonParts.join('；')}`
        : '线值变动触发';

      // 构建 patch，只写变化的组 + 通用字段
      const patch: Record<string, unknown> = {};

      if (hcpChanged) {
        patch.handicapRecommendation = pred.handicapRecommendation;
        patch.handicapPick = pred.handicapRecommendation;
        patch.handicapCoverProb = Math.round(pred.handicapCoverProb);
        patch.handicapPickProb = Math.round(pred.handicapCoverProb);
        patch.handicapConfidence = pred.handicapConfidence;
      }

      if (totalChanged) {
        patch.totalDirection = pred.totalDirection;
        patch.overProb = Math.round(pred.totalProb);
        patch.underProb = Math.round(100 - pred.totalProb);
        patch.totalPick = pred.totalDirection;
        patch.totalPickProb = Math.round(pred.totalProb);
        patch.ouConfidence = pred.totalConfidence;
      }

      patch.predictionRecalcReason = recalcReason;
      patch.predictionRecalcAt = new Date();
      patch.updatedAt = sql`CURRENT_TIMESTAMP`;

      this.appendPredictionHistory(patch as Record<string, unknown>, 'data_driven_backtest_recalc');
      // 写入并校验
      const updated = await dbs.update(basketballMatches)
        .set(patch)
        .where(eq(basketballMatches.id, item.matchRow.id))
        .returning({ id: basketballMatches.id });

      outcomeByIndex.set(i, {
        matchId: item.matchRow.id,
        matchNo: item.matchRow.matchNo ?? '',
        before: item.before,
        after,
        applied: updated.length > 0,
        skippedReason: updated.length > 0 ? null : '写入未生效',
        recalcReason,
      });
    }

    // 按输入顺序组装返回
    const finalOutcomes: LineRecalcOutcome[] = [];
    const skippedMap = new Map<string, LineRecalcOutcome>();
    for (const o of outcomes) {
      skippedMap.set(o.matchId, o);
    }

    for (const input of inputs) {
      const skipped = skippedMap.get(input.matchId);
      if (skipped) {
        finalOutcomes.push(skipped);
        continue;
      }
      const idx = toCompute.findIndex((c) => c.input.matchId === input.matchId);
      const computed = idx >= 0 ? outcomeByIndex.get(idx) : undefined;
      if (computed) {
        finalOutcomes.push(computed);
      } else {
        finalOutcomes.push({
          matchId: input.matchId,
          matchNo: input.matchNo ?? '',
          before: {
            handicapRecommendation: null,
            handicapCoverProb: null,
            totalDirection: null,
            overProb: null,
            confidence: null,
            ouConfidence: null,
          },
          after: null,
          applied: false,
          skippedReason: '未找到匹配项',
          recalcReason: null,
        });
      }
    }

    return finalOutcomes;
  }
}
