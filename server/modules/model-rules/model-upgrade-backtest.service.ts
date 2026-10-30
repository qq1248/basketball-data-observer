import { Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject } from '@nestjs/common';
import { basketballMatches, matches } from '@server/database/schema';
import { eq, sql } from 'drizzle-orm';
import { BasketballEfficiencyService } from '@server/modules/basketball/basketball-efficiency.service';
import { FootballPoissonService } from '@server/modules/sporttery/football-poisson.service';

export interface ModelUpgradeBacktestItem {
  dimension: string;
  oldHitRate: number | null;
  newHitRate: number | null;
  oldTotal: number;
  newTotal: number;
  delta: number | null;
  sampleNote: string;
}

export interface ModelUpgradeBacktestResponse {
  sport: 'basketball' | 'football';
  totalFinished: number;
  withModelData: number;
  items: ModelUpgradeBacktestItem[];
  summary: string;
  generatedAt: string;
}

interface BbFinishedRow {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  handicapLineNum: string | null;
  totalLineNum: string | null;
  predictionDirection: string;
  handicapRecommendation: string;
  totalDirection: string;
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
  teamStats: { home?: Record<string, string | number>; away?: Record<string, string | number> } | null;
  confidence: number | null;
}

interface FootballFinishedRow {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  homeGoalsAvg: string | null;
  awayGoalsAvg: string | null;
  homeConcededAvg: string | null;
  awayConcededAvg: string | null;
  oddsHome: string;
  oddsDraw: string;
  oddsAway: string;
  handicapNum: string | null;
  totalGoals: string | null;
  predictionDirection: string;
  handicapRecommendation: string;
  totalPick: string;
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
}

@Injectable()
export class ModelUpgradeBacktestService {
  private readonly logger = new Logger(ModelUpgradeBacktestService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly bbEfficiency: BasketballEfficiencyService,
    private readonly footballPoisson: FootballPoissonService,
  ) {}

