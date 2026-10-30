import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, oddsRecords, h2hRecords, dataSnapshots, modelRuleDetails, oddsSnapshots, ruleDisabled, injuryReports } from '@server/database/schema';
import { eq, and, gte, lt, asc, desc, ilike, sql, count, not, isNotNull, ne, inArray } from 'drizzle-orm';
import { applyHandicapRules, type HandicapGateInput } from '@server/common/utils/handicap-gate';
import { isBeidanEnabled } from '@server/config/secrets.config';
import { SportteryService } from '../sporttery/sporttery.service';
import type {
  MatchItem,
  MatchListResponse,
  MatchDetailResponse,
  CreateMatchRequest,
  UpdateMatchRequest,
  MatchOddsResponse,
  OddsRecordItem,
  OddsTrendResponse,
  OddsTrendPoint,
  MatchMultiSourceResponse,
  MatchSourceOdds,
  InjuryReport,
  BatchUpsertResponse,
  DataCheckResponse,
  DataCheckByDateItem,
  DataIntegrityIssue,
  MatchStatsResponse,
  LiveScoreResponse,
   FootballBacktestResponse,
   LiveScoreItem,
    PredictionAccuracyResponse,
    RuleBacktestResponse,
    RuleBacktestItem,
    StarRating,
    DateStatsResponse,
  } from '@shared/api.interface';