  async runBasketballBacktest(): Promise<ModelUpgradeBacktestResponse> {
    const rows = await this.db.execute(sql`
      SELECT
        id::text,
        league,
        home_team AS "homeTeam",
        away_team AS "awayTeam",
        home_score AS "homeScore",
        away_score AS "awayScore",
        COALESCE(handicap_line_num::text, '') AS "handicapLineNum",
        COALESCE(total_line_num::text, '') AS "totalLineNum",
        COALESCE(prediction_direction, '') AS "predictionDirection",
        COALESCE(handicap_recommendation, '') AS "handicapRecommendation",
        COALESCE(total_direction, '') AS "totalDirection",
        hit_wdw AS "hitWdw",
        hit_handicap AS "hitHandicap",
        hit_overunder AS "hitOverunder",
        team_stats AS "teamStats",
        confidence
      FROM basketball_matches
      WHERE match_status = 'finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
      ORDER BY kickoff_time DESC
      LIMIT 200
    `) as unknown as BbFinishedRow[];

    const totalFinished = rows.length;
    const withStats = rows.filter((r: BbFinishedRow) => {
      const ts = r.teamStats;
      return ts && ts.home && ts.away &&
        Number(ts.home.pointsPerGame || ts.home['Points Per Game'] || 0) > 0 &&
        Number(ts.away.pointsPerGame || ts.away['Points Per Game'] || 0) > 0;
    });

    const withModelData = withStats.length;

    let oldWdwHit = 0, oldWdwTotal = 0;
    let oldHcpHit = 0, oldHcpTotal = 0;
    let oldOuHit = 0, oldOuTotal = 0;
    let newWdwHit = 0, newWdwTotal = 0;
    let newHcpHit = 0, newHcpTotal = 0;
    let newOuHit = 0, newOuTotal = 0;

    for (const row of rows) {
      if (row.predictionDirection && row.predictionDirection !== '观望' && row.hitWdw !== null) {
        oldWdwTotal += 1;
        if (row.hitWdw) oldWdwHit += 1;
      }
      if (row.handicapRecommendation && row.handicapRecommendation !== '观望' && row.hitHandicap !== null) {
        oldHcpTotal += 1;
        if (row.hitHandicap) oldHcpHit += 1;
      }
      if (row.totalDirection && row.totalDirection !== '观望' && row.hitOverunder !== null) {
        oldOuTotal += 1;
        if (row.hitOverunder) oldOuHit += 1;
      }
    }

    for (const row of withStats) {
      if (!row.teamStats || !row.teamStats.home || !row.teamStats.away) continue;
      if (row.homeScore === null || row.awayScore === null) continue;

      const effResult = this.bbEfficiency.predictGame(
        row.teamStats.home,
        row.teamStats.away,
        row.league,
      );
      if (!effResult) continue;

      const actualHomeScore = row.homeScore;
      const actualAwayScore = row.awayScore;
      const actualSpread = actualHomeScore - actualAwayScore;
      const actualTotal = actualHomeScore + actualAwayScore;

      const newWdwPick = effResult.expectedSpread >= 0 ? '主胜' : '客胜';
      const wdwHit = (newWdwPick === '主胜' && actualSpread > 0) ||
        (newWdwPick === '客胜' && actualSpread < 0);
      newWdwTotal += 1;
      if (wdwHit) newWdwHit += 1;

      const hLine = Number(row.handicapLineNum);
      if (hLine !== 0 && isFinite(hLine)) {
        const actualCover = actualSpread + hLine;
        let newHcpPick: string;
        if (effResult.expectedSpread + 2 < -hLine) {
          newHcpPick = '让分客胜';
        } else if (effResult.expectedSpread - 2 > -hLine) {
          newHcpPick = '让分主胜';
        } else {
          newHcpPick = '观望';
        }
        if (newHcpPick !== '观望') {
          const hcpHit = (newHcpPick === '让分主胜' && actualCover > 0) ||
            (newHcpPick === '让分客胜' && actualCover < 0);
          newHcpTotal += 1;
          if (hcpHit) newHcpHit += 1;
        }
      }

      const tLine = Number(row.totalLineNum);
      if (tLine !== 0 && isFinite(tLine)) {
        let newOuPick: string;
        const diff = effResult.expectedTotal - tLine;
        if (Math.abs(diff) >= 3) {
          newOuPick = diff > 0 ? '大分' : '小分';
        } else {
          newOuPick = '观望';
        }
        if (newOuPick !== '观望') {
          const ouHit = (newOuPick === '大分' && actualTotal > tLine) ||
            (newOuPick === '小分' && actualTotal < tLine);
          newOuTotal += 1;
          if (ouHit) newOuHit += 1;
        }
      }
    }

    const oldWdwRate = oldWdwTotal > 0 ? Math.round((oldWdwHit / oldWdwTotal) * 1000) / 10 : null;
    const oldHcpRate = oldHcpTotal > 0 ? Math.round((oldHcpHit / oldHcpTotal) * 1000) / 10 : null;
    const oldOuRate = oldOuTotal > 0 ? Math.round((oldOuHit / oldOuTotal) * 1000) / 10 : null;
    const newWdwRate = newWdwTotal > 0 ? Math.round((newWdwHit / newWdwTotal) * 1000) / 10 : null;
    const newHcpRate = newHcpTotal > 0 ? Math.round((newHcpHit / newHcpTotal) * 1000) / 10 : null;
    const newOuRate = newOuTotal > 0 ? Math.round((newOuHit / newOuTotal) * 1000) / 10 : null;

    const items: ModelUpgradeBacktestItem[] = [
      {
        dimension: '胜负',
        oldHitRate: oldWdwRate,
        newHitRate: newWdwRate,
        oldTotal: oldWdwTotal,
        newTotal: newWdwTotal,
        delta: newWdwRate !== null && oldWdwRate !== null ? Math.round((newWdwRate - oldWdwRate) * 10) / 10 : null,
        sampleNote: `旧模型${oldWdwTotal}场 / 效率模型${newWdwTotal}场（仅含teamStats数据场次）`,
      },
      {
        dimension: '让分',
        oldHitRate: oldHcpRate,
        newHitRate: newHcpRate,
        oldTotal: oldHcpTotal,
        newTotal: newHcpTotal,
        delta: newHcpRate !== null && oldHcpRate !== null ? Math.round((newHcpRate - oldHcpRate) * 10) / 10 : null,
        sampleNote: `旧模型${oldHcpTotal}场 / 效率模型${newHcpTotal}场`,
      },
      {
        dimension: '大小分',
        oldHitRate: oldOuRate,
        newHitRate: newOuRate,
        oldTotal: oldOuTotal,
        newTotal: newOuTotal,
        delta: newOuRate !== null && oldOuRate !== null ? Math.round((newOuRate - oldOuRate) * 10) / 10 : null,
        sampleNote: `旧模型${oldOuTotal}场 / Pace+效率${newOuTotal}场`,
      },
    ];

    const avgDelta = items
      .filter((i: ModelUpgradeBacktestItem) => i.delta !== null)
      .reduce((s: number, i: ModelUpgradeBacktestItem) => s + (i.delta || 0), 0) / 3;

    return {
      sport: 'basketball',
      totalFinished,
      withModelData,
      items,
      summary: `篮球效率模型回测：${withModelData}场有teamStats数据，三维度平均变化${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}%`,
      generatedAt: new Date().toISOString(),
    };
  }

  async runFootballBacktest(): Promise<ModelUpgradeBacktestResponse> {
    const rows = await this.db.execute(sql`
      SELECT
        id::text,
        league,
        home_team AS "homeTeam",
        away_team AS "awayTeam",
        home_score AS "homeScore",
        away_score AS "awayScore",
        home_goals_avg AS "homeGoalsAvg",
        away_goals_avg AS "awayGoalsAvg",
        home_conceded_avg AS "homeConcededAvg",
        away_conceded_avg AS "awayConcededAvg",
        COALESCE(odds_open_home::text, '') AS "oddsHome",
        COALESCE(odds_open_draw::text, '') AS "oddsDraw",
        COALESCE(odds_open_away::text, '') AS "oddsAway",
        COALESCE(handicap::text, '') AS "handicapNum",
        COALESCE(total_goals::text, '') AS "totalGoals",
        COALESCE(prediction_direction, '') AS "predictionDirection",
        COALESCE(handicap_recommendation, '') AS "handicapRecommendation",
        COALESCE(total_pick, '') AS "totalPick",
        hit_wdw AS "hitWdw",
        hit_handicap AS "hitHandicap",
        hit_overunder AS "hitOverunder"
      FROM matches
      WHERE match_status = 'finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND home_goals_avg IS NOT NULL
        AND away_goals_avg IS NOT NULL
        AND home_conceded_avg IS NOT NULL
        AND away_conceded_avg IS NOT NULL
      ORDER BY kickoff_time DESC
      LIMIT 2000
    `) as unknown as FootballFinishedRow[];
    const totalFinished = rows.length;
    const withModelData = rows.filter((r: FootballFinishedRow) =>
      Number(r.homeGoalsAvg) > 0 && Number(r.awayGoalsAvg) > 0 &&
      Number(r.homeConcededAvg) > 0 && Number(r.awayConcededAvg) > 0,
    ).length;

    let oldWdwHit = 0, oldWdwTotal = 0;
    let oldHcpHit = 0, oldHcpTotal = 0;
    let oldOuHit = 0, oldOuTotal = 0;
    let newWdwHit = 0, newWdwTotal = 0;
    let newHcpHit = 0, newHcpTotal = 0;
    let newOuHit = 0, newOuTotal = 0;

    for (const row of rows) {
      if (row.predictionDirection && row.predictionDirection !== '观望' && row.hitWdw !== null) {
        oldWdwTotal += 1;
        if (row.hitWdw) oldWdwHit += 1;
      }
      if (row.handicapRecommendation && row.handicapRecommendation !== '观望' && row.hitHandicap !== null) {
        oldHcpTotal += 1;
        if (row.hitHandicap) oldHcpHit += 1;
      }
      if (row.totalPick && row.totalPick !== '观望' && row.hitOverunder !== null) {
        oldOuTotal += 1;
        if (row.hitOverunder) oldOuHit += 1;
      }
    }

    for (const row of rows) {
      const hgf = Number(row.homeGoalsAvg);
      const hga = Number(row.homeConcededAvg);
      const agf = Number(row.awayGoalsAvg);
      const aga = Number(row.awayConcededAvg);
      if (hgf <= 0 || hga <= 0 || agf <= 0 || aga <= 0) continue;
      if (row.homeScore === null || row.awayScore === null) continue;

      const poisson = this.footballPoisson.predict({
        homeGoalsFor: hgf,
        homeGoalsAgainst: hga,
        awayGoalsFor: agf,
        awayGoalsAgainst: aga,
      });

      const actualHome = row.homeScore;
      const actualAway = row.awayScore;
      const actualTotal = actualHome + actualAway;

      const maxProb = Math.max(poisson.homeWinProb, poisson.drawProb, poisson.awayWinProb);
      let newWdwPick: string;
      if (maxProb === poisson.homeWinProb && poisson.homeWinProb >= 38) newWdwPick = '主胜';
      else if (maxProb === poisson.awayWinProb && poisson.awayWinProb >= 35) newWdwPick = '客胜';
      else if (poisson.drawProb >= 28) newWdwPick = '平局';
      else newWdwPick = '观望';

      if (newWdwPick !== '观望') {
        const wdwHit =
          (newWdwPick === '主胜' && actualHome > actualAway) ||
          (newWdwPick === '客胜' && actualHome < actualAway) ||
          (newWdwPick === '平局' && actualHome === actualAway);
        newWdwTotal += 1;
        if (wdwHit) newWdwHit += 1;
      }

      const hLine = parseFloat(row.handicapNum || '');
      if (isFinite(hLine) && hLine !== 0) {
        let newHcpPick: string;
        const line = -hLine;
        if (poisson.homeWinProb >= 50) {
          newHcpPick = '让球主胜';
        } else if (poisson.awayWinProb >= 45) {
          newHcpPick = '让球客胜';
        } else {
          newHcpPick = '观望';
        }
        if (newHcpPick !== '观望') {
          const actualCover = actualHome - actualAway + line;
          const hcpHit = (newHcpPick === '让球主胜' && actualCover > 0) ||
            (newHcpPick === '让球客胜' && actualCover < 0);
          newHcpTotal += 1;
          if (hcpHit) newHcpHit += 1;
        }
      }

      const tLine = parseFloat(row.totalGoals || '');
      if (isFinite(tLine) && tLine > 0) {
        const diff = poisson.expectedTotal - tLine;
        let newOuPick: string;
        if (Math.abs(diff) >= 0.3) {
          newOuPick = diff > 0 ? '大球' : '小球';
        } else {
          newOuPick = '观望';
        }
        if (newOuPick !== '观望') {
          const ouHit = (newOuPick === '大球' && actualTotal > tLine) ||
            (newOuPick === '小球' && actualTotal < tLine);
          newOuTotal += 1;
          if (ouHit) newOuHit += 1;
        }
      }
    }

    const oldWdwRate = oldWdwTotal > 0 ? Math.round((oldWdwHit / oldWdwTotal) * 1000) / 10 : null;
    const oldHcpRate = oldHcpTotal > 0 ? Math.round((oldHcpHit / oldHcpTotal) * 1000) / 10 : null;
    const oldOuRate = oldOuTotal > 0 ? Math.round((oldOuHit / oldOuTotal) * 1000) / 10 : null;
    const newWdwRate = newWdwTotal > 0 ? Math.round((newWdwHit / newWdwTotal) * 1000) / 10 : null;
    const newHcpRate = newHcpTotal > 0 ? Math.round((newHcpHit / newHcpTotal) * 1000) / 10 : null;
    const newOuRate = newOuTotal > 0 ? Math.round((newOuHit / newOuTotal) * 1000) / 10 : null;

    const items: ModelUpgradeBacktestItem[] = [
      {
        dimension: '胜平负',
        oldHitRate: oldWdwRate,
        newHitRate: newWdwRate,
        oldTotal: oldWdwTotal,
        newTotal: newWdwTotal,
        delta: newWdwRate !== null && oldWdwRate !== null ? Math.round((newWdwRate - oldWdwRate) * 10) / 10 : null,
        sampleNote: `旧模型${oldWdwTotal}场 / 泊松模型${newWdwTotal}场`,
      },
      {
        dimension: '让球',
        oldHitRate: oldHcpRate,
        newHitRate: newHcpRate,
        oldTotal: oldHcpTotal,
        newTotal: newHcpTotal,
        delta: newHcpRate !== null && oldHcpRate !== null ? Math.round((newHcpRate - oldHcpRate) * 10) / 10 : null,
        sampleNote: `旧模型${oldHcpTotal}场 / 泊松模型${newHcpTotal}场`,
      },
      {
        dimension: '大小球',
        oldHitRate: oldOuRate,
        newHitRate: newOuRate,
        oldTotal: oldOuTotal,
        newTotal: newOuTotal,
        delta: newOuRate !== null && oldOuRate !== null ? Math.round((newOuRate - oldOuRate) * 10) / 10 : null,
        sampleNote: `旧模型${oldOuTotal}场 / 泊松模型${newOuTotal}场`,
      },
    ];

    const avgDelta = items
      .filter((i: ModelUpgradeBacktestItem) => i.delta !== null)
      .reduce((s: number, i: ModelUpgradeBacktestItem) => s + (i.delta || 0), 0) / 3;

    return {
      sport: 'football',
      totalFinished,
      withModelData,
      items,
      summary: `足球xG泊松模型回测：${withModelData}场有攻防数据，三维度平均变化${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}%`,
      generatedAt: new Date().toISOString(),
    };
  }
}