interface ListQueryParams {
  date: string;
  league?: string;
  confidence?: 'high' | 'medium' | 'low';
  direction?: string;
  sort?: 'kickoff_asc' | 'confidence_desc';
  status?: 'upcoming' | 'finished';
  source?: 'sporttery' | 'beidan';
  sourceFilter?: 'all' | 'official' | 'jingcai' | 'beidan' | 'international' | 'others';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sportteryService: SportteryService,
  ) {}

  private async filterDisabledRules(rules: string[]): Promise<string[]> {
    const disabledRows = await this.db
      .select({ rulePattern: ruleDisabled.rulePattern })
      .from(ruleDisabled)
      .where(
        sql`${ruleDisabled.sport} = 'football' AND ${ruleDisabled.action} = 'disabled'`,
      );

    const patterns = disabledRows.map((r: { rulePattern: string }) => r.rulePattern);
    if (patterns.length === 0) return rules;

    return rules.filter((rule: string) => {
      for (const pattern of patterns) {
        if (rule.startsWith(pattern) || rule === pattern) {
          return false;
        }
      }
      return true;
    });
  }

  private sanitizeTextPlaceholder(value: string): string {
    const PLACEHOLDER_TEXTS = ['情报采集中', '示例', '待接入', 'demo', 'Demo', 'DEMO'];
    const trimmed = value.trim();
    if (PLACEHOLDER_TEXTS.includes(trimmed)) {
      return '暂无可靠情报';
    }
    return value;
  }

  private normalizeWdwFromOdds(row: typeof matches.$inferSelect): {
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    predictionDirection: string;
    confidence: number;
    lowConfidence: boolean;
    wdwOddsRule: string | null;
  } {
    const oddsH = row.oddsOpenHome != null ? Number(row.oddsOpenHome) : null;
    const oddsD = row.oddsOpenDraw != null ? Number(row.oddsOpenDraw) : null;
    const oddsA = row.oddsOpenAway != null ? Number(row.oddsOpenAway) : null;
    const hasWdwOdds = oddsH != null && oddsD != null && oddsA != null
      && oddsH > 0 && oddsD > 0 && oddsA > 0;
    const curH = Number(row.homeWinProb) || 0;
    const curD = Number(row.drawProb) || 0;
    const curA = Number(row.awayWinProb) || 0;
    const curConf = Number(row.confidence) || 0;
    const isBaseline = curH === 35 && curD === 30 && curA === 35 && curConf === 0;
    const curDir = (row.predictionDirection ?? '').trim();
    if (!hasWdwOdds) {
      const modelTop = Math.max(curH, curD, curA);
      // v12.0 标准：最高项即方向，取消 45% 门槛
      if (curDir === '观望' && modelTop > 0) {
        let dir = '主胜';
        if (curD > curH && curD > curA) dir = '平';
        else if (curA > curH && curA >= curD) dir = '客胜';
        return {
          homeWinProb: curH, drawProb: curD, awayWinProb: curA,
          predictionDirection: dir,
          confidence: modelTop, lowConfidence: modelTop < 50,
          wdwOddsRule: '模型驱动胜平负：最高项即方向',
        };
      }
      return {
        homeWinProb: curH, drawProb: curD, awayWinProb: curA,
        predictionDirection: curDir || row.predictionDirection,
        confidence: curConf, lowConfidence: row.lowConfidence,
        wdwOddsRule: null,
      };
    }
    const invH = 1 / oddsH;
    const invD = 1 / oddsD;
    const invA = 1 / oddsA;
    const totalInv = invH + invD + invA;
    const hProb = Math.round((invH / totalInv) * 100);
    const dProb = Math.round((invD / totalInv) * 100);
    let aProb = 100 - hProb - dProb;
    if (aProb < 0) aProb = 0;
    const top = Math.max(hProb, dProb, aProb);
    const drawIsTop = dProb > hProb && dProb > aProb;
    // v12.0 标准：赔率驱动胜平负，最高项即方向，取消 45% 观望门槛
    // 让平仍是特殊玩法：平局为最高项且≥28%才推荐平
    let direction = curDir;
    if (isBaseline || curDir === '观望' || curDir === '') {
      if (drawIsTop && dProb >= 28) {
        direction = '平';
      } else if (!drawIsTop) {
        direction = hProb >= aProb ? '主胜' : '客胜';
      } else {
        direction = hProb >= aProb ? '主胜' : '客胜';
      }
    }
    const confidence = Math.max(15, Math.min(80, top));
    const lowConfidence = top < 50 || row.lowConfidence;
    return {
      homeWinProb: hProb,
      drawProb: dProb,
      awayWinProb: aProb,
      predictionDirection: direction,
      confidence,
      lowConfidence,
      wdwOddsRule: '赔率驱动胜平负：官方赔率去水判定方向',
    };
  }

  private normalizeTotalFromOdds(row: typeof matches.$inferSelect): {
    overProb: number;
    underProb: number;
    totalPick: string;
    totalPickProb: number;
    totalOddsRule: string | null;
  } {
    const oOdds = row.totalOddsOver != null ? Number(row.totalOddsOver) : null;
    const uOdds = row.totalOddsUnder != null ? Number(row.totalOddsUnder) : null;
    const hasTotalOdds = oOdds != null && uOdds != null && oOdds > 0 && uOdds > 0;
    const curOver = Number(row.overProb) || 0;
    const curUnder = Number(row.underProb) || 0;
    const curPick = (row.totalPick ?? '').trim();
    const curPickProb = Number(row.totalPickProb) || 0;
    const isBaseline = curOver === 50 && curUnder === 50 && curPickProb === 50
      && (curPick === '' || curPick === '观望');
    if (!hasTotalOdds) {
      const modelTop = Math.max(curOver, curUnder);
      const modelPick = curOver >= curUnder ? '大球' : '小球';
      // v12.0 标准：最高项即方向，取消 55% 门槛
      if (curPick !== '大球' && curPick !== '小球' && modelTop > 0) {
        return {
          overProb: curOver, underProb: curUnder,
          totalPick: modelPick, totalPickProb: modelTop,
          totalOddsRule: '模型驱动大小球：最高项即方向',
        };
      }
      return { overProb: curOver, underProb: curUnder, totalPick: curPick, totalPickProb: curPickProb, totalOddsRule: null };
    }
    const invO = 1 / oOdds;
    const invU = 1 / uOdds;
    const totalInv = invO + invU;
    const overP = Math.round((invO / totalInv) * 100);
    const underP = 100 - overP;
    const top = Math.max(overP, underP);
    // v12.0 标准：赔率驱动大小球，最高项即方向，取消 55% 观望门槛
    // 50/50 时按大球出，标低信心
    let pick = curPick;
    if (isBaseline || curPick === '观望' || curPick === '') {
      pick = overP >= underP ? '大球' : '小球';
    }
    return {
      overProb: overP, underProb: underP,
      totalPick: pick, totalPickProb: top,
      totalOddsRule: '赔率驱动大小球：官方赔率去水判定方向',
    };
  }

  private isWdwAnalyzed(row: typeof matches.$inferSelect): boolean {
    const oddsH = row.oddsOpenHome != null ? Number(row.oddsOpenHome) : null;
    const oddsD = row.oddsOpenDraw != null ? Number(row.oddsOpenDraw) : null;
    const oddsA = row.oddsOpenAway != null ? Number(row.oddsOpenAway) : null;
    if (oddsH != null && oddsD != null && oddsA != null
      && oddsH > 0 && oddsD > 0 && oddsA > 0) return true;
    const homeP = Number(row.homeWinProb) || 0;
    const drawP = Number(row.drawProb) || 0;
    const awayP = Number(row.awayWinProb) || 0;
    if (homeP === 0 && drawP === 0 && awayP === 0) return false;
    if (homeP === 33 && drawP === 33 && awayP === 33) return false;
    return homeP + drawP + awayP > 0;
  }

  private getHandicapValueType(row: typeof matches.$inferSelect): 'percent' | 'odds' | 'none' {
    const hwp = Number(row.handicapWinProb) || 0;
    const hdp = Number(row.handicapDrawProb) || 0;
    const hlP = Number(row.handicapLoseProb) || 0;
    if (hwp === 0 && hdp === 0 && hlP === 0) return 'none';
    const allInOddsRange = hwp >= 1 && hwp <= 10 && hdp >= 1 && hdp <= 10 && hlP >= 1 && hlP <= 10;
    const sumNear100 = Math.abs(hwp + hdp + hlP - 100) <= 15;
    if (allInOddsRange && !sumNear100) return 'odds';
    return 'percent';
  }

  private isHandicapAnalyzed(row: typeof matches.$inferSelect): boolean {
    if (row.handicapRecommendation === '观望') return false;
    const valueType = this.getHandicapValueType(row);
    return valueType !== 'none';
  }

  private isTotalAnalyzed(row: typeof matches.$inferSelect): boolean {
    const norm = this.normalizeTotalFromOdds(row);
    const overP = norm.overProb;
    const underP = norm.underProb;
    if (overP === 50 && underP === 50) return false;
    if (!norm.totalPick || norm.totalPick === '观望') return false;
    return true;
  }

  private computeStarRating(confidence: number, isDirectional: boolean): StarRating {
    if (!isDirectional || confidence <= 0) return 0;
    if (confidence >= 90) return 5;
    if (confidence >= 80) return 4;
    if (confidence >= 70) return 3;
    if (confidence >= 60) return 2;
    if (confidence >= 55) return 1;
    return 0;
  }

  private isMatchAnalyzed(row: typeof matches.$inferSelect): boolean {
    return this.isWdwAnalyzed(row) || this.isTotalAnalyzed(row) || this.isHandicapAnalyzed(row);
  }

  private isOfficialLocked(row: typeof matches.$inferSelect): boolean {
    return Array.isArray(row.modelRules) && row.modelRules.includes('官方数据锁定');
  }

  private getIntelDirection(row: typeof matches.$inferSelect): string | null {
    if (!Array.isArray(row.modelRules)) return null;
    const rule = row.modelRules.find((r: string) => r.startsWith('情报方向:'));
    if (!rule) return null;
    return rule.replace('情报方向:', '').trim() || null;
  }

  private applyV7WdwGate(
    row: typeof matches.$inferSelect,
  ): { direction: string; lowConfidence: boolean } {
    const intelDir = this.getIntelDirection(row);
    if (intelDir) {
      return { direction: intelDir, lowConfidence: row.lowConfidence };
    }
    const norm = this.normalizeWdwFromOdds(row);
    if (row.matchStatus !== 'upcoming' || this.isOfficialLocked(row)) {
      return {
        direction: norm.predictionDirection || row.predictionDirection,
        lowConfidence: norm.lowConfidence,
      };
    }
    // v12.0 标准：最高项即方向，取消 45% 观望门槛
    // 最高项 < 50% 标低信心，对齐篮球侧
    const maxProb = Math.max(norm.homeWinProb, norm.drawProb, norm.awayWinProb);
    const curDir = norm.predictionDirection || row.predictionDirection;
    const lowConf = norm.lowConfidence || maxProb < 50;
    return { direction: curDir, lowConfidence: lowConf };
  }

  private computeEffectiveConfidence(
    row: typeof matches.$inferSelect,
    v7Direction: string,
  ): number {
    if (this.isOfficialLocked(row) || this.getIntelDirection(row)) {
      return Number(row.confidence) || 0;
    }
    const norm = this.normalizeWdwFromOdds(row);
    if (v7Direction !== '观望') {
      return Math.max(norm.homeWinProb, norm.drawProb, norm.awayWinProb);
    }
    return 0;
  }

  private summarizeIntel(intel: string | null): string {
    if (!intel || intel === '暂无可靠情报' || intel.length < 10) return '';
    const cleaned = intel.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 120) return cleaned;
    return cleaned.slice(0, 117) + '...';
  }

  /**
   * Lean list-item mapper — returns only fields used by the list card and TodayPage logic.
   * Cuts 30+ detail-only fields (advancedStats, environment, h2h, player stats, etc.)
   * from each row to reduce JSON payload size by ~50-60%.
   */
  private toMatchListItem(
    row: Partial<typeof matches.$inferSelect> & {
      id: string;
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: Date;
      matchStatus: string;
      homeWinProb: number;
      drawProb: number;
      awayWinProb: number;
      predictionDirection: string;
      confidence: number;
      lowConfidence: boolean;
      handicap: string | null;
      handicapRecommendation: string | null;
      handicapType: string | null;
      overUnder: string | null;
      overProb: number | null;
      underProb: number | null;
      totalPick: string | null;
      totalPickProb: number | null;
      totalGoals: number | null;
      mostLikelyScore: string | null;
      homeScore: number | null;
      awayScore: number | null;
      homeHalfScore: number | null;
      awayHalfScore: number | null;
      livePeriod: number | null;
      liveClock: string | null;
      liveScoreSource: string | null;
      lastScoreAt: Date | null;
      lastDataSyncAt: Date | null;
      oddsOpenHome: number | null;
      oddsOpenDraw: number | null;
      oddsOpenAway: number | null;
      oddsLiveHome: number | null;
      oddsLiveDraw: number | null;
      oddsLiveAway: number | null;
      source: string | null;
      matchDate: string | Date;
      businessDate: string | Date | null;
      hitWdw: boolean | null;
      hitHandicap: boolean | null;
      hitOverunder: boolean | null;
      modelRules: string[] | null;
      handicapOddsHome: number | null;
      handicapOddsDraw: number | null;
      handicapOddsAway: number | null;
      totalOddsOver: number | null;
      totalOddsUnder: number | null;
      handicapWinProb: number | null;
      handicapDrawProb: number | null;
      handicapLoseProb: number | null;
      sourceMatchId: string | null;
      drawWarning?: boolean | null;
      errorReason?: string | null;
       intel?: string | null;
       predEngineVersion?: string | null;
     },
  ): MatchItem {
    const fullRow = row as typeof matches.$inferSelect;
    const wdwNorm = this.normalizeWdwFromOdds(fullRow);
    const totalNorm = this.normalizeTotalFromOdds(fullRow);
    const v7Gate = this.applyV7WdwGate(fullRow);
    const hasOdds = row.oddsOpenHome !== null && row.oddsOpenHome !== undefined;
    const liveOddsFallback = {
      homeWinOdds: hasOdds ? Number(row.oddsLiveHome ?? row.oddsOpenHome) : null,
      drawOdds: hasOdds ? Number(row.oddsLiveDraw ?? row.oddsOpenDraw) : null,
      awayWinOdds: hasOdds ? Number(row.oddsLiveAway ?? row.oddsOpenAway) : null,
    };
    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      homeWinProb: wdwNorm.homeWinProb,
      drawProb: wdwNorm.drawProb,
      awayWinProb: wdwNorm.awayWinProb,
      predictionDirection: v7Gate.direction,
      handicap: row.handicap ?? '',
      handicapRecommendation: row.handicapRecommendation ?? '观望',
      handicapType: (row.handicapType as MatchItem['handicapType']) ?? undefined,
      confidence: this.computeEffectiveConfidence(row as typeof matches.$inferSelect, v7Gate.direction),
      lowConfidence: v7Gate.lowConfidence,
      isModelAnalyzed: this.isMatchAnalyzed(row as typeof matches.$inferSelect),
      wdwAnalyzed: this.isWdwAnalyzed(row as typeof matches.$inferSelect),
      handicapAnalyzed: this.isHandicapAnalyzed(row as typeof matches.$inferSelect),
      totalAnalyzed: this.isTotalAnalyzed(row as typeof matches.$inferSelect),
      handicapValueType: this.getHandicapValueType(row as typeof matches.$inferSelect),
      intel: row.intel ?? '',
      modelRules: row.modelRules ?? [],
      matchDate: row.matchDate.toString(),
      businessDate: row.businessDate != null ? String(row.businessDate) : undefined,
      source: row.source ?? undefined,
      sourceMatchId: row.sourceMatchId ?? undefined,
      overUnder: row.overUnder ?? '',
      overProb: totalNorm.overProb,
      underProb: totalNorm.underProb,
      totalPick: totalNorm.totalPick,
      totalPickProb: totalNorm.totalPickProb,
      totalGoals: Number(row.totalGoals),
      mostLikelyScore: row.mostLikelyScore ?? '',
      matchStatus: row.matchStatus as MatchItem['matchStatus'],
      homeScore: row.homeScore ?? undefined,
      awayScore: row.awayScore ?? undefined,
      homeHalfScore: row.homeHalfScore ?? undefined,
      awayHalfScore: row.awayHalfScore ?? undefined,
      livePeriod: row.livePeriod ?? null,
      liveClock: row.liveClock ?? null,
      liveScoreSource: row.liveScoreSource ?? '',
      lastScoreAt: row.lastScoreAt ? (row.lastScoreAt instanceof Date ? row.lastScoreAt.toISOString() : String(row.lastScoreAt)) : null,
      lastDataSyncAt: row.lastDataSyncAt
        ? row.lastDataSyncAt instanceof Date
          ? row.lastDataSyncAt.toISOString()
          : String(row.lastDataSyncAt)
        : null,
      ...liveOddsFallback,
      handicapOddsHome: row.handicapOddsHome != null && row.handicapOddsHome !== undefined ? Number(row.handicapOddsHome) : undefined,
      handicapOddsDraw: row.handicapOddsDraw != null && row.handicapOddsDraw !== undefined ? Number(row.handicapOddsDraw) : undefined,
      handicapOddsAway: row.handicapOddsAway != null && row.handicapOddsAway !== undefined ? Number(row.handicapOddsAway) : undefined,
      totalOddsOver: row.totalOddsOver != null && row.totalOddsOver !== undefined ? Number(row.totalOddsOver) : undefined,
      totalOddsUnder: row.totalOddsUnder != null && row.totalOddsUnder !== undefined ? Number(row.totalOddsUnder) : undefined,
      handicapWinProb: Number(row.handicapWinProb),
      handicapDrawProb: Number(row.handicapDrawProb),
      handicapLoseProb: Number(row.handicapLoseProb),
      hitWdw: row.hitWdw ?? undefined,
      hitHandicap: row.hitHandicap ?? undefined,
      hitOverunder: row.hitOverunder ?? undefined,
      starRating: this.computeStarRating(
        this.computeEffectiveConfidence(row as typeof matches.$inferSelect, v7Gate.direction),
        v7Gate.direction !== '观望',
      ),
      drawWarning: row.drawWarning ?? false,
      errorReason: row.errorReason ?? undefined,
      scoreProbs: [],
      totalGoalsProb: (row.totalGoalsProb as unknown as MatchItem['totalGoalsProb']) ?? [],
      predEngineVersion: row.predEngineVersion ?? undefined,
      halfFullProb: [],
      advancedStats: (row.advancedStats as unknown as MatchItem['advancedStats']) ?? ({} as MatchItem['advancedStats']),
      environment: {
        weather: { temp: 0, condition: '', humidity: 0, wind: 0 },
        stadium: { name: '', capacity: 0, grass: '' },
        referee: { name: '', matches: 0, avgYellow: 0, avgRed: 0, penaltyRate: 0 },
      },
      homeForm: [],
      awayForm: [],
      h2h: [],
      drawConfidence: '中',
      drawFactors: [],
      kellyH: 0,
      kellyD: 0,
      kellyA: 0,
      handicapSecondChoice: '',
      handicapValueRating: '中价值',
      rulesTriggered: [],
      hitGoals: undefined,
      hitHalffull: undefined,
      homeGoalsAvg: 0,
      awayGoalsAvg: 0,
      homeConcededAvg: 0,
      awayConcededAvg: 0,
      homeHomeRecord: '',
      awayAwayRecord: '',
       homeInjuries: row.homeInjuries ?? '',
       awayInjuries: row.awayInjuries ?? '',
       tacticsHome: '',
       tacticsAway: '',
       keyPlayersHome: row.keyPlayersHome ?? '',
       keyPlayersAway: row.keyPlayersAway ?? '',
       upsetWarning: row.upsetWarning ?? '',
       teamNews: row.teamNews ?? '',
       injuries: row.injuries ?? '',
      mediaConsensus: '',
      expertPicks: '',
      keyPlayers: '',
      intelUpdatedAt: undefined,
    };
  }

  private toMatchItem(row: typeof matches.$inferSelect): MatchItem {
    const v7Gate = this.applyV7WdwGate(row);
    const wdwNorm = this.normalizeWdwFromOdds(row);
    const totalNorm = this.normalizeTotalFromOdds(row);
    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      homeWinProb: wdwNorm.homeWinProb,
      drawProb: wdwNorm.drawProb,
      awayWinProb: wdwNorm.awayWinProb,
      predictionDirection: v7Gate.direction,
      handicap: row.handicap,
      handicapRecommendation: row.handicapRecommendation,
      handicapType: (row.handicapType as MatchItem['handicapType']) ?? undefined,
      confidence: this.computeEffectiveConfidence(row as typeof matches.$inferSelect, v7Gate.direction),
      lowConfidence: v7Gate.lowConfidence,
      isModelAnalyzed: this.isMatchAnalyzed(row),
      wdwAnalyzed: this.isWdwAnalyzed(row),
      handicapAnalyzed: this.isHandicapAnalyzed(row),
      totalAnalyzed: this.isTotalAnalyzed(row),
      handicapValueType: this.getHandicapValueType(row),
      intel: row.intel,
      modelRules: row.modelRules,
      matchDate: row.matchDate,
      businessDate: row.businessDate != null
        ? String(row.businessDate)
        : row.matchDate != null
          ? String(row.matchDate)
          : undefined,
      source: row.source,
      sourceMatchId: row.sourceMatchId ?? undefined,
      overUnder: row.overUnder,
      overProb: totalNorm.overProb,
      underProb: totalNorm.underProb,
      totalPick: totalNorm.totalPick,
      totalPickProb: totalNorm.totalPickProb,
      totalGoals: Number(row.totalGoals),
      mostLikelyScore: row.mostLikelyScore,
      scoreProbs: row.scoreProbs,
      totalGoalsProb: (row.totalGoalsProb as unknown as MatchItem['totalGoalsProb']) ?? [],
      halfFullProb: (row.halfFullProb as unknown as MatchItem['halfFullProb']) ?? [],
      advancedStats: (row.advancedStats as unknown as MatchItem['advancedStats']) ?? ({} as MatchItem['advancedStats']),
      environment: (row.environment as unknown as MatchItem['environment']) ?? {
        weather: { temp: 0, condition: '', humidity: 0, wind: 0 },
        stadium: { name: '', capacity: 0, grass: '' },
        referee: { name: '', matches: 0, avgYellow: 0, avgRed: 0, penaltyRate: 0 },
      },
      matchStatus: row.matchStatus as MatchItem['matchStatus'],
      homeScore: row.homeScore ?? undefined,
      awayScore: row.awayScore ?? undefined,
      homeHalfScore: row.homeHalfScore ?? undefined,
      awayHalfScore: row.awayHalfScore ?? undefined,
      livePeriod: row.livePeriod ?? null,
      liveClock: row.liveClock ?? null,
      liveScoreSource: row.liveScoreSource ?? '',
      lastScoreAt: row.lastScoreAt ? (row.lastScoreAt instanceof Date ? row.lastScoreAt.toISOString() : String(row.lastScoreAt)) : null,
      lastDataSyncAt: row.lastDataSyncAt
        ? row.lastDataSyncAt instanceof Date
          ? row.lastDataSyncAt.toISOString()
          : String(row.lastDataSyncAt)
        : null,
      homeForm: row.homeForm,
      awayForm: row.awayForm,
      h2h: row.h2h,
      oddsOpenHome: row.oddsOpenHome !== null ? Number(row.oddsOpenHome) : undefined,
      oddsOpenDraw: row.oddsOpenDraw !== null ? Number(row.oddsOpenDraw) : undefined,
      oddsOpenAway: row.oddsOpenAway !== null ? Number(row.oddsOpenAway) : undefined,
      homeWinOdds: row.oddsOpenHome !== null ? Number(row.oddsOpenHome) : null,
      drawOdds: row.oddsOpenDraw !== null ? Number(row.oddsOpenDraw) : null,
      awayWinOdds: row.oddsOpenAway !== null ? Number(row.oddsOpenAway) : null,
      oddsLiveHome: row.oddsLiveHome !== null ? Number(row.oddsLiveHome) : undefined,
      oddsLiveDraw: row.oddsLiveDraw !== null ? Number(row.oddsLiveDraw) : undefined,
      oddsLiveAway: row.oddsLiveAway !== null ? Number(row.oddsLiveAway) : undefined,
      handicapOddsHome: row.handicapOddsHome !== null && row.handicapOddsHome !== undefined ? Number(row.handicapOddsHome) : undefined,
      handicapOddsDraw: row.handicapOddsDraw !== null && row.handicapOddsDraw !== undefined ? Number(row.handicapOddsDraw) : undefined,
      handicapOddsAway: row.handicapOddsAway !== null && row.handicapOddsAway !== undefined ? Number(row.handicapOddsAway) : undefined,
      totalOddsOver: row.totalOddsOver !== null && row.totalOddsOver !== undefined ? Number(row.totalOddsOver) : undefined,
      totalOddsUnder: row.totalOddsUnder !== null && row.totalOddsUnder !== undefined ? Number(row.totalOddsUnder) : undefined,
      drawConfidence: (row.drawConfidence as MatchItem['drawConfidence']) ?? '中',
      drawFactors: row.drawFactors ?? [],
      handicapWinProb: Number(row.handicapWinProb),
      handicapDrawProb: Number(row.handicapDrawProb),
      handicapLoseProb: Number(row.handicapLoseProb),
      kellyH: Number(row.kellyH),
      kellyD: Number(row.kellyD),
      kellyA: Number(row.kellyA),
      handicapSecondChoice: row.handicapSecondChoice ?? '',
      handicapValueRating: row.handicapValueRating ?? '中价值',
      rulesTriggered:
        (row.rulesTriggered as unknown as MatchItem['rulesTriggered']) ?? [],
      hitWdw: row.hitWdw ?? undefined,
      hitHandicap: row.hitHandicap ?? undefined,
      hitOverunder: row.hitOverunder ?? undefined,
      hitGoals: row.hitGoals ?? undefined,
      hitHalffull: row.hitHalffull ?? undefined,
      starRating: this.computeStarRating(
        this.computeEffectiveConfidence(row, v7Gate.direction),
        v7Gate.direction !== '观望',
      ),
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

  private toOddsRecordItem(row: typeof oddsRecords.$inferSelect): OddsRecordItem {
    return {
      id: row.id,
      matchId: row.matchId,
      bookmaker: row.bookmaker ?? 'average',
      oddsType: row.oddsType,
      homeValue: row.homeValue !== null ? Number(row.homeValue) : undefined,
      drawValue: row.drawValue !== null ? Number(row.drawValue) : undefined,
      awayValue: row.awayValue !== null ? Number(row.awayValue) : undefined,
      handicapValue: row.handicapValue ?? '0',
      overValue: row.overValue !== null ? Number(row.overValue) : undefined,
      underValue: row.underValue !== null ? Number(row.underValue) : undefined,
      totalLine: Number(row.totalLine),
      snapshotTime: row.snapshotTime.toISOString(),
      isInitial: row.isInitial,
    };
  }

  private computeHitResults(
    match: typeof matches.$inferSelect,
    homeScore: number,
    awayScore: number,
  ): {
    hitWdw: boolean | null;
    hitHandicap: boolean | null;
    hitOverunder: boolean | null;
    hitGoals: boolean | null;
    hitHalffull: boolean | null;
    errorReason: string;
  } {
    const totalGoals = homeScore + awayScore;

    // a) 胜平负命中 (hitWdw)
    const actualWdw = homeScore > awayScore
      ? '主胜'
      : homeScore === awayScore
        ? '平'
        : '客胜';
    let hitWdw: boolean | null;
    if (match.lowConfidence && match.predictionDirection === '观望') {
      hitWdw = null;
    } else {
      hitWdw = match.predictionDirection === actualWdw;
    }

    // b) 让球命中 (hitHandicap)
    let hitHandicap: boolean | null = null;
    const handicapRaw = match.handicap ?? '0';
    const handicapValue = parseInt(handicapRaw, 10);
    if (match.handicapRecommendation === '观望') {
      hitHandicap = null;
    } else {
      const homeAdjusted = homeScore + handicapValue;
      let actualHandicap: string;
      if (homeAdjusted > awayScore) {
        actualHandicap = '让胜';
      } else if (homeAdjusted === awayScore) {
        actualHandicap = '让平';
      } else {
        actualHandicap = '让负';
      }
      const recommendations = match.handicapRecommendation.split('+');
      hitHandicap = recommendations.includes(actualHandicap);
    }

    // c) 总进球档位命中 (hitOverunder)
    // 仅当 total_pick 为明确档位时计算命中，否则为 null
    let hitOverunder: boolean | null = null;
    const pick = match.totalPick ?? '';
    if (pick === '0-1球') {
      hitOverunder = totalGoals <= 1;
    } else if (pick === '2-3球') {
      hitOverunder = totalGoals >= 2 && totalGoals <= 3;
    } else if (pick === '4-6球') {
      hitOverunder = totalGoals >= 4 && totalGoals <= 6;
    } else if (pick === '7+球') {
      hitOverunder = totalGoals >= 7;
    }

    // d) 最可能球数命中 (hitGoals)
    let hitGoals: boolean | null = null;
    if (match.mostLikelyScore) {
      const parts = match.mostLikelyScore.split('-');
      if (parts.length === 2) {
        const homePred = parseInt(parts[0], 10);
        const awayPred = parseInt(parts[1], 10);
        if (!isNaN(homePred) && !isNaN(awayPred)) {
          hitGoals = (homePred + awayPred) === totalGoals;
        }
      }
    }

    // e) 半全场命中 (hitHalffull) — 无半场比分数据，留空
    const hitHalffull: boolean | null = null;

    // errorReason — 仅当胜平负未命中时设置
    let errorReason = '';
    if (hitWdw === false) {
      if (match.lowConfidence) {
        errorReason = '低参考场次正常波动';
      } else if (
        (match.predictionDirection === '主胜' && actualWdw === '客胜') ||
        (match.predictionDirection === '客胜' && actualWdw === '主胜')
      ) {
        errorReason = '冷门：方向完全反转';
      } else if (
        (match.predictionDirection === '主胜' && actualWdw === '平') ||
        (match.predictionDirection === '平' && actualWdw === '主胜')
      ) {
        errorReason = '平局漏判';
      } else if (match.predictionDirection === '客胜' && actualWdw === '平') {
        errorReason = '平局漏判：客胜高估';
      } else if (Math.abs(handicapValue) >= 2) {
        errorReason = '深盘失手';
      }
    }

    return {
      hitWdw,
      hitHandicap,
      hitOverunder,
      hitGoals,
      hitHalffull,
      errorReason,
    };
  }

  private getNextDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + 1);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  private getBeijingDateStr(date: Date): string {
    const utcMs = date.getTime();
    const beijingMs = utcMs + 8 * 3600 * 1000;
    const d = new Date(beijingMs);
    return d.toISOString().slice(0, 10);
  }

  async getDateStats(startDate: string, endDate: string, source?: string): Promise<DateStatsResponse> {
    const conditions = [
      gte(matches.businessDate, startDate),
      lt(matches.businessDate, this.getNextDate(endDate)),
    ];
    if (source === 'sporttery') {
      conditions.push(eq(matches.source, 'sporttery'));
    } else if (source === 'beidan') {
      conditions.push(eq(matches.source, 'beidan'));
    } else if (source === 'international') {
      conditions.push(and(ne(matches.source, 'sporttery'), ne(matches.source, 'beidan')));
    }
    const rows = await this.db
      .select({
        businessDate: matches.businessDate,
        total: sql<number>`count(*)`,
        finished: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished')`,
        upcoming: sql<number>`count(*) filter (where ${matches.matchStatus} = 'upcoming')`,
        wdwHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        handicapHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitHandicap} = true)`,
        handicapTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球')`,
        ouHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）'))`,
      })
      .from(matches)
      .where(and(...conditions))
      .groupBy(matches.businessDate)
      .orderBy(asc(matches.businessDate));

    const dateMap = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      dateMap.set(row.businessDate.toString(), row);
    }

    const items: { date: string; totalMatches: number; finishedCount: number; upcomingCount: number; wdwHitRate: number; handicapHitRate: number; overUnderHitRate: number; wdwValidTotal: number; handicapValidTotal: number; overUnderValidTotal: number; wdwHit: number; handicapHit: number; overunderHit: number; wdwAccuracy: number; handicapAccuracy: number; overunderAccuracy: number; hasData: boolean }[] = [];
    let current = startDate;
    while (current <= endDate) {
      const row = dateMap.get(current);
      if (row) {
        const finished = Number(row.finished);
        const wdwTotal = Number(row.wdwTotal);
        const hcTotal = Number(row.handicapTotal);
        const ouTotal = Number(row.ouTotal);
        items.push({
          date: current,
          totalMatches: Number(row.total),
          finishedCount: finished,
          upcomingCount: Number(row.upcoming),
          wdwHitRate: wdwTotal > 0 ? Number(row.wdwHits) / wdwTotal : 0,
          handicapHitRate: hcTotal > 0 ? Number(row.handicapHits) / hcTotal : 0,
          overUnderHitRate: ouTotal > 0 ? Number(row.ouHits) / ouTotal : 0,
          wdwValidTotal: wdwTotal,
          handicapValidTotal: hcTotal,
          overUnderValidTotal: ouTotal,
          wdwHit: Number(row.wdwHits),
          handicapHit: Number(row.handicapHits),
          overunderHit: Number(row.ouHits),
          wdwAccuracy: wdwTotal > 0 ? (Number(row.wdwHits) / wdwTotal) * 100 : 0,
          handicapAccuracy: hcTotal > 0 ? (Number(row.handicapHits) / hcTotal) * 100 : 0,
          overunderAccuracy: ouTotal > 0 ? (Number(row.ouHits) / ouTotal) * 100 : 0,
          hasData: true,
        });
      } else {
        items.push({
          date: current,
          totalMatches: 0,
          finishedCount: 0,
          upcomingCount: 0,
          wdwHitRate: 0,
          handicapHitRate: 0,
          overUnderHitRate: 0,
          wdwValidTotal: 0,
          handicapValidTotal: 0,
          overUnderValidTotal: 0,
          wdwHit: 0,
          handicapHit: 0,
          overunderHit: 0,
          wdwAccuracy: 0,
          handicapAccuracy: 0,
          overunderAccuracy: 0,
          hasData: false,
        });
      }
      current = this.getNextDate(current);
    }

    return { items };
  }

  private resolveRuleCategory(rule: string): 'core' | 'auxiliary' | 'legacy' {
    const corePatterns = ['基线模型', '锚定', '正态CDF'];
    if (corePatterns.some((p: string) => rule.includes(p))) return 'core';
    const auxPatterns = ['R44', 'R40', 'R80', 'R81', 'R20', 'R65', 'R62', 'R78', 'R70', 'R76'];
    if (auxPatterns.some((p: string) => rule.includes(p))) return 'auxiliary';
    return 'legacy';
  }

  private resolveRuleAction(sampleSize: number, hitRate: number | null): RuleBacktestItem['action'] {
    if (sampleSize < 20) return 'insufficient_sample';
    const rate = hitRate ?? 0;
    if (rate >= 60) return 'high_confidence';
    if (rate >= 50) return 'keep';
    return 'remove';
  }

  async getRuleBacktest(): Promise<RuleBacktestResponse> {
    const rows = await this.db.execute(sql<{
      rule: string;
      sample_size: number;
      wdw_hit_rate: number | null;
      handicap_hit_rate: number | null;
      overunder_hit_rate: number | null;
    }>`
      SELECT
        unnest(${matches.modelRules}) AS rule,
        count(*) AS sample_size,
        round(AVG(CASE WHEN ${matches.hitWdw} = true THEN 1.0 ELSE 0.0 END) * 100, 2) AS wdw_hit_rate,
        round(AVG(CASE WHEN ${matches.hitHandicap} = true THEN 1.0 ELSE 0.0 END) * 100, 2) AS handicap_hit_rate,
        round(AVG(CASE WHEN ${matches.hitOverunder} = true THEN 1.0 ELSE 0.0 END) * 100, 2) AS overunder_hit_rate
      FROM ${matches}
      WHERE ${matches.matchStatus} = 'finished'
        AND ${matches.modelRules} IS NOT NULL
        AND array_length(${matches.modelRules}, 1) > 0
      GROUP BY rule
      ORDER BY sample_size DESC, rule ASC
    `);

    const items: RuleBacktestItem[] = rows.map((row: {
      rule: string;
      sample_size: number;
      wdw_hit_rate: number | null;
      handicap_hit_rate: number | null;
      overunder_hit_rate: number | null;
    }) => {
      const sampleSize = Number(row.sample_size);
      const wdwHitRate = row.wdw_hit_rate != null ? Number(row.wdw_hit_rate) : null;
      return {
        rule: row.rule,
        totalTriggered: sampleSize,
        adoptedCount: sampleSize,
        adoptedRate: 100,
        wdwHitRate,
        handicapHitRate: row.handicap_hit_rate != null ? Number(row.handicap_hit_rate) : null,
        overunderHitRate: row.overunder_hit_rate != null ? Number(row.overunder_hit_rate) : null,
        primaryDimension: 'wdw',
        action: this.resolveRuleAction(sampleSize, wdwHitRate),
        category: this.resolveRuleCategory(row.rule),
        ruleGroup: 'legacy',
      };
    });

    return {
      sport: 'football',
      totalRules: items.length,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  async getBacktest(params?: { startDate?: string; endDate?: string; days?: number }): Promise<FootballBacktestResponse> {
    const { start, end, days } = this.resolveBacktestRange(params);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const endNextStr = this.addDaysStr(endStr, 1);

    const baseWhere = and(
      eq(matches.matchStatus, 'finished'),
      gte(matches.businessDate, startStr),
      lt(matches.businessDate, endNextStr),
      sql`${matches.predictionDirection} in ('主胜', '平', '客胜')`,
    );

    // ===== totalSamples =====
    const [totalRow] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(matches)
      .where(baseWhere);

    const totalSamples = Number(totalRow.total);
    if (totalSamples === 0) {
      return {
        hasData: false,
        totalSamples: 0,
        dateRange: { start: startStr, end: endStr, days },
        byLeague: [],
        byConfidence: [],
        byHandicap: [],
        byMonth: [],
        detailList: [],
      };
    }

    // ===== byLeague: wdw / handicap / overUnder three hit rates =====
    const leagueRows = await this.db
      .select({
        league: matches.league,
        samples: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        wdwHits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        hcHits: sql<number>`count(*) filter (where ${matches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球')`,
        ouHits: sql<number>`count(*) filter (where ${matches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）'))`,
      })
      .from(matches)
       .where(and(
        eq(matches.matchStatus, 'finished'),
        gte(matches.businessDate, startStr),
        lt(matches.businessDate, endNextStr),
      ))
      .groupBy(matches.league)
      .orderBy(desc(sql`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`));

    const byLeague = leagueRows.map((row) => {
      const s = Number(row.samples);
      const wdwT = Number(row.wdwTotal);
      const hcT = Number(row.hcTotal);
      const ouT = Number(row.ouTotal);
      return {
        league: row.league,
        samples: s,
        wdw: wdwT > 0 ? Math.round((Number(row.wdwHits) / wdwT) * 1000) / 1000 : 0,
        handicap: hcT > 0 ? Math.round((Number(row.hcHits) / hcT) * 1000) / 1000 : 0,
        overUnder: ouT > 0 ? Math.round((Number(row.ouHits) / ouT) * 1000) / 1000 : 0,
      };
    });

    // ===== byConfidence: wdw hit rate =====
    const confRows = await this.db
      .select({
        level: sql<string>`case
          when ${matches.confidence} >= 65 then '高(≥65%)'
          when ${matches.confidence} >= 58 then '中(58-65%)'
          else '低(<58%)'
        end`,
        total: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
      })
      .from(matches)
       .where(and(
        eq(matches.matchStatus, 'finished'),
        gte(matches.businessDate, startStr),
        lt(matches.businessDate, endNextStr),
      ))
      .groupBy(sql`case
          when ${matches.confidence} >= 65 then '高(≥65%)'
          when ${matches.confidence} >= 58 then '中(58-65%)'
          else '低(<58%)'
        end`);

    const confOrder = ['高(≥65%)', '中(58-65%)', '低(<58%)'];
    const confMap = new Map<string, { total: number; hits: number }>();
    for (const r of confRows) {
      confMap.set(r.level, { total: Number(r.total), hits: Number(r.hits) });
    }
    const byConfidence = confOrder.map((level) => {
      const r = confMap.get(level) ?? { total: 0, hits: 0 };
      return {
        level,
        hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 1000 : 0,
        samples: r.total,
      };
    });

    // ===== byHandicap: handicap depth =====
    const hcRows = await this.db
      .select({
        range: sql<string>`case
          when abs(${matches.handicap}::numeric) <= 1 then '浅盘(让0/1球)'
          when abs(${matches.handicap}::numeric) <= 2 then '中盘(让2球)'
          else '深盘(让≥3球)'
        end`,
        total: sql<number>`count(*) filter (where ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球')`,
        hits: sql<number>`count(*) filter (where ${matches.hitHandicap} = true)`,
      })
      .from(matches)
       .where(and(
        eq(matches.matchStatus, 'finished'),
        gte(matches.businessDate, startStr),
        lt(matches.businessDate, endNextStr),
        sql`${matches.handicap} ~ '^-?\d+(\.\d+)?$'`,
      ))
      .groupBy(sql`case
          when abs(${matches.handicap}::numeric) <= 1 then '浅盘(让0/1球)'
          when abs(${matches.handicap}::numeric) <= 2 then '中盘(让2球)'
          else '深盘(让≥3球)'
        end`);

    const hcOrder = ['浅盘(让0/1球)', '中盘(让2球)', '深盘(让≥3球)'];
    const hcMap = new Map<string, { total: number; hits: number }>();
    for (const r of hcRows) {
      hcMap.set(r.range, { total: Number(r.total), hits: Number(r.hits) });
    }
    const byHandicap = hcOrder.map((range) => {
      const r = hcMap.get(range) ?? { total: 0, hits: 0 };
      return {
        range,
        hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 1000 : 0,
        samples: r.total,
      };
    });

    // ===== byMonth: monthly wdw + overUnder trend =====
    const monthRows = await this.db
      .select({
        month: sql<string>`to_char(${matches.businessDate}, 'YYYY-MM')`,
        samples: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        wdwHits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        ouHits: sql<number>`count(*) filter (where ${matches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）'))`,
      })
      .from(matches)
      .where(and(
        eq(matches.matchStatus, 'finished'),
        gte(matches.businessDate, startStr),
        lt(matches.businessDate, endNextStr),
      ))
      .groupBy(sql`to_char(${matches.businessDate}, 'YYYY-MM')`)
      .orderBy(asc(sql`to_char(${matches.businessDate}, 'YYYY-MM')`));

    const byMonth = monthRows.map((row) => {
      const wdwT = Number(row.wdwTotal);
      const ouT = Number(row.ouTotal);
      return {
        month: row.month,
        wdwHit: wdwT > 0 ? Math.round((Number(row.wdwHits) / wdwT) * 1000) / 1000 : 0,
        overRate: ouT > 0 ? Math.round((Number(row.ouHits) / ouT) * 1000) / 1000 : 0,
        samples: Number(row.samples),
      };
    });

    // ===== detailList: 最近 100 场已完赛且有预测的比赛明细 =====
    const detailRows = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        league: matches.league,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        kickoffTime: matches.kickoffTime,
        predictionDirection: matches.predictionDirection,
        hitWdw: matches.hitWdw,
        hitHandicap: matches.hitHandicap,
        hitOverunder: matches.hitOverunder,
        confidence: matches.confidence,
      })
      .from(matches)
       .where(and(
        eq(matches.matchStatus, 'finished'),
        gte(matches.businessDate, startStr),
        lt(matches.businessDate, endNextStr),
        sql`${matches.predictionDirection} in ('主胜', '平', '客胜')`,
      ))
      .orderBy(desc(matches.kickoffTime))
      .limit(100);

    const detailList = detailRows.map((row) => ({
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      predictionDirection: row.predictionDirection,
      hitWdw: row.hitWdw,
      hitHandicap: row.hitHandicap,
      hitOverunder: row.hitOverunder,
      confidence: Number(row.confidence),
    }));

    return {
      hasData: true,
      totalSamples,
      dateRange: { start: startStr, end: endStr, days },
      byLeague,
      byConfidence,
      byHandicap,
      byMonth,
      detailList,
    };
  }

  private resolveBacktestRange(params?: { startDate?: string; endDate?: string; days?: number }): {
    start: Date;
    end: Date;
    days: number;
  } {
    const now = new Date();
    if (params?.startDate && params?.endDate) {
      const s = new Date(params.startDate + 'T00:00:00');
      const e = new Date(params.endDate + 'T23:59:59');
      const diffMs = e.getTime() - s.getTime();
      const d = Math.max(1, Math.round(diffMs / (24 * 3600 * 1000)));
      return { start: s, end: e, days: d };
    }
    const daysParam = params?.days ?? 30;
    const clampedDays = Math.max(1, Math.min(365, daysParam));
    const start = new Date(now.getTime() - (clampedDays - 1) * 24 * 3600 * 1000);
    return { start, end: now, days: clampedDays };
  }

  async getPredictionAccuracy(days: number): Promise<PredictionAccuracyResponse> {
    const now = new Date();
    const startDate = new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000);
    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateStr = now.toISOString().slice(0, 10);

    const [overviewRow] = await this.db
      .select({
        totalFinished: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished')`,
        directionalCount: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        wdwHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜') and ${matches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜') and ${matches.hitWdw} is not null)`,
        hcHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球' and ${matches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球' and ${matches.hitHandicap} is not null)`,
        ouHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）') and ${matches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）') and ${matches.hitOverunder} is not null)`,
      })
      .from(matches)
      .where(and(
        gte(matches.businessDate, startDateStr),
        lt(matches.businessDate, this.addDaysStr(endDateStr, 1)),
      ));

    const totalFinished = Number(overviewRow.totalFinished);
    const directionalCount = Number(overviewRow.directionalCount);
    const wdwTotal = Number(overviewRow.wdwTotal);
    const wdwHits = Number(overviewRow.wdwHits);
    const hcTotal = Number(overviewRow.hcTotal);
    const hcHits = Number(overviewRow.hcHits);
    const ouTotal = Number(overviewRow.ouTotal);
    const ouHits = Number(overviewRow.ouHits);

    const dailyRows = await this.db
      .select({
        date: matches.businessDate,
        wdwHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜') and ${matches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜') and ${matches.hitWdw} is not null)`,
        hcHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球' and ${matches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球' and ${matches.hitHandicap} is not null)`,
        ouHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）') and ${matches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）') and ${matches.hitOverunder} is not null)`,
      })
      .from(matches)
      .where(and(
        gte(matches.businessDate, startDateStr),
        lt(matches.businessDate, this.addDaysStr(endDateStr, 1)),
      ))
      .groupBy(matches.businessDate)
      .orderBy(asc(matches.businessDate));

    const dailyTrend: PredictionAccuracyResponse['dailyTrend'] = dailyRows
      .filter((row) => Number(row.wdwTotal) > 0 || Number(row.hcTotal) > 0 || Number(row.ouTotal) > 0)
      .map((row) => {
        const wT = Number(row.wdwTotal);
        const hT = Number(row.hcTotal);
        const oT = Number(row.ouTotal);
        return {
          date: String(row.date),
          wdwRate: wT > 0 ? Math.round((Number(row.wdwHits) / wT) * 1000) / 1000 : 0,
          wdwTotal: wT,
          handicapRate: hT > 0 ? Math.round((Number(row.hcHits) / hT) * 1000) / 1000 : 0,
          handicapTotal: hT,
          overUnderRate: oT > 0 ? Math.round((Number(row.ouHits) / oT) * 1000) / 1000 : 0,
          overUnderTotal: oT,
        };
      });

    const calcRate = (h: number, t: number): number =>
      t > 0 ? Math.round((h / t) * 1000) / 1000 : 0;

    return {
      hasData: wdwTotal > 0 || hcTotal > 0 || ouTotal > 0,
      sampleSize: wdwTotal,
      totalFinished,
      directionalCount,
      directionRate: calcRate(directionalCount, totalFinished),
      days,
      updatedAt: new Date().toISOString(),
      wdw: {
        hitRate: calcRate(wdwHits, wdwTotal),
        total: wdwTotal,
        hits: wdwHits,
      },
      handicap: {
        hitRate: calcRate(hcHits, hcTotal),
        total: hcTotal,
        hits: hcHits,
      },
      overUnder: {
        hitRate: calcRate(ouHits, ouTotal),
        total: ouTotal,
        hits: ouHits,
      },
      dailyTrend,
    };
  }

  private addDaysStr(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  async getStats(): Promise<MatchStatsResponse> {
    // ===== Overview: total & hit rates =====
    const [overviewRow] = await this.db
      .select({
        totalFinished: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished')`,
        wdwHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        hcHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球')`,
        ouHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分', '大球（主推）', '小球（主推）'))`,
      })
      .from(matches);

    const totalMatches = Number(overviewRow.totalFinished);
    const wdwTotal = Number(overviewRow.wdwTotal);
    const hcTotal = Number(overviewRow.hcTotal);
    const ouTotal = Number(overviewRow.ouTotal);
    const winDrawWinHitRate = wdwTotal > 0
      ? Math.round((Number(overviewRow.wdwHits) / wdwTotal) * 1000) / 1000
      : 0;
    const handicapHitRate = hcTotal > 0
      ? Math.round((Number(overviewRow.hcHits) / hcTotal) * 1000) / 1000
      : 0;
    const overUnderHitRate = ouTotal > 0
      ? Math.round((Number(overviewRow.ouHits) / ouTotal) * 1000) / 1000
      : 0;

    // ===== byLeague: wdw hit rate per league =====
    const leagueRows = await this.db
      .select({
        league: matches.league,
        count: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
      })
      .from(matches)
      .where(eq(matches.matchStatus, 'finished'))
      .groupBy(matches.league)
      .orderBy(desc(sql`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`));

    const byLeague = leagueRows.map((row) => {
      const c = Number(row.count);
      return {
        league: row.league,
        count: c,
        hitRate: c > 0 ? Math.round((Number(row.hits) / c) * 1000) / 1000 : 0,
      };
    });

    // ===== byDate: last 14 days wdw hit rate =====
    const [latestDateRow] = await this.db
      .select({ latest: sql<string>`max(${matches.businessDate})::text` })
      .from(matches)
      .where(eq(matches.matchStatus, 'finished'));

    const byDate: { date: string; count: number; hitRate: number }[] = [];
    if (latestDateRow.latest) {
      const latest = latestDateRow.latest;
      const startDate = this.getDateOffset(latest, -13); // 14 days including latest

      const dateRows = await this.db
        .select({
          businessDate: matches.businessDate,
          count: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
          hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
        })
        .from(matches)
         .where(and(
          eq(matches.matchStatus, 'finished'),
          gte(matches.businessDate, startDate),
          lt(matches.businessDate, this.getNextDate(latest)),
        ))
        .groupBy(matches.businessDate)
        .orderBy(asc(matches.businessDate));

      const dateMap = new Map<string, { count: number; hits: number }>();
      for (const r of dateRows) {
        dateMap.set(r.businessDate.toString(), { count: Number(r.count), hits: Number(r.hits) });
      }

      let current = startDate;
      while (current <= latest) {
        const r = dateMap.get(current);
        if (r) {
          byDate.push({
            date: current,
            count: r.count,
            hitRate: r.count > 0 ? Math.round((r.hits / r.count) * 1000) / 1000 : 0,
          });
        } else {
          byDate.push({ date: current, count: 0, hitRate: 0 });
        }
        current = this.getNextDate(current);
      }
    }

    // ===== byRule: unnest model_rules, top 10 by hit count =====
    const ruleRows = await this.db
      .select({
        ruleCode: sql<string>`unnest(${matches.modelRules})`,
        count: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
      })
      .from(matches)
      .where(eq(matches.matchStatus, 'finished'))
      .groupBy(sql`unnest(${matches.modelRules})`)
      .orderBy(desc(sql`count(*) filter (where ${matches.hitWdw} = true)`))
      .limit(10);

    const ruleCodes = ruleRows.map((r) => r.ruleCode).filter(Boolean);
    let ruleNameMap = new Map<string, string>();
    if (ruleCodes.length > 0) {
      const ruleDetails = await this.db
        .select({ ruleCode: modelRuleDetails.ruleCode, ruleName: modelRuleDetails.ruleName })
        .from(modelRuleDetails)
        .where(sql`${modelRuleDetails.ruleCode} = ANY(ARRAY[${sql.join(ruleCodes.map((c) => sql`${c}`), sql`, `)}]::text[])`);
      for (const rd of ruleDetails) {
        ruleNameMap.set(rd.ruleCode, rd.ruleName);
      }
    }

    const byRule = ruleRows.map((row) => {
      const c = Number(row.count);
      return {
        ruleCode: row.ruleCode,
        ruleName: ruleNameMap.get(row.ruleCode) || row.ruleCode,
        count: c,
        hitRate: c > 0 ? Math.round((Number(row.hits) / c) * 1000) / 1000 : 0,
      };
    });

    // ===== byConfidence: high/medium/low =====
    const confidenceRows = await this.db
      .select({
        level: sql<string>`case
          when ${matches.confidence} >= 65 then '高(≥65%)'
          when ${matches.confidence} >= 58 then '中(58-65%)'
          else '低(<58%)'
        end`,
        count: sql<number>`count(*) filter (where ${matches.predictionDirection} in ('主胜', '平', '客胜'))`,
        hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
      })
      .from(matches)
      .where(eq(matches.matchStatus, 'finished'))
      .groupBy(sql`case
          when ${matches.confidence} >= 65 then '高(≥65%)'
          when ${matches.confidence} >= 58 then '中(58-65%)'
          else '低(<58%)'
        end`);

    const confidenceOrder = ['高(≥65%)', '中(58-65%)', '低(<58%)'];
    const confidenceMap = new Map<string, { count: number; hits: number }>();
    for (const r of confidenceRows) {
      confidenceMap.set(r.level, { count: Number(r.count), hits: Number(r.hits) });
    }
    const byConfidence = confidenceOrder.map((level) => {
      const r = confidenceMap.get(level) ?? { count: 0, hits: 0 };
      return {
        level,
        count: r.count,
        hitRate: r.count > 0 ? Math.round((r.hits / r.count) * 1000) / 1000 : 0,
      };
    });

    // ===== byHandicap: shallow/mid/deep =====
    const handicapRows = await this.db
      .select({
        type: sql<string>`case
          when abs(${matches.handicap}::numeric) <= 1 then '浅盘(让0/1球)'
          when abs(${matches.handicap}::numeric) <= 2 then '中盘(让2球)'
          else '深盘(让≥3球)'
        end`,
        count: sql<number>`count(*) filter (where ${matches.handicapRecommendation} is not null and ${matches.handicapRecommendation} <> '' and ${matches.handicapRecommendation} not like '%观望%' and ${matches.handicapRecommendation} <> '暂无让球')`,
        hits: sql<number>`count(*) filter (where ${matches.hitHandicap} = true)`,
      })
      .from(matches)
      .where(and(
        eq(matches.matchStatus, 'finished'),
        sql`${matches.handicap} ~ '^-?\d+(\.\d+)?$'`,
      ))
      .groupBy(sql`case
          when abs(${matches.handicap}::numeric) <= 1 then '浅盘(让0/1球)'
          when abs(${matches.handicap}::numeric) <= 2 then '中盘(让2球)'
          else '深盘(让≥3球)'
        end`);

    const handicapOrder = ['浅盘(让0/1球)', '中盘(让2球)', '深盘(让≥3球)'];
    const handicapMap = new Map<string, { count: number; hits: number }>();
    for (const r of handicapRows) {
      handicapMap.set(r.type, { count: Number(r.count), hits: Number(r.hits) });
    }
    const byHandicap = handicapOrder.map((type) => {
      const r = handicapMap.get(type) ?? { count: 0, hits: 0 };
      return {
        type,
        count: r.count,
        hitRate: r.count > 0 ? Math.round((r.hits / r.count) * 1000) / 1000 : 0,
      };
    });

    return {
      totalMatches,
      finishedMatches: totalMatches,
      winDrawWinHitRate,
      handicapHitRate,
      overUnderHitRate,
      byLeague,
      byDate,
      byRule,
      byConfidence,
      byHandicap,
    };
  }

  async recalculateTotalGoalsHits(): Promise<{ updatedCount: number }> {
    // 单条批量 UPDATE：用 CASE WHEN 在 SQL 内计算命中，避免 N+1 循环查询
    const updated = await this.db
      .update(matches)
      .set({
        hitOverunder: sql<boolean>`
          CASE ${matches.totalPick}
            WHEN '0-1球' THEN (COALESCE(${matches.homeScore}, 0) + COALESCE(${matches.awayScore}, 0)) <= 1
            WHEN '2-3球' THEN (COALESCE(${matches.homeScore}, 0) + COALESCE(${matches.awayScore}, 0)) BETWEEN 2 AND 3
            WHEN '4-6球' THEN (COALESCE(${matches.homeScore}, 0) + COALESCE(${matches.awayScore}, 0)) BETWEEN 4 AND 6
            WHEN '7+球' THEN (COALESCE(${matches.homeScore}, 0) + COALESCE(${matches.awayScore}, 0)) >= 7
            ELSE ${matches.hitOverunder}
          END
        `,
      })
      .where(and(
        eq(matches.matchStatus, 'finished'),
        sql`${matches.totalPick} IN ('0-1球', '2-3球', '4-6球', '7+球')`,
      ))
      .returning({ id: matches.id });

    const updatedCount = updated.length;
    this.logger.log(`总进球档位命中重算完成，共更新 ${updatedCount} 场`);
    return { updatedCount };
  }

  private getDateOffset(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  async getLiveScores(date: string): Promise<LiveScoreResponse> {
    try {
      const nextDate = this.getNextDate(date);
      const rows = await this.db
        .select({
          id: matches.id,
          matchNo: matches.matchNo,
          matchStatus: matches.matchStatus,
          homeScore: matches.homeScore,
          awayScore: matches.awayScore,
          kickoffTime: matches.kickoffTime,
        })
        .from(matches)
        .where(and(gte(matches.businessDate, date), lt(matches.businessDate, nextDate)))
        .orderBy(asc(matches.kickoffTime), asc(matches.matchNo));

      const items: LiveScoreItem[] = rows.map((row) => ({
        id: row.id,
        matchNo: row.matchNo ?? '',
        matchStatus: row.matchStatus ?? 'upcoming',
        homeScore: row.homeScore ?? null,
        awayScore: row.awayScore ?? null,
        matchTime: null,
        kickoffTime: row.kickoffTime?.toISOString() ?? '',
      }));

      let liveCount = 0;
      let upcomingCount = 0;
      let finishedCount = 0;
      for (const it of items) {
        if (it.matchStatus === 'live') liveCount += 1;
        else if (it.matchStatus === 'upcoming') upcomingCount += 1;
        else if (it.matchStatus === 'finished') finishedCount += 1;
      }

      return {
        items,
        lastSyncAt: new Date().toISOString(),
        liveCount,
        upcomingCount,
        finishedCount,
      };
    } catch (error) {
      this.logger.error(`获取实时比分失败 date=${date}`, JSON.stringify(error));
      throw error;
    }
  }

  async getListByDate(params: ListQueryParams): Promise<MatchListResponse> {
    const {
      date,
      league,
      confidence,
      direction,
      sort = 'kickoff_asc',
      status,
      source,
      sourceFilter,
      page = 1,
      pageSize = 50,
    } = params;
    const actualPage = Math.max(1, page);
    const actualPageSize = Math.min(Math.max(1, pageSize), 200);
    try {
      const nextDate = this.getNextDate(date);
      const conditions = [
        gte(matches.businessDate, date),
        lt(matches.businessDate, nextDate),
      ];

      if (league) {
        conditions.push(ilike(matches.league, `%${league}%`));
      }
      if (confidence === 'high') {
        conditions.push(gte(matches.confidence, 60));
      } else if (confidence === 'medium') {
        conditions.push(and(gte(matches.confidence, 40), lt(matches.confidence, 60)));
      } else if (confidence === 'low') {
        conditions.push(lt(matches.confidence, 40));
      }
      if (direction) {
        conditions.push(eq(matches.predictionDirection, direction));
      }
      if (status) {
        conditions.push(eq(matches.matchStatus, status));
      }
      if (source) {
        conditions.push(eq(matches.source, source));
      }
      if (sourceFilter === 'official') {
        conditions.push(inArray(matches.source, ['sporttery', 'beidan']));
      } else if (sourceFilter === 'jingcai') {
        conditions.push(eq(matches.source, 'sporttery'));
        conditions.push(not(inArray(matches.league, ['Diff Batch', 'Perf55b'])));
      } else if (sourceFilter === 'beidan') {
        conditions.push(eq(matches.source, 'beidan'));
      } else if (sourceFilter === 'international') {
        conditions.push(not(inArray(matches.source, ['sporttery', 'beidan'])));
      } else if (sourceFilter === 'others') {
        conditions.push(not(eq(matches.source, 'sporttery')));
      }

      const orderBy = sort === 'confidence_desc'
        ? [desc(matches.confidence), asc(matches.matchNo)]
        : [asc(matches.kickoffTime), asc(matches.matchNo)];

      const [{ total }] = await this.db
        .select({ total: count() })
        .from(matches)
        .where(and(...conditions));

      const [{ highConfCount }] = await this.db
        .select({ highConfCount: count() })
        .from(matches)
        .where(and(...conditions, gte(matches.confidence, 65)));

      const rows = await this.db
        .select({
          id: matches.id,
          matchNo: matches.matchNo,
          matchDate: matches.matchDate,
          league: matches.league,
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
          kickoffTime: matches.kickoffTime,
          matchStatus: matches.matchStatus,
          homeWinProb: matches.homeWinProb,
          drawProb: matches.drawProb,
          awayWinProb: matches.awayWinProb,
          predictionDirection: matches.predictionDirection,
          confidence: matches.confidence,
          lowConfidence: matches.lowConfidence,
          handicap: matches.handicap,
          handicapRecommendation: matches.handicapRecommendation,
          handicapType: matches.handicapType,
          totalGoals: matches.totalGoals,
          totalPick: matches.totalPick,
          mostLikelyScore: matches.mostLikelyScore,
          homeScore: matches.homeScore,
          awayScore: matches.awayScore,
          homeHalfScore: matches.homeHalfScore,
          awayHalfScore: matches.awayHalfScore,
          liveScoreSource: matches.liveScoreSource,
          lastScoreAt: matches.lastScoreAt,
          lastDataSyncAt: matches.lastDataSyncAt,
          oddsOpenHome: matches.oddsOpenHome,
          oddsOpenDraw: matches.oddsOpenDraw,
          oddsOpenAway: matches.oddsOpenAway,
          oddsLiveHome: matches.oddsLiveHome,
          oddsLiveDraw: matches.oddsLiveDraw,
          oddsLiveAway: matches.oddsLiveAway,
          source: matches.source,
          businessDate: matches.businessDate,
          hitWdw: matches.hitWdw,
          hitHandicap: matches.hitHandicap,
          hitOverunder: matches.hitOverunder,
          modelRules: matches.modelRules,
          handicapOddsHome: matches.handicapOddsHome,
          handicapOddsDraw: matches.handicapOddsDraw,
          handicapOddsAway: matches.handicapOddsAway,
          totalOddsOver: matches.totalOddsOver,
          totalOddsUnder: matches.totalOddsUnder,
          overUnder: matches.overUnder,
          overProb: matches.overProb,
          underProb: matches.underProb,
           totalPickProb: matches.totalPickProb,
           totalGoalsProb: matches.totalGoalsProb,
           handicapWinProb: matches.handicapWinProb,
          handicapDrawProb: matches.handicapDrawProb,
          handicapLoseProb: matches.handicapLoseProb,
           sourceMatchId: matches.sourceMatchId,
           intel: matches.intel,
            errorReason: matches.errorReason,
            livePeriod: matches.livePeriod,
            liveClock: matches.liveClock,
            predEngineVersion: matches.predEngineVersion,
           homeInjuries: matches.homeInjuries,
           awayInjuries: matches.awayInjuries,
           injuries: matches.injuries,
           keyPlayersHome: matches.keyPlayersHome,
           keyPlayersAway: matches.keyPlayersAway,
           teamNews: matches.teamNews,
           upsetWarning: matches.upsetWarning,
         })
        .from(matches)
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(actualPageSize)
        .offset((actualPage - 1) * actualPageSize);

      const items: MatchItem[] = rows.map((row) => {
       const item = this.toMatchListItem(row as unknown as Parameters<MatchesService['toMatchListItem']>[0]);
       if (item.intel && item.intel.length > 120) {
         (item as { intel: string }).intel = item.intel.replace(/\s+/g, ' ').slice(0, 117) + '...';
       }
       return item;
     });

      // Lazy-trigger ESPN/qiumibao sync if any live/today-upcoming match is stale
      const todayBeijing = this.getBeijingDateStr(new Date());
      let oldestLiveSync: Date | null = null;
      let oldestUpcomingSync: Date | null = null;
      let hasLive = false;
      let hasTodayUpcoming = false;
      for (const row of rows) {
        if (row.matchStatus === 'live') {
          hasLive = true;
          const syncAt = row.lastDataSyncAt ? new Date(row.lastDataSyncAt) : null;
          if (!oldestLiveSync || (syncAt && syncAt < oldestLiveSync)) oldestLiveSync = syncAt;
        } else if (row.matchStatus === 'upcoming' && String(row.businessDate) === todayBeijing) {
          hasTodayUpcoming = true;
          const syncAt = row.lastDataSyncAt ? new Date(row.lastDataSyncAt) : null;
          if (!oldestUpcomingSync || (syncAt && syncAt < oldestUpcomingSync)) oldestUpcomingSync = syncAt;
        }
      }
      if (hasLive) {
        this.sportteryService.lazyTriggerFootballSync(oldestLiveSync, 'live');
      } else if (hasTodayUpcoming) {
        this.sportteryService.lazyTriggerFootballSync(oldestUpcomingSync, 'upcoming');
      }

      return {
        items,
        date,
        beidanEnabled: isBeidanEnabled(),
        total: Number(total),
        highConfCount: Number(highConfCount),
        page: actualPage,
        pageSize: actualPageSize,
      };
    } catch (error) {
      this.logger.error(`获取比赛列表失败 date=${date}`, JSON.stringify(error));
      throw error;
    }
  }

  async exportAll(): Promise<MatchItem[]> {
    const rows: (typeof matches.$inferSelect)[] = await this.db
      .select()
      .from(matches)
      .orderBy(desc(matches.businessDate), asc(matches.matchNo))
      .limit(5000);
    return rows.map((row) => this.toMatchItem(row));
  }

  async getById(id: string): Promise<MatchDetailResponse> {
    try {
      const rows: (typeof matches.$inferSelect)[] = await this.db
        .select()
        .from(matches)
        .where(eq(matches.id, id))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundException('比赛不存在');
      }

      const matchRow = rows[0];
      const match = this.toMatchItem(matchRow);

      const todayBeijing = this.getBeijingDateStr(new Date());
      if (matchRow.matchStatus === 'live') {
        this.sportteryService.lazyTriggerFootballSync(
          matchRow.lastDataSyncAt ? new Date(matchRow.lastDataSyncAt) : null,
          'live',
        );
      } else if (matchRow.matchStatus === 'upcoming' && String(matchRow.businessDate) === todayBeijing) {
        this.sportteryService.lazyTriggerFootballSync(
          matchRow.lastDataSyncAt ? new Date(matchRow.lastDataSyncAt) : null,
          'upcoming',
        );
      }

      try {
        const h2hRows = await this.db
          .select()
          .from(h2hRecords)
          .where(sql`
            (${h2hRecords.homeTeam} = ${match.homeTeam} AND ${h2hRecords.awayTeam} = ${match.awayTeam})
            OR (${h2hRecords.homeTeam} = ${match.awayTeam} AND ${h2hRecords.awayTeam} = ${match.homeTeam})
          `)
          .orderBy(desc(h2hRecords.matchDate))
          .limit(5);

        if (h2hRows.length > 0) {
          match.h2h = h2hRows.map((row: typeof h2hRecords.$inferSelect) =>
            JSON.stringify({
              date: String(row.matchDate).slice(0, 10),
              league: row.league,
              home: row.homeTeam,
              away: row.awayTeam,
              homeScore: row.homeScore,
              awayScore: row.awayScore,
            })
          );
          if (matchRow.mostLikelyScore && h2hRows.length > 0 && match.scoreProbs.length === 0) {
            match.mostLikelyScore = matchRow.mostLikelyScore;
          }
        }
      } catch (h2hErr) {
        this.logger.warn(`获取H2H数据失败 id=${id}`, JSON.stringify(h2hErr));
      }

      let injuryReportsData: typeof injuryReports.$inferSelect[] = [];
      try {
        injuryReportsData = await this.db
          .select()
          .from(injuryReports)
          .where(and(eq(injuryReports.matchId, id), eq(injuryReports.sport, 'football')))
          .orderBy(injuryReports.teamSide, injuryReports.impactRating);
      } catch (injErr) {
        this.logger.warn(`获取伤停数据失败 id=${id}`, JSON.stringify(injErr));
      }

      const injurySummary = {
        homeHigh: injuryReportsData.filter((r) => r.teamSide === 'home' && r.impactRating === 'high').length,
        homeMedium: injuryReportsData.filter((r) => r.teamSide === 'home' && r.impactRating === 'medium').length,
        awayHigh: injuryReportsData.filter((r) => r.teamSide === 'away' && r.impactRating === 'high').length,
        awayMedium: injuryReportsData.filter((r) => r.teamSide === 'away' && r.impactRating === 'medium').length,
      };

      return { match, injuryReports: injuryReportsData as unknown as InjuryReport[], injurySummary };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`获取比赛详情失败 id=${id}`, JSON.stringify(error));
      throw error;
    }
  }

   async getMatchOdds(id: string): Promise<MatchOddsResponse> {
     try {
       const matchRows = await this.db
         .select({ id: matches.id })
         .from(matches)
         .where(eq(matches.id, id))
         .limit(1);
       if (matchRows.length === 0) {
         throw new NotFoundException('比赛不存在');
       }

       const rows = await this.db
         .select()
         .from(oddsRecords)
         .where(eq(oddsRecords.matchId, id))
         .orderBy(asc(oddsRecords.snapshotTime));

       const records: OddsRecordItem[] = rows
         .map((row: typeof oddsRecords.$inferSelect) => this.toOddsRecordItem(row));

       const openOdds = records.find((r: OddsRecordItem) => r.isInitial);
       const liveRecords = records.filter((r: OddsRecordItem) => !r.isInitial);
       const liveOdds = liveRecords.length > 0 ? liveRecords[liveRecords.length - 1] : undefined;

       const homeChange = openOdds?.homeValue && liveOdds?.homeValue && openOdds.homeValue > 0
         ? ((liveOdds.homeValue - openOdds.homeValue) / openOdds.homeValue) * 100
         : 0;
       const drawChange = openOdds?.drawValue && liveOdds?.drawValue && openOdds.drawValue > 0
         ? ((liveOdds.drawValue - openOdds.drawValue) / openOdds.drawValue) * 100
         : 0;
       const awayChange = openOdds?.awayValue && liveOdds?.awayValue && openOdds.awayValue > 0
         ? ((liveOdds.awayValue - openOdds.awayValue) / openOdds.awayValue) * 100
         : 0;

       const hasMajorMove = Math.abs(homeChange) > 10
         || Math.abs(drawChange) > 10
         || Math.abs(awayChange) > 10;

       return {
         records,
         openOdds,
         liveOdds,
         changes: { homeChange, drawChange, awayChange, hasMajorMove },
       };
     } catch (error) {
       if (error instanceof NotFoundException) throw error;
        this.logger.error(`获取比赛指数失败 id=${id}`, JSON.stringify(error));
       throw error;
     }
   }

  async getOddsTrend(matchId: string): Promise<OddsTrendResponse> {
    const matchRows = await this.db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (matchRows.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    const rows = await this.db
      .select()
      .from(oddsSnapshots)
      .where(eq(oddsSnapshots.matchId, matchId))
      .orderBy(asc(oddsSnapshots.createdAt));

    const items: OddsTrendPoint[] = rows
      .map((row: typeof oddsSnapshots.$inferSelect) => {
        const json = row.oddsJson as Record<string, unknown>;
        const point: OddsTrendPoint = {
          time: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          oddsType: row.oddsType as OddsTrendPoint['oddsType'],
          source: row.source ?? '',
        };
        if (json.home !== undefined && json.home !== null) point.home = Number(json.home);
        if (json.draw !== undefined && json.draw !== null) point.draw = Number(json.draw);
        if (json.away !== undefined && json.away !== null) point.away = Number(json.away);
        if (json.line !== undefined && json.line !== null) point.line = Number(json.line);
        if (json.over !== undefined && json.over !== null) point.over = Number(json.over);
        if (json.under !== undefined && json.under !== null) point.under = Number(json.under);
        return point;
      });

    const typeSet = new Set<string>();
    for (const item of items) typeSet.add(item.oddsType);

    return {
      items,
      hasData: items.length > 0,
      pointCount: items.length,
      types: Array.from(typeSet),
    };
  }

  async getMultiSource(matchId: string): Promise<MatchMultiSourceResponse> {
    const matchRows = await this.db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (matchRows.length === 0) {
      throw new NotFoundException('比赛不存在');
    }
    const match = matchRows[0];

    const snapshotRows = await this.db
      .select()
      .from(oddsSnapshots)
      .where(eq(oddsSnapshots.matchId, matchId))
      .orderBy(desc(oddsSnapshots.createdAt));

    const bySource = new Map<string, typeof oddsSnapshots.$inferSelect[]>();
    for (const row of snapshotRows) {
      const key = row.source ?? 'unknown';
      const list = bySource.get(key) ?? [];
      list.push(row);
      bySource.set(key, list);
    }

    const sources: MatchSourceOdds[] = [];
    for (const [source, list] of bySource.entries()) {
      const latest = list[0];
      const json = latest.oddsJson as Record<string, unknown>;
      const item: MatchSourceOdds = {
        source,
        updatedAt: latest.createdAt instanceof Date
          ? latest.createdAt.toISOString()
          : String(latest.createdAt),
      };
      for (const row of list) {
        const j = row.oddsJson as Record<string, unknown>;
        if (row.oddsType === '1x2') {
          if (j.home !== undefined && j.home !== null) item.homeWinOdds = Number(j.home);
          if (j.draw !== undefined && j.draw !== null) item.drawOdds = Number(j.draw);
          if (j.away !== undefined && j.away !== null) item.awayWinOdds = Number(j.away);
        } else if (row.oddsType === 'handicap') {
          if (j.line !== undefined && j.line !== null) item.handicap = String(j.line);
          if (j.home !== undefined && j.home !== null) item.handicapOddsHome = Number(j.home);
          if (j.away !== undefined && j.away !== null) item.handicapOddsAway = Number(j.away);
        } else if (row.oddsType === 'total') {
          if (j.line !== undefined && j.line !== null) item.overUnder = String(j.line);
          if (j.over !== undefined && j.over !== null) item.totalOddsOver = Number(j.over);
          if (j.under !== undefined && j.under !== null) item.totalOddsUnder = Number(j.under);
        }
      }
      sources.push(item);
    }

    const matchSource = match.source ?? 'sporttery';
    const matchSourceExists = sources.some((s: MatchSourceOdds) => s.source === matchSource);
    if (!matchSourceExists) {
      const matchSourceItem: MatchSourceOdds = {
        source: matchSource,
        updatedAt: match.updatedAt instanceof Date
          ? match.updatedAt.toISOString()
          : String(match.updatedAt ?? match.createdAt),
      };
      if (match.oddsOpenHome != null) matchSourceItem.homeWinOdds = Number(match.oddsOpenHome);
      if (match.oddsOpenDraw != null) matchSourceItem.drawOdds = Number(match.oddsOpenDraw);
      if (match.oddsOpenAway != null) matchSourceItem.awayWinOdds = Number(match.oddsOpenAway);
      if (match.handicap != null) matchSourceItem.handicap = String(match.handicap);
      if (match.handicapOddsHome != null) matchSourceItem.handicapOddsHome = Number(match.handicapOddsHome);
      if (match.handicapOddsAway != null) matchSourceItem.handicapOddsAway = Number(match.handicapOddsAway);
      if (match.overUnder != null) matchSourceItem.overUnder = String(match.overUnder);
      if (match.totalOddsOver != null) matchSourceItem.totalOddsOver = Number(match.totalOddsOver);
      if (match.totalOddsUnder != null) matchSourceItem.totalOddsUnder = Number(match.totalOddsUnder);
      sources.unshift(matchSourceItem);
    }

    return {
      matchId,
      sources,
      hasComparison: sources.length >= 2,
    };
  }

  async create(dto: CreateMatchRequest, userId: string): Promise<MatchDetailResponse> {
    try {
      const values: typeof matches.$inferInsert = this.buildMatchInsertValues(dto, userId);
      if (Array.isArray(values.modelRules) && values.modelRules.length > 0) {
        values.modelRules = await this.filterDisabledRules(values.modelRules);
      }
      const rows = await this.db
        .insert(matches)
        .values(values)
        .returning();

      return { match: this.toMatchItem(rows[0]) };
    } catch (error) {
      this.logger.error('创建比赛失败', JSON.stringify(error));
      throw error;
    }
  }

  async update(id: string, dto: UpdateMatchRequest, userId: string): Promise<MatchDetailResponse> {
    try {
      const existingRows: (typeof matches.$inferSelect)[] = await this.db
        .select()
        .from(matches)
        .where(eq(matches.id, id))
        .limit(1);
      if (existingRows.length === 0) {
        throw new NotFoundException('比赛不存在');
      }
      const existing = existingRows[0];

      const patch: Partial<typeof matches.$inferInsert> = {};
      if (dto.matchNo !== undefined) patch.matchNo = dto.matchNo;
      if (dto.league !== undefined) patch.league = dto.league;
      if (dto.homeTeam !== undefined) patch.homeTeam = dto.homeTeam;
      if (dto.awayTeam !== undefined) patch.awayTeam = dto.awayTeam;
      if (dto.kickoffTime !== undefined) patch.kickoffTime = new Date(dto.kickoffTime);
      if (dto.homeWinProb !== undefined) patch.homeWinProb = dto.homeWinProb;
      if (dto.drawProb !== undefined) patch.drawProb = dto.drawProb;
      if (dto.awayWinProb !== undefined) patch.awayWinProb = dto.awayWinProb;
      if (dto.predictionDirection !== undefined) patch.predictionDirection = dto.predictionDirection;
      if (dto.handicap !== undefined) patch.handicap = dto.handicap;
      if (dto.handicapRecommendation !== undefined) patch.handicapRecommendation = dto.handicapRecommendation;
      if (dto.confidence !== undefined) patch.confidence = dto.confidence;
      if (dto.lowConfidence !== undefined) patch.lowConfidence = dto.lowConfidence;
      if (dto.intel !== undefined) patch.intel = dto.intel;
      if (dto.modelRules !== undefined) patch.modelRules = dto.modelRules;
      if (dto.matchDate !== undefined) patch.matchDate = dto.matchDate;

      const extra = dto as Record<string, unknown>;
      if (extra.overUnder !== undefined) patch.overUnder = extra.overUnder as string;
      if (extra.overProb !== undefined) patch.overProb = extra.overProb as number;
      if (extra.underProb !== undefined) patch.underProb = extra.underProb as number;
      if (extra.totalGoals !== undefined) patch.totalGoals = String(extra.totalGoals);
      if (extra.mostLikelyScore !== undefined) patch.mostLikelyScore = extra.mostLikelyScore as string;
      if (extra.scoreProbs !== undefined) patch.scoreProbs = extra.scoreProbs as string[];
      if (extra.matchStatus !== undefined) patch.matchStatus = extra.matchStatus as string;
      if ('homeScore' in extra) patch.homeScore = extra.homeScore as number | null;
      if ('awayScore' in extra) patch.awayScore = extra.awayScore as number | null;
      if (extra.homeForm !== undefined) patch.homeForm = extra.homeForm as string[];
      if (extra.awayForm !== undefined) patch.awayForm = extra.awayForm as string[];
      if (extra.h2h !== undefined) patch.h2h = extra.h2h as string[];
      if ('oddsOpenHome' in extra) {
        patch.oddsOpenHome = extra.oddsOpenHome !== undefined && extra.oddsOpenHome !== null
          ? String(extra.oddsOpenHome)
          : null;
      }
      if ('oddsOpenDraw' in extra) {
        patch.oddsOpenDraw = extra.oddsOpenDraw !== undefined && extra.oddsOpenDraw !== null
          ? String(extra.oddsOpenDraw)
          : null;
      }
      if ('oddsOpenAway' in extra) {
        patch.oddsOpenAway = extra.oddsOpenAway !== undefined && extra.oddsOpenAway !== null
          ? String(extra.oddsOpenAway)
          : null;
      }
      if ('oddsLiveHome' in extra) {
        patch.oddsLiveHome = extra.oddsLiveHome !== undefined && extra.oddsLiveHome !== null
          ? String(extra.oddsLiveHome)
          : null;
      }
      if ('oddsLiveDraw' in extra) {
        patch.oddsLiveDraw = extra.oddsLiveDraw !== undefined && extra.oddsLiveDraw !== null
          ? String(extra.oddsLiveDraw)
          : null;
      }
      if ('oddsLiveAway' in extra) {
        patch.oddsLiveAway = extra.oddsLiveAway !== undefined && extra.oddsLiveAway !== null
          ? String(extra.oddsLiveAway)
          : null;
      }
      if (extra.drawConfidence !== undefined) patch.drawConfidence = extra.drawConfidence as string;
      if (extra.drawFactors !== undefined) patch.drawFactors = extra.drawFactors as string[];
      if (extra.handicapWinProb !== undefined) patch.handicapWinProb = String(extra.handicapWinProb);
      if (extra.handicapDrawProb !== undefined) patch.handicapDrawProb = String(extra.handicapDrawProb);
      if (extra.handicapLoseProb !== undefined) patch.handicapLoseProb = String(extra.handicapLoseProb);
      if (extra.kellyH !== undefined) patch.kellyH = String(extra.kellyH);
      if (extra.kellyD !== undefined) patch.kellyD = String(extra.kellyD);
      if (extra.kellyA !== undefined) patch.kellyA = String(extra.kellyA);
      if ('handicapSecondChoice' in extra) patch.handicapSecondChoice = extra.handicapSecondChoice as string | null;
      if (extra.handicapValueRating !== undefined) patch.handicapValueRating = extra.handicapValueRating as string;
      if (extra.rulesTriggered !== undefined) patch.rulesTriggered = JSON.stringify(extra.rulesTriggered);
      if ('hitWdw' in extra) patch.hitWdw = extra.hitWdw as boolean | null;
      if ('hitHandicap' in extra) patch.hitHandicap = extra.hitHandicap as boolean | null;
      if ('hitOverunder' in extra) patch.hitOverunder = extra.hitOverunder as boolean | null;
      if ('hitGoals' in extra) patch.hitGoals = extra.hitGoals as boolean | null;
      if ('hitHalffull' in extra) patch.hitHalffull = extra.hitHalffull as boolean | null;
      if ('errorReason' in extra) patch.errorReason = extra.errorReason as string | null;
      if (extra.tacticsHome !== undefined) patch.tacticsHome = extra.tacticsHome as string;
      if (extra.tacticsAway !== undefined) patch.tacticsAway = extra.tacticsAway as string;
      if (extra.keyPlayersHome !== undefined) patch.keyPlayersHome = extra.keyPlayersHome as string;
      if (extra.keyPlayersAway !== undefined) patch.keyPlayersAway = extra.keyPlayersAway as string;
      if (extra.upsetWarning !== undefined) patch.upsetWarning = extra.upsetWarning as string;

      const needsGate = patch.handicap !== undefined
        || patch.handicapRecommendation !== undefined
        || patch.predictionDirection !== undefined
        || patch.homeWinProb !== undefined
        || patch.drawProb !== undefined
        || patch.awayWinProb !== undefined
        || patch.confidence !== undefined
        || patch.mostLikelyScore !== undefined
        || patch.league !== undefined
        || patch.handicapWinProb !== undefined
        || patch.handicapDrawProb !== undefined
        || patch.handicapLoseProb !== undefined;
      if (needsGate) {
        const gateInput: HandicapGateInput = {
          handicapLine: String(patch.handicap ?? existing.handicap ?? '0'),
          handicapRecommendation: String(patch.handicapRecommendation ?? existing.handicapRecommendation ?? '让胜'),
          predictionDirection: String(patch.predictionDirection ?? existing.predictionDirection ?? '主胜'),
          homeWinProb: Number(patch.homeWinProb ?? existing.homeWinProb ?? 0),
          drawProb: Number(patch.drawProb ?? existing.drawProb ?? 0),
          awayWinProb: Number(patch.awayWinProb ?? existing.awayWinProb ?? 0),
          confidence: Number(patch.confidence ?? existing.confidence ?? 0),
          mostLikelyScore: String(patch.mostLikelyScore ?? existing.mostLikelyScore ?? ''),
          handicapWinProb: patch.handicapWinProb !== undefined ? Number(patch.handicapWinProb) : Number(existing.handicapWinProb ?? 0),
          handicapDrawProb: patch.handicapDrawProb !== undefined ? Number(patch.handicapDrawProb) : Number(existing.handicapDrawProb ?? 0),
          handicapLoseProb: patch.handicapLoseProb !== undefined ? Number(patch.handicapLoseProb) : Number(existing.handicapLoseProb ?? 0),
          league: String(patch.league ?? existing.league ?? ''),
          existingModelRules: Array.isArray(patch.modelRules) ? patch.modelRules : (existing.modelRules ?? []),
        };
        const gateResult = applyHandicapRules(gateInput);
        patch.handicapRecommendation = gateResult.recommendation;
        patch.modelRules = await this.filterDisabledRules(gateResult.triggeredRules);
      }

      // 赛果回填时自动计算各维度命中情况
      const finalHomeScore = patch.homeScore !== undefined ? patch.homeScore : existing.homeScore;
      const finalAwayScore = patch.awayScore !== undefined ? patch.awayScore : existing.awayScore;
      const finalStatus = (patch.matchStatus as string | undefined) ?? existing.matchStatus;

      const hasBothScores = finalHomeScore !== null && finalHomeScore !== undefined
        && finalAwayScore !== null && finalAwayScore !== undefined;
      const isFinished = finalStatus === 'finished';
      const scoresBeingUpdated = patch.homeScore !== undefined || patch.awayScore !== undefined;
      const statusBeingFinished = patch.matchStatus === 'finished';

      if (hasBothScores && isFinished && (scoresBeingUpdated || statusBeingFinished)) {
        const hitResults = this.computeHitResults(
          existing,
          Number(finalHomeScore),
          Number(finalAwayScore),
        );
        if (!('hitWdw' in extra)) patch.hitWdw = hitResults.hitWdw;
        if (!('hitHandicap' in extra)) patch.hitHandicap = hitResults.hitHandicap;
        if (!('hitOverunder' in extra)) patch.hitOverunder = hitResults.hitOverunder;
        if (!('hitGoals' in extra)) patch.hitGoals = hitResults.hitGoals;
        if (!('hitHalffull' in extra)) patch.hitHalffull = hitResults.hitHalffull;
        if (!('errorReason' in extra)) patch.errorReason = hitResults.errorReason;
      }

      if (Object.keys(patch).length === 0) {
        throw new BadRequestException('未提供可更新字段');
      }

      patch.updatedAt = new Date();
      patch.updatedBy = userId;

      const rows = await this.db
        .update(matches)
        .set(patch)
        .where(eq(matches.id, id))
        .returning();

      if (rows.length === 0) {
        throw new NotFoundException('比赛不存在');
      }

      return { match: this.toMatchItem(rows[0]) };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error(`更新比赛失败 id=${id}`, JSON.stringify(error));
      throw error;
    }
  }

  private buildMatchInsertValues(dto: CreateMatchRequest, userId: string): typeof matches.$inferInsert {
    const now = new Date();
    const kickoffDate = new Date(dto.kickoffTime);
    const notStarted = kickoffDate.getTime() > now.getTime();
    const hasScoreOrHit =
      dto.homeScore !== undefined ||
      dto.awayScore !== undefined ||
      dto.hitWdw !== undefined ||
      dto.hitHandicap !== undefined ||
      dto.hitOverunder !== undefined ||
      dto.hitGoals !== undefined ||
      dto.hitHalffull !== undefined ||
      dto.matchStatus === 'finished';
    const scoreBlocked = notStarted && hasScoreOrHit && !dto.verifiedTwoSources;
    if (scoreBlocked) {
      this.logger.warn(
        `足球写入保护(新建): 比赛 ${dto.matchNo} 开赛时间 ${kickoffDate.toISOString()} 在当前时间之后，忽略比分/命中等终场字段`,
      );
    }
    const baseModelRules = dto.modelRules ?? [];
    const gateInput: HandicapGateInput = {
      handicapLine: dto.handicap ?? '0',
      handicapRecommendation: dto.handicapRecommendation ?? '让胜',
      predictionDirection: dto.predictionDirection ?? '主胜',
      homeWinProb: dto.homeWinProb ?? 0,
      drawProb: dto.drawProb ?? 0,
      awayWinProb: dto.awayWinProb ?? 0,
      confidence: dto.confidence ?? 0,
      mostLikelyScore: dto.mostLikelyScore ?? '',
      handicapWinProb: dto.handicapWinProb ?? 0,
      handicapDrawProb: dto.handicapDrawProb ?? 0,
      handicapLoseProb: dto.handicapLoseProb ?? 0,
      league: dto.league ?? '',
      existingModelRules: baseModelRules,
    };
    const gateResult = applyHandicapRules(gateInput);
    const modelRulesWithGate = gateResult.triggeredRules;
    return {
      matchNo: dto.matchNo,
      league: dto.league,
      homeTeam: dto.homeTeam,
      awayTeam: dto.awayTeam,
      kickoffTime: new Date(dto.kickoffTime),
      homeWinProb: dto.homeWinProb,
      drawProb: dto.drawProb,
      awayWinProb: dto.awayWinProb,
      predictionDirection: dto.predictionDirection,
      handicap: dto.handicap,
      handicapRecommendation: gateResult.recommendation,
      confidence: dto.confidence,
      lowConfidence: dto.lowConfidence,
      intel: dto.intel,
      modelRules: modelRulesWithGate,
      matchDate: dto.matchDate,
      overUnder: dto.overUnder ?? '2.5',
      overProb: dto.overProb ?? 50,
      underProb: dto.underProb ?? 50,
      totalPick: dto.totalPick ?? (dto.overProb ?? 50) >= (dto.underProb ?? 50) ? '大' : '小',
      totalPickProb: dto.totalPickProb ?? Math.max(dto.overProb ?? 50, dto.underProb ?? 50),
      totalGoals: dto.totalGoals !== undefined ? String(dto.totalGoals) : '2.50',
      mostLikelyScore: dto.mostLikelyScore ?? '',
      scoreProbs: dto.scoreProbs ?? [],
      matchStatus: scoreBlocked ? 'upcoming' : (dto.matchStatus ?? 'upcoming'),
      homeScore: scoreBlocked ? null : (dto.homeScore ?? null),
      awayScore: scoreBlocked ? null : (dto.awayScore ?? null),
      homeForm: dto.homeForm ?? [],
      awayForm: dto.awayForm ?? [],
      h2h: dto.h2h ?? [],
      oddsOpenHome: dto.oddsOpenHome != null ? String(dto.oddsOpenHome) : null,
      oddsOpenDraw: dto.oddsOpenDraw != null ? String(dto.oddsOpenDraw) : null,
      oddsOpenAway: dto.oddsOpenAway != null ? String(dto.oddsOpenAway) : null,
      oddsLiveHome: dto.oddsLiveHome != null ? String(dto.oddsLiveHome) : null,
      oddsLiveDraw: dto.oddsLiveDraw != null ? String(dto.oddsLiveDraw) : null,
      oddsLiveAway: dto.oddsLiveAway != null ? String(dto.oddsLiveAway) : null,
      drawConfidence: dto.drawConfidence ?? '中',
      drawFactors: dto.drawFactors ?? [],
      handicapWinProb: dto.handicapWinProb !== undefined ? String(dto.handicapWinProb) : '0',
      handicapDrawProb: dto.handicapDrawProb !== undefined ? String(dto.handicapDrawProb) : '0',
      handicapLoseProb: dto.handicapLoseProb !== undefined ? String(dto.handicapLoseProb) : '0',
      kellyH: dto.kellyH !== undefined ? String(dto.kellyH) : '0',
      kellyD: dto.kellyD !== undefined ? String(dto.kellyD) : '0',
      kellyA: dto.kellyA !== undefined ? String(dto.kellyA) : '0',
      handicapSecondChoice: dto.handicapSecondChoice ?? '',
      handicapValueRating: dto.handicapValueRating ?? '中价值',
      rulesTriggered: dto.rulesTriggered !== undefined ? JSON.stringify(dto.rulesTriggered) : '[]',
      hitWdw: scoreBlocked ? null : (dto.hitWdw ?? null),
      hitHandicap: scoreBlocked ? null : (dto.hitHandicap ?? null),
      hitOverunder: scoreBlocked ? null : (dto.hitOverunder ?? null),
      hitGoals: scoreBlocked ? null : (dto.hitGoals ?? null),
      hitHalffull: scoreBlocked ? null : (dto.hitHalffull ?? null),
      errorReason: dto.errorReason ?? '',
      tacticsHome: this.sanitizeTextPlaceholder(dto.tacticsHome ?? ''),
      tacticsAway: this.sanitizeTextPlaceholder(dto.tacticsAway ?? ''),
      keyPlayersHome: this.sanitizeTextPlaceholder(dto.keyPlayersHome ?? ''),
      keyPlayersAway: this.sanitizeTextPlaceholder(dto.keyPlayersAway ?? ''),
      homeInjuries: this.sanitizeTextPlaceholder(dto.homeInjuries ?? ''),
      awayInjuries: this.sanitizeTextPlaceholder(dto.awayInjuries ?? ''),
      upsetWarning: this.sanitizeTextPlaceholder(dto.upsetWarning ?? ''),
      teamNews: this.sanitizeTextPlaceholder(dto.teamNews ?? ''),
      injuries: this.sanitizeTextPlaceholder(dto.injuries ?? ''),
      mediaConsensus: this.sanitizeTextPlaceholder(dto.mediaConsensus ?? ''),
      expertPicks: this.sanitizeTextPlaceholder(dto.expertPicks ?? ''),
      keyPlayers: this.sanitizeTextPlaceholder(dto.keyPlayers ?? ''),
      intelUpdatedAt: now,
      updatedAt: now,
      updatedBy: userId,
      liveScoreSource: '',
    };
  }

  private buildIncrementalPatch(dto: CreateMatchRequest, existingRules: string[] = []): Partial<typeof matches.$inferInsert> {
    const patch: Partial<typeof matches.$inferInsert> = {};
    if (dto.matchNo !== undefined) patch.matchNo = dto.matchNo;
    if (dto.league !== undefined) patch.league = dto.league;
    if (dto.homeTeam !== undefined) patch.homeTeam = dto.homeTeam;
    if (dto.awayTeam !== undefined) patch.awayTeam = dto.awayTeam;
    if (dto.kickoffTime !== undefined) patch.kickoffTime = new Date(dto.kickoffTime);
    if (dto.homeWinProb !== undefined) patch.homeWinProb = dto.homeWinProb;
    if (dto.drawProb !== undefined) patch.drawProb = dto.drawProb;
    if (dto.awayWinProb !== undefined) patch.awayWinProb = dto.awayWinProb;
    if (dto.predictionDirection !== undefined) patch.predictionDirection = dto.predictionDirection;
    if (dto.handicap !== undefined) patch.handicap = dto.handicap;
    if (dto.confidence !== undefined) patch.confidence = dto.confidence;
    if (dto.lowConfidence !== undefined) patch.lowConfidence = dto.lowConfidence;
    if (dto.intel !== undefined) patch.intel = dto.intel;
    if (dto.matchDate !== undefined) patch.matchDate = dto.matchDate;
    const needsGate = dto.handicapRecommendation !== undefined
      || dto.handicap !== undefined
      || dto.predictionDirection !== undefined
      || dto.homeWinProb !== undefined
      || dto.drawProb !== undefined
      || dto.awayWinProb !== undefined
      || dto.confidence !== undefined
      || dto.mostLikelyScore !== undefined
      || dto.league !== undefined
      || dto.handicapWinProb !== undefined
      || dto.handicapDrawProb !== undefined
      || dto.handicapLoseProb !== undefined;
    if (needsGate) {
      const gateInput: HandicapGateInput = {
        handicapLine: dto.handicap ?? patch.handicap ?? '0',
        handicapRecommendation: dto.handicapRecommendation ?? '让胜',
        predictionDirection: dto.predictionDirection ?? patch.predictionDirection ?? '主胜',
        homeWinProb: dto.homeWinProb ?? patch.homeWinProb ?? 0,
        drawProb: dto.drawProb ?? patch.drawProb ?? 0,
        awayWinProb: dto.awayWinProb ?? patch.awayWinProb ?? 0,
        confidence: dto.confidence ?? patch.confidence ?? 0,
        mostLikelyScore: dto.mostLikelyScore ?? '',
        handicapWinProb: dto.handicapWinProb ?? 0,
        handicapDrawProb: dto.handicapDrawProb ?? 0,
        handicapLoseProb: dto.handicapLoseProb ?? 0,
        league: dto.league ?? patch.league ?? '',
        existingModelRules: existingRules,
      };
      const gateResult = applyHandicapRules(gateInput);
      patch.handicapRecommendation = gateResult.recommendation;
      patch.modelRules = gateResult.triggeredRules;
    }
    if (dto.overUnder !== undefined) patch.overUnder = dto.overUnder;
    if (dto.overProb !== undefined) patch.overProb = dto.overProb;
    if (dto.underProb !== undefined) patch.underProb = dto.underProb;
    if (dto.totalPick !== undefined) patch.totalPick = dto.totalPick;
    if (dto.totalPickProb !== undefined) patch.totalPickProb = dto.totalPickProb;
    if (dto.totalGoals !== undefined) patch.totalGoals = String(dto.totalGoals);
    if (dto.mostLikelyScore !== undefined) patch.mostLikelyScore = dto.mostLikelyScore;
    if (dto.scoreProbs !== undefined) patch.scoreProbs = dto.scoreProbs;
    if (dto.matchStatus !== undefined) patch.matchStatus = dto.matchStatus;
    if (dto.homeScore !== undefined) patch.homeScore = dto.homeScore;
    if (dto.awayScore !== undefined) patch.awayScore = dto.awayScore;
    if (dto.homeForm !== undefined) patch.homeForm = dto.homeForm;
    if (dto.awayForm !== undefined) patch.awayForm = dto.awayForm;
    if (dto.h2h !== undefined) patch.h2h = dto.h2h;
    if (dto.oddsOpenHome !== undefined) {
      patch.oddsOpenHome = dto.oddsOpenHome != null ? String(dto.oddsOpenHome) : null;
    }
    if (dto.oddsOpenDraw !== undefined) {
      patch.oddsOpenDraw = dto.oddsOpenDraw != null ? String(dto.oddsOpenDraw) : null;
    }
    if (dto.oddsOpenAway !== undefined) {
      patch.oddsOpenAway = dto.oddsOpenAway != null ? String(dto.oddsOpenAway) : null;
    }
    if (dto.oddsLiveHome !== undefined) {
      patch.oddsLiveHome = dto.oddsLiveHome != null ? String(dto.oddsLiveHome) : null;
    }
    if (dto.oddsLiveDraw !== undefined) {
      patch.oddsLiveDraw = dto.oddsLiveDraw != null ? String(dto.oddsLiveDraw) : null;
    }
    if (dto.oddsLiveAway !== undefined) {
      patch.oddsLiveAway = dto.oddsLiveAway != null ? String(dto.oddsLiveAway) : null;
    }
    if (dto.drawConfidence !== undefined) patch.drawConfidence = dto.drawConfidence;
    if (dto.drawFactors !== undefined) patch.drawFactors = dto.drawFactors;
    if (dto.handicapWinProb !== undefined) patch.handicapWinProb = String(dto.handicapWinProb);
    if (dto.handicapDrawProb !== undefined) patch.handicapDrawProb = String(dto.handicapDrawProb);
    if (dto.handicapLoseProb !== undefined) patch.handicapLoseProb = String(dto.handicapLoseProb);
    if (dto.kellyH !== undefined) patch.kellyH = String(dto.kellyH);
    if (dto.kellyD !== undefined) patch.kellyD = String(dto.kellyD);
    if (dto.kellyA !== undefined) patch.kellyA = String(dto.kellyA);
    if (dto.handicapSecondChoice !== undefined) patch.handicapSecondChoice = dto.handicapSecondChoice;
    if (dto.handicapValueRating !== undefined) patch.handicapValueRating = dto.handicapValueRating;
    if (dto.rulesTriggered !== undefined) patch.rulesTriggered = JSON.stringify(dto.rulesTriggered);
    if (dto.hitWdw !== undefined) patch.hitWdw = dto.hitWdw;
    if (dto.hitHandicap !== undefined) patch.hitHandicap = dto.hitHandicap;
    if (dto.hitOverunder !== undefined) patch.hitOverunder = dto.hitOverunder;
    if (dto.hitGoals !== undefined) patch.hitGoals = dto.hitGoals;
    if (dto.hitHalffull !== undefined) patch.hitHalffull = dto.hitHalffull;
    if (dto.errorReason !== undefined) patch.errorReason = dto.errorReason;
    if (dto.tacticsHome !== undefined) patch.tacticsHome = this.sanitizeTextPlaceholder(dto.tacticsHome);
    if (dto.tacticsAway !== undefined) patch.tacticsAway = this.sanitizeTextPlaceholder(dto.tacticsAway);
    if (dto.keyPlayersHome !== undefined) patch.keyPlayersHome = this.sanitizeTextPlaceholder(dto.keyPlayersHome);
    if (dto.keyPlayersAway !== undefined) patch.keyPlayersAway = this.sanitizeTextPlaceholder(dto.keyPlayersAway);
    if (dto.homeInjuries !== undefined) patch.homeInjuries = this.sanitizeTextPlaceholder(dto.homeInjuries);
    if (dto.awayInjuries !== undefined) patch.awayInjuries = this.sanitizeTextPlaceholder(dto.awayInjuries);
    if (dto.upsetWarning !== undefined) patch.upsetWarning = this.sanitizeTextPlaceholder(dto.upsetWarning);
    if (dto.teamNews !== undefined) patch.teamNews = this.sanitizeTextPlaceholder(dto.teamNews);
    if (dto.injuries !== undefined) patch.injuries = this.sanitizeTextPlaceholder(dto.injuries);
    if (dto.mediaConsensus !== undefined) patch.mediaConsensus = this.sanitizeTextPlaceholder(dto.mediaConsensus);
    if (dto.expertPicks !== undefined) patch.expertPicks = this.sanitizeTextPlaceholder(dto.expertPicks);
    if (dto.keyPlayers !== undefined) patch.keyPlayers = this.sanitizeTextPlaceholder(dto.keyPlayers);
    if (dto.teamNews !== undefined || dto.injuries !== undefined || dto.mediaConsensus !== undefined || dto.expertPicks !== undefined || dto.keyPlayers !== undefined) {
      patch.intelUpdatedAt = new Date();
    }

    const kickoffDate = patch.kickoffTime
      ? new Date(patch.kickoffTime)
      : dto.kickoffTime
        ? new Date(dto.kickoffTime)
        : new Date(0);
    const now = new Date();
    const notStarted = kickoffDate.getTime() > now.getTime();
    const scoreOrHitIncoming =
      dto.homeScore !== undefined ||
      dto.awayScore !== undefined ||
      dto.hitWdw !== undefined ||
      dto.hitHandicap !== undefined ||
      dto.hitOverunder !== undefined ||
      dto.hitGoals !== undefined ||
      dto.hitHalffull !== undefined ||
      dto.matchStatus === 'finished';

    if (notStarted && scoreOrHitIncoming && !dto.verifiedTwoSources) {
      this.logger.warn(
        `足球写入保护: 比赛 ${dto.matchNo || 'unknown'} 开赛时间 ${kickoffDate.toISOString()} 在当前时间之后，拒绝写入比分/命中/finished状态`,
      );
      delete patch.homeScore;
      delete patch.awayScore;
      delete patch.hitWdw;
      delete patch.hitHandicap;
      delete patch.hitOverunder;
      delete patch.hitGoals;
      delete patch.hitHalffull;
      if (patch.matchStatus === 'finished') {
        patch.matchStatus = 'upcoming';
      }
    }

    return patch;
  }

  async batchUpsert(
    items: CreateMatchRequest[],
    userId: string,
  ): Promise<BatchUpsertResponse> {
    if (!items || items.length === 0) {
      return { inserted: 0, updated: 0, total: 0 };
    }
    try {
      const result = await this.db.transaction(async (tx) => {
        let inserted = 0;
        let updated = 0;
        const now = new Date();

        // 批量预查询所有可能已存在的记录，避免 N+1 逐条 SELECT
        const matchDateItems: { matchNo: string; matchDate: string }[] = items
          .filter((it: CreateMatchRequest) => it.matchNo && it.matchDate)
          .map((it: CreateMatchRequest) => ({
            matchNo: it.matchNo,
            matchDate: it.matchDate,
          }));

        let existingMap = new Map<string, typeof matches.$inferSelect>();
        if (matchDateItems.length > 0) {
          const noDatePairs = matchDateItems.map(
            (it: { matchNo: string; matchDate: string }) => `${it.matchNo}||${it.matchDate}`,
          );
          const existingRows = await tx
            .select()
            .from(matches)
            .where(
              sql`${matches.matchNo} || '||' || ${matches.matchDate}::text = ANY(ARRAY[${sql.join(noDatePairs.map((p) => sql`${p}`), sql`, `)}]::text[])`,
            );
          for (const row of existingRows) {
            const key = `${row.matchNo}||${String(row.matchDate)}`;
            existingMap.set(key, row);
          }
        }

        for (const item of items) {
          const key = `${item.matchNo}||${item.matchDate}`;
          const existingRow = existingMap.get(key);

          if (!existingRow) {
            const values = this.buildMatchInsertValues(item, userId);
            await tx.insert(matches).values(values);
            inserted += 1;
          } else {
            const existingRules = existingRow.modelRules ?? [];
            const patch = this.buildIncrementalPatch(item, existingRules);
            if (Object.keys(patch).length > 0) {
              patch.updatedAt = now;
              patch.updatedBy = userId;
              await tx
                .update(matches)
                .set(patch)
                .where(eq(matches.id, existingRow.id));
              updated += 1;
            }
          }
        }

        return { inserted, updated, total: inserted + updated };
      });

      this.logger.log(`批量upsert完成: inserted=${result.inserted}, updated=${result.updated}, total=${result.total}`);
      return result;
    } catch (error) {
      this.logger.error('批量upsert失败', JSON.stringify(error));
      throw error;
    }
  }

  async batchUpsertWithValidation(
    items: CreateMatchRequest[],
    userId: string,
  ): Promise<BatchUpsertResponse> {
    if (!items || items.length === 0) {
      return { inserted: 0, updated: 0, total: 0 };
    }
    const tableName = 'matches';
    try {
      const result = await this.db.transaction(async (tx) => {
        const preStats = await this.computeDataCheckInTx(tx);

        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const snapshotName = `${y}${m}${d}_${h}${min}${s}`;

        await tx.insert(dataSnapshots).values({
          tableName,
          snapshotName,
          recordCount: preStats.total,
          predictedCount: preStats.predictedCount,
          intelCount: preStats.intelCount,
          emptyFieldsCount: preStats.emptyFieldsCount,
          snapshotData: JSON.parse(JSON.stringify(preStats)),
        });

        let inserted = 0;
        let updated = 0;

        // 批量预查询所有可能已存在的记录，避免 N+1 逐条 SELECT
        const matchDateItems: { matchNo: string; matchDate: string }[] = items
          .filter((it: CreateMatchRequest) => it.matchNo && it.matchDate)
          .map((it: CreateMatchRequest) => ({
            matchNo: it.matchNo,
            matchDate: it.matchDate,
          }));

        let existingMap = new Map<string, typeof matches.$inferSelect>();
        if (matchDateItems.length > 0) {
          const noDatePairs = matchDateItems.map(
            (it: { matchNo: string; matchDate: string }) => `${it.matchNo}||${it.matchDate}`,
          );
          const existingRows = await tx
            .select()
            .from(matches)
            .where(
              sql`${matches.matchNo} || '||' || ${matches.matchDate}::text = ANY(ARRAY[${sql.join(noDatePairs.map((p) => sql`${p}`), sql`, `)}]::text[])`,
            );
          for (const row of existingRows) {
            const key = `${row.matchNo}||${String(row.matchDate)}`;
            existingMap.set(key, row);
          }
        }

        for (const item of items) {
          const key = `${item.matchNo}||${item.matchDate}`;
          const existingRow = existingMap.get(key);

          if (!existingRow) {
            const values = this.buildMatchInsertValues(item, userId);
            await tx.insert(matches).values(values);
            inserted += 1;
          } else {
            const existingRules = existingRow.modelRules ?? [];
            const patch = this.buildIncrementalPatch(item, existingRules);
            if (Object.keys(patch).length > 0) {
              patch.updatedAt = now;
              patch.updatedBy = userId;
              await tx
                .update(matches)
                .set(patch)
                .where(eq(matches.id, existingRow.id));
              updated += 1;
            }
          }
        }

        const postStats = await this.computeDataCheckInTx(tx);

        const issues: string[] = [];
        if (postStats.total < preStats.total) {
          issues.push(`总比赛数减少: ${preStats.total} -> ${postStats.total}`);
        }
        if (postStats.predictedCount < preStats.predictedCount) {
          issues.push(`有预测比赛数减少: ${preStats.predictedCount} -> ${postStats.predictedCount}`);
        }
        if (preStats.emptyFieldsCount > 0) {
          const increaseRatio = (postStats.emptyFieldsCount - preStats.emptyFieldsCount) / preStats.emptyFieldsCount;
          if (increaseRatio > 0.2) {
            issues.push(`空字段数增幅超过20%: ${preStats.emptyFieldsCount} -> ${postStats.emptyFieldsCount}`);
          }
        }

        if (issues.length > 0) {
          throw new BadRequestException(`数据校验失败: ${issues.join('; ')}`);
        }

        return { inserted, updated, total: inserted + updated };
      });

      this.logger.log(`批量upsert+校验完成: inserted=${result.inserted}, updated=${result.updated}, total=${result.total}`);

      void this.cleanupOldSnapshots(tableName).catch((err) => {
        this.logger.warn(`清理旧快照失败: ${JSON.stringify(err)}`);
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('批量upsert+校验失败', JSON.stringify(error));
      throw error;
    }
  }

  private async computeDataCheckInTx(
    tx: PostgresJsDatabase,
  ): Promise<{ total: number; predictedCount: number; intelCount: number; emptyFieldsCount: number }> {
    const table = matches;
    const summary = await tx
      .select({
        total: sql<number>`count(*)`,
        predictedCount: sql<number>`count(*) filter (where ${table.predictionDirection} is not null and ${table.predictionDirection} != '' and ${table.predictionDirection} != '观望')`,
        intelCount: sql<number>`count(*) filter (where ${table.intel} is not null and ${table.intel} != '')`,
        emptyFieldsCount: sql<number>`count(*) filter (where (
          ${table.predictionDirection} is null or ${table.predictionDirection} = '' or ${table.predictionDirection} = '观望'
          or ${table.handicap} is null or ${table.handicap} = ''
          or ${table.confidence} is null or ${table.confidence} = 0
        ))`,
      })
      .from(table);
    const row = summary[0];
    return {
      total: Number(row.total),
      predictedCount: Number(row.predictedCount),
      intelCount: Number(row.intelCount),
      emptyFieldsCount: Number(row.emptyFieldsCount),
    };
  }

  private async cleanupOldSnapshots(tableName: string): Promise<void> {
    const allSnapshots = await this.db
      .select({ id: dataSnapshots.id, createdAt: dataSnapshots.createdAt })
      .from(dataSnapshots)
      .where(eq(dataSnapshots.tableName, tableName))
      .orderBy(desc(dataSnapshots.createdAt));

    if (allSnapshots.length > 30) {
      const toDelete = allSnapshots.slice(30);
      const idsToDelete = toDelete.map((s) => s.id);
      await this.db.delete(dataSnapshots).where(sql`${dataSnapshots.id} = ANY(ARRAY[${sql.join(idsToDelete.map((id) => sql`${id}`), sql`, `)}]::uuid[])`);
    }
  }

  async createSnapshot(tableName: string): Promise<DataCheckResponse> {
    try {
      const stats = await this.runDataCheck(tableName);
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const h = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const snapshotName = `${y}${m}${d}_${h}${min}${s}`;

      await this.db.insert(dataSnapshots).values({
        tableName,
        snapshotName,
        recordCount: stats.total,
        predictedCount: stats.predictedCount,
        intelCount: stats.intelCount,
        emptyFieldsCount: stats.emptyFieldsCount,
        snapshotData: JSON.parse(JSON.stringify(stats)),
      });

      const allSnapshots = await this.db
        .select({ id: dataSnapshots.id, createdAt: dataSnapshots.createdAt })
        .from(dataSnapshots)
        .where(eq(dataSnapshots.tableName, tableName))
        .orderBy(desc(dataSnapshots.createdAt));

      if (allSnapshots.length > 30) {
        const toDelete = allSnapshots.slice(30);
        const idsToDelete = toDelete.map((s) => s.id);
        await this.db.delete(dataSnapshots).where(sql`${dataSnapshots.id} = ANY(ARRAY[${sql.join(idsToDelete.map((id) => sql`${id}`), sql`, `)}]::uuid[])`);
      }

      this.logger.log(`创建快照 table=${tableName} snapshot=${snapshotName} total=${stats.total}`);
      return stats;
    } catch (error) {
      this.logger.error(`创建快照失败 table=${tableName}`, JSON.stringify(error));
      throw error;
    }
  }

  async runDataCheck(tableName: string): Promise<DataCheckResponse> {
    try {
      const table = matches;

      const summary = await this.db
        .select({
          total: sql<number>`count(*)`,
          predictedCount: sql<number>`count(*) filter (where ${table.predictionDirection} is not null and ${table.predictionDirection} != '' and ${table.predictionDirection} != '观望')`,
          intelCount: sql<number>`count(*) filter (where ${table.intel} is not null and ${table.intel} != '')`,
          emptyFieldsCount: sql<number>`count(*) filter (where (
            ${table.predictionDirection} is null or ${table.predictionDirection} = '' or ${table.predictionDirection} = '观望'
            or ${table.handicap} is null or ${table.handicap} = ''
            or ${table.confidence} is null or ${table.confidence} = 0
          ))`,
        })
        .from(table);

      const byDateRows = await this.db
        .select({
          businessDate: table.businessDate,
          total: sql<number>`count(*)`,
          predictedCount: sql<number>`count(*) filter (where ${table.predictionDirection} is not null and ${table.predictionDirection} != '' and ${table.predictionDirection} != '观望')`,
          intelCount: sql<number>`count(*) filter (where ${table.intel} is not null and ${table.intel} != '')`,
          emptyFieldsCount: sql<number>`count(*) filter (where (
            ${table.predictionDirection} is null or ${table.predictionDirection} = '' or ${table.predictionDirection} = '观望'
            or ${table.handicap} is null or ${table.handicap} = ''
            or ${table.confidence} is null or ${table.confidence} = 0
          ))`,
        })
        .from(table)
        .groupBy(table.businessDate)
        .orderBy(desc(table.businessDate));

      const byDate: DataCheckByDateItem[] = byDateRows.map((row) => ({
        date: String(row.businessDate),
        total: Number(row.total),
        predictedCount: Number(row.predictedCount),
        intelCount: Number(row.intelCount),
        emptyFieldsCount: Number(row.emptyFieldsCount),
      }));

      const statusCounts = await this.db
        .select({
          matchStatus: table.matchStatus,
          count: sql<number>`count(*)`,
        })
        .from(table)
        .groupBy(table.matchStatus);

      const finishedCount = Number(
        statusCounts.find((r: { matchStatus: string; count: number }) => r.matchStatus === 'finished')?.count ?? 0,
      );
      const upcomingCount = Number(
        statusCounts.find((r: { matchStatus: string; count: number }) => r.matchStatus === 'upcoming')?.count ?? 0,
      );
      const canceledCount = Number(
        statusCounts.find((r: { matchStatus: string; count: number }) => r.matchStatus === 'canceled')?.count ?? 0,
      );

      const integrity = await this.buildIntegrityReport(table, canceledCount);

      const row = summary[0];
      return {
        total: Number(row.total),
        predictedCount: Number(row.predictedCount),
        intelCount: Number(row.intelCount),
        emptyFieldsCount: Number(row.emptyFieldsCount),
        byDate,
        finishedCount,
        upcomingCount,
        canceledCount,
        integrity,
      };
    } catch (error) {
      this.logger.error(`数据自检失败 table=${tableName}`, JSON.stringify(error));
      throw error;
    }
  }

  async remove(id: string): Promise<{ success: boolean }> {
    try {
      const rows: { id: string }[] = await this.db
        .delete(matches)
        .where(eq(matches.id, id))
        .returning({ id: matches.id });

      if (rows.length === 0) {
        throw new NotFoundException('比赛不存在');
      }

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`删除比赛失败 id=${id}`, JSON.stringify(error));
      throw error;
    }
  }

  private async buildIntegrityReport(
    table: typeof matches,
    canceledCount: number,
  ): Promise<DataIntegrityIssue[]> {
    const issues: DataIntegrityIssue[] = [];

    const dupSourceIdResult = await this.db.execute(sql<{ source_match_id: string; cnt: string }>`SELECT source_match_id, count(*) AS cnt
       FROM matches
       WHERE source_match_id IS NOT NULL
       GROUP BY source_match_id
       HAVING count(*) > 1
       ORDER BY cnt DESC
       LIMIT 10`);
    const dupSourceIdRows = dupSourceIdResult as unknown as Array<{ source_match_id: string; cnt: string }>;
    if (dupSourceIdRows.length > 0) {
      issues.push({
        type: 'duplicate_source_match_id',
        count: dupSourceIdRows.length,
        samples: dupSourceIdRows.map((r) => `${r.source_match_id} (x${r.cnt})`),
      });
    }

    const dupHakResult = await this.db.execute(sql<{ home_team: string; away_team: string; cnt: string }>`SELECT home_team, away_team, count(*) AS cnt
       FROM matches
       GROUP BY home_team, away_team, kickoff_time
       HAVING count(*) > 1
       ORDER BY cnt DESC
       LIMIT 10`);
    const dupHakRows = dupHakResult as unknown as Array<{ home_team: string; away_team: string; cnt: string }>;
    if (dupHakRows.length > 0) {
      issues.push({
        type: 'duplicate_home_away_kickoff',
        count: dupHakRows.length,
        samples: dupHakRows.map((r) => `${r.home_team} vs ${r.away_team} (x${r.cnt})`),
      });
    }

    const crossDateResult = await this.db.execute(sql<{ match_no: string; date_cnt: string }>`SELECT match_no, count(DISTINCT business_date) AS date_cnt
       FROM matches
       WHERE business_date IS NOT NULL
         AND match_status != 'finished'
       GROUP BY match_no
       HAVING count(DISTINCT business_date) > 1
       ORDER BY date_cnt DESC
       LIMIT 20`);
    const crossDateRows = crossDateResult as unknown as Array<{ match_no: string; date_cnt: string }>;
    if (crossDateRows.length > 0) {
      issues.push({
        type: 'cross_date_match_no',
        count: crossDateRows.length,
        samples: crossDateRows.map((r) => `${r.match_no} (${r.date_cnt} days)`),
      });
    }

    const missingSourceIdResult = await this.db.select({ count: sql<number>`count(*)` })
      .from(table)
      .where(sql`${table.sourceMatchId} IS NULL AND (
        ${table.matchStatus} != 'finished'
        OR ${table.businessDate} >= CURRENT_DATE - INTERVAL '3 days'
      )`);
    const missingCount = Number(missingSourceIdResult[0]?.count ?? 0);
    if (missingCount > 0) {
      issues.push({
        type: 'missing_source_match_id',
        count: missingCount,
        samples: [],
      });
    }

    if (canceledCount > 0) {
      const canceledSamplesResult = await this.db.select({
        matchNo: table.matchNo,
        businessDate: table.businessDate,
      }).from(table).where(eq(table.matchStatus, 'canceled')).limit(10);
      issues.push({
        type: 'canceled_matches',
        count: canceledCount,
        samples: canceledSamplesResult.map((r: { matchNo: string; businessDate: string | null }) =>
          `${r.matchNo} (${String(r.businessDate ?? 'N/A')})`),
      });
    }

    const pendingVerifyResult = await this.db.select({ count: sql<number>`count(*)` })
      .from(table)
      .where(eq(table.errorReason, '数据待核'));
    const pendingCount = Number(pendingVerifyResult[0]?.count ?? 0);
    if (pendingCount > 0) {
      const pendingSamples = await this.db.select({
        matchNo: table.matchNo,
        businessDate: table.businessDate,
      }).from(table).where(eq(table.errorReason, '数据待核')).limit(10);
      issues.push({
        type: 'pending_verify',
        count: pendingCount,
        samples: pendingSamples.map((r: { matchNo: string; businessDate: string | null }) =>
          `${r.matchNo} (${String(r.businessDate ?? 'N/A')})`),
      });
    }

    return issues;
  }

  async backfillFootballInjuryReports(): Promise<{ processed: number; inserted: number; skipped: number }> {
    const rows = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        league: matches.league,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        injuriesJson: matches.injuriesJson,
        source: matches.source,
        kickoffTime: matches.kickoffTime,
      })
      .from(matches)
      .where(
        and(
          isNotNull(matches.injuriesJson),
          ne(matches.matchStatus, 'finished'),
          ne(matches.matchStatus, 'cancelled'),
        ),
      );

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    interface ParsedInjury {
      matchId: string;
      teamSide: 'home' | 'away';
      teamName: string;
      playerName: string;
      status: string;
      shortComment: string | null;
      longComment: string | null;
      impactRating: 'high' | 'medium' | 'low' | 'unknown';
      position: string | null;
      injuryType: string | null;
      injuryDate: Date | null;
      dataSource: string;
    }

    const parseImpact = (status: string, rawImpact: string): 'high' | 'medium' | 'low' | 'unknown' => {
      const statusLower = status.toLowerCase();
      const rawImpactLower = rawImpact.toLowerCase();
      if (
        rawImpactLower.includes('high') ||
        statusLower.includes('out') ||
        statusLower.includes('赛季报销') ||
        statusLower.includes('报销') ||
        statusLower.includes('indefinitely') ||
        statusLower.includes('无限期') ||
        statusLower.includes('doubtful')
      ) {
        return 'high';
      }
      if (
        rawImpactLower.includes('medium') ||
        statusLower.includes('day-to-day') ||
        statusLower.includes('每日观察') ||
        statusLower.includes('questionable') ||
        statusLower.includes('出战成疑') ||
        statusLower.includes('缺阵') ||
        statusLower.includes('缺席')
      ) {
        return 'medium';
      }
      if (
        rawImpactLower.includes('low') ||
        statusLower.includes('probable') ||
        statusLower.includes('available') ||
        statusLower.includes('可以出战')
      ) {
        return 'low';
      }
      return 'unknown';
    };

    // 第一遍：解析所有比赛的所有伤停球员，收集到一个数组
    const allInjuries: ParsedInjury[] = [];
    for (const row of rows) {
      const obj = row.injuriesJson as unknown as Record<string, unknown> | null;
      if (!obj || typeof obj !== 'object') {
        skipped += 1;
        continue;
      }
      const dataSource = (typeof obj.source === 'string' && obj.source) || 'espn';

      const parseSide = (side: 'home' | 'away', arr: unknown): void => {
        if (!Array.isArray(arr)) return;
        const teamName = side === 'home' ? row.homeTeam : row.awayTeam;
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          const p = item as Record<string, unknown>;
          const name = typeof p.athleteName === 'string' ? p.athleteName : '';
          if (!name) continue;
          const shortComment = typeof p.shortComment === 'string' ? p.shortComment : '';
          const longComment = typeof p.longComment === 'string' ? p.longComment : null;
          const status = typeof p.status === 'string' ? p.status : 'out';
          const position = typeof p.position === 'string' ? p.position : null;
          const injuryType = typeof p.type === 'string' ? p.type : null;
          const injuryDate = typeof p.date === 'string' && p.date ? new Date(p.date) : null;
          const rawImpact = typeof p.impact === 'string' ? p.impact : '';
          const impactRating = parseImpact(status, rawImpact);

          allInjuries.push({
            matchId: row.id,
            teamSide: side,
            teamName: teamName || '',
            playerName: name,
            status,
            shortComment: shortComment || null,
            longComment,
            impactRating,
            position,
            injuryType,
            injuryDate,
            dataSource,
          });
        }
      };

      parseSide('home', obj.home);
      parseSide('away', obj.away);
    }

    if (allInjuries.length === 0) {
      return { processed, inserted, skipped };
    }

    // 批量查询已存在的伤停记录（一次查询替代 N 次）
    const matchIds = [...new Set(allInjuries.map((inj: ParsedInjury) => inj.matchId))];
    const existingRows = await this.db
      .select({
        id: injuryReports.id,
        matchId: injuryReports.matchId,
        teamSide: injuryReports.teamSide,
        playerName: injuryReports.playerName,
      })
      .from(injuryReports)
      .where(
        and(
          eq(injuryReports.sport, 'football'),
          sql`${injuryReports.matchId} = ANY(ARRAY[${sql.join(matchIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])`,
        ),
      );

    const existingMap = new Map<string, string>(); // key -> id
    for (const r of existingRows) {
      const key = `${r.matchId}_${r.teamSide}_${r.playerName}`;
      existingMap.set(key, r.id);
    }

    // 分类：需要 insert 的 vs 需要 update 的
    const toInsert: (typeof injuryReports.$inferInsert)[] = [];
    const toUpdate: { id: string; data: ParsedInjury }[] = [];

    for (const inj of allInjuries) {
      const key = `${inj.matchId}_${inj.teamSide}_${inj.playerName}`;
      const existingId = existingMap.get(key);
      if (existingId) {
        toUpdate.push({ id: existingId, data: inj });
      } else {
        toInsert.push({
          matchId: inj.matchId,
          sport: 'football',
          teamSide: inj.teamSide,
          teamName: inj.teamName,
          playerName: inj.playerName,
          status: inj.status,
          shortComment: inj.shortComment,
          longComment: inj.longComment,
          impactRating: inj.impactRating,
          position: inj.position,
          injuryType: inj.injuryType,
          injuryDate: inj.injuryDate ?? null,
          dataSource: inj.dataSource,
          source: 'espn_summary',
        });
      }
    }

    // 批量插入（一次搞定）
    if (toInsert.length > 0) {
      await this.db.insert(injuryReports).values(toInsert);
      inserted = toInsert.length;
      processed += toInsert.length;
    }

    // 批量更新：逐条执行但不再需要先 SELECT 查询（已在 existingMap 中）
    // 每条更新字段不同，无法简单合并为单条 SQL；但已省去 N 次 SELECT 查询
    const now = new Date();
    for (const { id, data } of toUpdate) {
      await this.db
        .update(injuryReports)
        .set({
          status: data.status,
          shortComment: data.shortComment,
          longComment: data.longComment,
          impactRating: data.impactRating,
          position: data.position,
          injuryType: data.injuryType,
          injuryDate: data.injuryDate ?? null,
          updatedAt: now,
        })
        .where(eq(injuryReports.id, id));
      processed += 1;
    }

    return { processed, inserted, skipped };
  }
}
