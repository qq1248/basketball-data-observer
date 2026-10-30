import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, basketballMatches } from '@server/database/schema';
import { eq, and, gte, lt, desc, isNotNull, ne, sql } from 'drizzle-orm';
import type {
  ParlayItem,
  ParlayListResponse,
  ParlayMatchItem,
} from '@shared/api.interface';

interface CandidateMatch {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  playType: string;
  betOption: string;
  probability: number;
  odds: number;
  oddsEstimated: boolean;
  line?: string | number | null;
}

type PlayCategory = 'straight' | 'handicap' | 'total';

interface PlayGroup {
  category: PlayCategory;
  label: string;
  candidates: CandidateMatch[];
}

interface TierDef {
  idSuffix: string;
  nameLabel: string;
  legs: number;
  comboType: string;
  riskLevel: 'steady' | 'balanced' | 'aggressive' | 'longshot';
  tolerance?: boolean;
}

const BASKETBALL_TIERS: TierDef[] = [
  { idSuffix: '2x1', nameLabel: '稳健精选2场', legs: 2, comboType: '2场精选', riskLevel: 'steady' },
  { idSuffix: '3x1', nameLabel: '均衡精选3场', legs: 3, comboType: '3场精选', riskLevel: 'balanced' },
  { idSuffix: '3x4', nameLabel: '激进精选3场容错', legs: 3, comboType: '3场容错', riskLevel: 'aggressive', tolerance: true },
  { idSuffix: '4x1', nameLabel: '激进精选4场', legs: 4, comboType: '4场精选', riskLevel: 'longshot' },
];

const FOOTBALL_TIERS: TierDef[] = [
  { idSuffix: '2x1', nameLabel: '稳健精选2场', legs: 2, comboType: '2场精选', riskLevel: 'steady' },
  { idSuffix: '3x1', nameLabel: '均衡精选3场', legs: 3, comboType: '3场精选', riskLevel: 'balanced' },
  { idSuffix: '3x4', nameLabel: '激进精选3场容错', legs: 3, comboType: '3场容错', riskLevel: 'aggressive', tolerance: true },
  { idSuffix: '4x1', nameLabel: '激进精选4场', legs: 4, comboType: '4场精选', riskLevel: 'longshot' },
];

const TOTAL_TIERS: TierDef[] = [
  { idSuffix: '2x1', nameLabel: '稳健精选2场', legs: 2, comboType: '2场精选', riskLevel: 'balanced' },
  { idSuffix: '3x1', nameLabel: '激进精选3场', legs: 3, comboType: '3场精选', riskLevel: 'aggressive' },
];

const FOOTBALL_STRAIGHT_TIERS: TierDef[] = [
  { idSuffix: '2x1', nameLabel: '稳健精选2场', legs: 2, comboType: '2场精选', riskLevel: 'steady' },
  { idSuffix: '3x1', nameLabel: '均衡精选3场', legs: 3, comboType: '3场精选', riskLevel: 'balanced' },
  { idSuffix: '3x4', nameLabel: '激进精选3场容错', legs: 3, comboType: '3场容错', riskLevel: 'aggressive', tolerance: true },
  { idSuffix: '4x1', nameLabel: '激进精选4场', legs: 4, comboType: '4场精选', riskLevel: 'longshot' },
];

@Injectable()
export class ParlaysService {
  private readonly logger = new Logger(ParlaysService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private getNextDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + 1);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  private parseHandicapAbs(handicap: string): number {
    const cleaned = handicap.replace(/[^0-9.-]/g, '');
    const num = Number(cleaned);
    if (Number.isNaN(num)) return 0;
    return Math.abs(num);
  }

  private async filterFootballStraight(date: string): Promise<CandidateMatch[]> {
    const nextDate = this.getNextDate(date);
    const rows = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        league: matches.league,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        predictionDirection: matches.predictionDirection,
        confidence: matches.confidence,
        lowConfidence: matches.lowConfidence,
        oddsOpenHome: matches.oddsOpenHome,
        oddsOpenDraw: matches.oddsOpenDraw,
        oddsOpenAway: matches.oddsOpenAway,
      })
      .from(matches)
       .where(and(
        gte(matches.businessDate, date),
        lt(matches.businessDate, nextDate),
        isNotNull(matches.predictionDirection),
        ne(matches.predictionDirection, '观望'),
      ))
      .orderBy(desc(matches.confidence));

    const candidates: CandidateMatch[] = [];
    for (const row of rows) {
      const betOption = row.predictionDirection;
      if (!betOption || betOption === '观望') continue;

      let rawOdds: number | null = null;
      if (betOption === '主胜' && row.oddsOpenHome !== null) {
        rawOdds = Number(row.oddsOpenHome);
      } else if (betOption === '平' && row.oddsOpenDraw !== null) {
        rawOdds = Number(row.oddsOpenDraw);
      } else if (betOption === '客胜' && row.oddsOpenAway !== null) {
        rawOdds = Number(row.oddsOpenAway);
      }

      const probability = Number(row.confidence) || 50;
      if (probability < 55) continue;

      const oddsEstimated = rawOdds === null || rawOdds <= 0;
      // 有真实指数用真实指数；估算时用 1 / (prob * 0.95)，约 95% 返还率
      const probDecimal = probability / 100;
      const odds = !oddsEstimated ? (rawOdds as number) : (probDecimal > 0 ? 1 / (probDecimal * 0.95) : 1);

      candidates.push({
        id: row.id,
        matchNo: row.matchNo,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playType: '胜平负',
        betOption,
        probability,
        odds,
        oddsEstimated,
        line: null,
      });
    }

    return candidates;
  }

  private async filterFootballHandicap(date: string): Promise<CandidateMatch[]> {
    const nextDate = this.getNextDate(date);
    const rows = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        league: matches.league,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        handicap: matches.handicap,
        handicapRecommendation: matches.handicapRecommendation,
        handicapWinProb: matches.handicapWinProb,
        handicapDrawProb: matches.handicapDrawProb,
        handicapLoseProb: matches.handicapLoseProb,
        predictionDirection: matches.predictionDirection,
        confidence: matches.confidence,
        lowConfidence: matches.lowConfidence,
      })
      .from(matches)
      .where(and(
        gte(matches.businessDate, date),
        lt(matches.businessDate, nextDate),
        isNotNull(matches.handicapRecommendation),
        ne(matches.handicapRecommendation, '观望'),
        isNotNull(matches.predictionDirection),
        ne(matches.predictionDirection, '观望'),
      ))
      .orderBy(desc(matches.confidence));

    const candidates: CandidateMatch[] = [];
    for (const row of rows) {
      const betOption = row.handicapRecommendation;
      if (!betOption || betOption === '观望') continue;
      // B4 质量闸门：胜平负方向也必须不是观望/空
      if (!row.predictionDirection || row.predictionDirection === '观望') continue;

      const handicapStr = row.handicap ?? '';
      // 无让球指数线或空指数线 → 跳过
      if (!handicapStr || handicapStr === '0' || handicapStr === '') continue;

      const handicapAbs = this.parseHandicapAbs(handicapStr);
      if (handicapAbs > 3) continue;

      // 让球三项概率为基线默认值（35/30/35）→ 视为无真实让球数据，跳过
      const hwp = Number(row.handicapWinProb ?? 0);
      const hdp = Number(row.handicapDrawProb ?? 0);
      const hlP = Number(row.handicapLoseProb ?? 0);
      if (hwp === 35 && hdp === 30 && hlP === 35) continue;

      const probability = Number(row.confidence) || 50;
      if (probability < 55) continue;

      // 让球指数线无独立指数字段，1x2 指数不能直接用作让球指数，统一按概率估算
      // 估算公式：odds = 1 / (prob * 0.95)，约 95% 返还率
      const oddsEstimated = true;
      const probDecimal = probability / 100;
      const odds = probDecimal > 0 ? 1 / (probDecimal * 0.95) : 1;

      candidates.push({
        id: row.id,
        matchNo: row.matchNo,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playType: '让球胜平负',
        betOption,
        probability,
        odds,
        oddsEstimated,
        line: row.handicap,
      });
    }

    return candidates;
  }

  private async filterFootballTotal(date: string): Promise<CandidateMatch[]> {
    const nextDate = this.getNextDate(date);
    const rows = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        league: matches.league,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        totalPick: matches.totalPick,
        totalPickProb: matches.totalPickProb,
        overUnder: matches.overUnder,
        predictionDirection: matches.predictionDirection,
      })
      .from(matches)
      .where(and(
        gte(matches.businessDate, date),
        lt(matches.businessDate, nextDate),
        isNotNull(matches.totalPick),
        ne(matches.totalPick, '观望'),
        isNotNull(matches.predictionDirection),
        ne(matches.predictionDirection, '观望'),
      ))
      .orderBy(desc(matches.totalPickProb));

    const candidates: CandidateMatch[] = [];
    for (const row of rows) {
      const betOption = row.totalPick;
      if (!betOption || betOption === '观望') continue;
      // B4 质量闸门：胜平负方向也必须不是观望/空
      if (!row.predictionDirection || row.predictionDirection === '观望') continue;

      const probability = Number(row.totalPickProb) || 50;
      if (probability < 55) continue;

      // 总进球无独立指数字段，按概率估算，约 95% 返还率
      const probDecimal = probability / 100;
      const odds = probDecimal > 0 ? 1 / (probDecimal * 0.95) : 1;

      candidates.push({
        id: row.id,
        matchNo: row.matchNo,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playType: '总进球',
        betOption,
        probability,
        odds,
        oddsEstimated: true,
        line: row.overUnder,
      });
    }

    return candidates;
  }

  private async filterBasketballStraight(date: string): Promise<CandidateMatch[]> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        predictionDirection: basketballMatches.predictionDirection,
        homeWinProb: basketballMatches.homeWinProb,
        awayWinProb: basketballMatches.awayWinProb,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
      })
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.matchDate, date),
        isNotNull(basketballMatches.predictionDirection),
        ne(basketballMatches.predictionDirection, '观望'),
      ))
      .orderBy(desc(basketballMatches.homeWinProb));

    const candidates: CandidateMatch[] = [];
    for (const row of rows) {
      const betOption = row.predictionDirection;
      if (!betOption || betOption === '观望') continue;

      let probability = 50;
      if (betOption === '主胜') {
        probability = Number(row.homeWinProb) || 50;
      } else if (betOption === '客胜') {
        probability = Number(row.awayWinProb) || 50;
      }

      if (probability < 55) continue;

      let rawOdds: number | null = null;
      if (betOption === '主胜' && row.homeWinOdds !== null) {
        rawOdds = Number(row.homeWinOdds);
      } else if (betOption === '客胜' && row.awayWinOdds !== null) {
        rawOdds = Number(row.awayWinOdds);
      }

      const oddsEstimated = rawOdds === null || rawOdds <= 0;
      const probDecimal = probability / 100;
      const odds = !oddsEstimated ? (rawOdds as number) : (probDecimal > 0 ? 1 / (probDecimal * 0.95) : 1);

      candidates.push({
        id: row.id,
        matchNo: row.matchNo,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playType: '胜负',
        betOption,
        probability,
        odds,
        oddsEstimated,
        line: null,
      });
    }

    candidates.sort((a, b) => b.probability - a.probability);
    return candidates;
  }

  private async filterBasketballHandicap(date: string): Promise<CandidateMatch[]> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        handicapPick: basketballMatches.handicapPick,
        handicapPickProb: basketballMatches.handicapPickProb,
        handicapConfidence: basketballMatches.handicapConfidence,
        handicapLineNum: basketballMatches.handicapLineNum,
        handicapOddsHome: basketballMatches.handicapOddsHome,
        handicapOddsAway: basketballMatches.handicapOddsAway,
      })
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.matchDate, date),
        isNotNull(basketballMatches.handicapPick),
        ne(basketballMatches.handicapPick, '观望'),
      ))
      .orderBy(desc(basketballMatches.handicapPickProb));

    const candidates: CandidateMatch[] = [];
    for (const row of rows) {
      const betOption = row.handicapPick;
      if (!betOption || betOption === '观望') continue;

      const confidence = row.handicapConfidence ?? '';
      if (confidence !== '中' && confidence !== '高' && confidence !== '低') continue;

      const lineNum = row.handicapLineNum !== null ? Number(row.handicapLineNum) : 0;
      if (lineNum === 0) continue;
      if (Math.abs(lineNum) > 18) continue;

      let rawOdds: number | null = null;
      if (betOption === '让分主胜' && row.handicapOddsHome !== null) {
        rawOdds = Number(row.handicapOddsHome);
      } else if (betOption === '让分客胜' && row.handicapOddsAway !== null) {
        rawOdds = Number(row.handicapOddsAway);
      }

      const probability = Number(row.handicapPickProb) || 50;
      if (probability < 53) continue;

      const oddsEstimated = rawOdds === null || rawOdds <= 0;
      const probDecimal = probability / 100;
      const odds = !oddsEstimated ? (rawOdds as number) : (probDecimal > 0 ? 1 / (probDecimal * 0.95) : 1);

      candidates.push({
        id: row.id,
        matchNo: row.matchNo,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playType: '让分胜负',
        betOption,
        probability,
        odds,
        oddsEstimated,
        line: lineNum,
      });
    }

    return candidates;
  }

  private async filterBasketballTotal(date: string): Promise<CandidateMatch[]> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        totalPick: basketballMatches.totalPick,
        totalPickProb: basketballMatches.totalPickProb,
        totalLine: basketballMatches.totalLine,
        totalLineNum: basketballMatches.totalLineNum,
        totalOddsOver: basketballMatches.totalOddsOver,
        totalOddsUnder: basketballMatches.totalOddsUnder,
        ouConfidence: basketballMatches.ouConfidence,
      })
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.matchDate, date),
        isNotNull(basketballMatches.totalPick),
        ne(basketballMatches.totalPick, '观望'),
      ))
      .orderBy(desc(basketballMatches.totalPickProb));

    const candidates: CandidateMatch[] = [];
    for (const row of rows) {
      const betOption = row.totalPick;
      if (!betOption || betOption === '观望') continue;

      const confidence = row.ouConfidence ?? '';
      if (confidence !== '中' && confidence !== '高' && confidence !== '低') continue;

      const tLineNum = row.totalLineNum !== null ? Number(row.totalLineNum) : 0;
      if (tLineNum === 0) continue;

      let rawOdds: number | null = null;
      if (betOption.includes('大') && row.totalOddsOver !== null) {
        rawOdds = Number(row.totalOddsOver);
      } else if (betOption.includes('小') && row.totalOddsUnder !== null) {
        rawOdds = Number(row.totalOddsUnder);
      }

      const probability = Number(row.totalPickProb) || 50;
      if (probability < 52) continue;

      const oddsEstimated = rawOdds === null || rawOdds <= 0;
      const probDecimal = probability / 100;
      const odds = !oddsEstimated ? (rawOdds as number) : (probDecimal > 0 ? 1 / (probDecimal * 0.95) : 1);

      candidates.push({
        id: row.id,
        matchNo: row.matchNo,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        playType: '大小分',
        betOption,
        probability,
        odds,
        oddsEstimated,
        line: row.totalLineNum ?? row.totalLine,
      });
    }

    return candidates;
  }

  private applyLeagueDedup(sorted: CandidateMatch[], maxPerLeague = 2): CandidateMatch[] {
    const result: CandidateMatch[] = [];
    const leagueCount = new Map<string, number>();

    for (const match of sorted) {
      const current = leagueCount.get(match.league) ?? 0;
      if (current < maxPerLeague) {
        result.push(match);
        leagueCount.set(match.league, current + 1);
      }
    }

    return result;
  }

  private toParlayMatchItem(candidate: CandidateMatch): ParlayMatchItem {
    return {
      matchId: candidate.id,
      matchNo: candidate.matchNo,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      playType: candidate.playType,
      betOption: candidate.betOption,
      probability: candidate.probability,
      referenceIndex: Number(candidate.odds.toFixed(2)),
      handicapLine: candidate.line != null ? String(candidate.line) : undefined,
      hit: null,
    };
  }

  private calcHitRate(matches: CandidateMatch[]): number {
    if (matches.length === 0) return 0;
    const product = matches.reduce((acc, m) => acc * (m.probability / 100), 1);
    return Math.round(product * 100);
  }

  private calc3of4HitRate(matches: CandidateMatch[]): number {
    if (matches.length < 3) return 0;
    const [p1, p2, p3] = matches.map((m) => m.probability / 100);
    const p12 = p1 * p2;
    const p13 = p1 * p3;
    const p23 = p2 * p3;
    const p123 = p1 * p2 * p3;
    return Math.round((p12 + p13 + p23 - 2 * p123) * 100);
  }

  private calcToleranceIndexRange(matches: CandidateMatch[]): { minIndex: number; maxIndex: number; structure: string; totalBets: number; hitCondition: string } {
    const n = matches.length;
    const totalBets = this.binom(n, 2) + 1;
    const odds = matches.map((m) => m.odds).sort((a, b) => a - b);
    let minOdds = Infinity;
    let maxOdds = 0;
    for (let i = 0; i < odds.length; i += 1) {
      for (let j = i + 1; j < odds.length; j += 1) {
        const product = odds[i] * odds[j];
        if (product < minOdds) minOdds = product;
        if (product > maxOdds) maxOdds = product;
      }
    }
    const threeFold = odds.reduce((acc, o) => acc * o, 1);
    if (threeFold < minOdds) minOdds = threeFold;
    if (threeFold > maxOdds) maxOdds = threeFold;
    return {
      totalBets,
      structure: `${totalBets}注（${this.binom(n, 2)}×2串1+1×3串1）`,
      minIndex: Number(minOdds.toFixed(2)),
      maxIndex: Number(maxOdds.toFixed(2)),
      hitCondition: '至少中2场',
    };
  }

  private binom(n: number, k: number): number {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    const kk = Math.min(k, n - k);
    let result = 1;
    for (let i = 1; i <= kk; i += 1) {
      result = (result * (n - kk + i)) / i;
    }
    return Math.round(result);
  }

  private calcTotalOdds(matches: CandidateMatch[]): number {
    if (matches.length === 0) return 0;
    return Number(matches.reduce((acc, m) => acc * m.odds, 1).toFixed(2));
  }

  private classifyConfidence(probability: number): 'high' | 'mid' | 'low' {
    if (probability >= 65) return 'high';
    if (probability >= 58) return 'mid';
    return 'low';
  }

  private computeParlayExtraFields(
    picks: CandidateMatch[],
    hitRates: { high: { rate: number; samples: number }; mid: { rate: number; samples: number }; low: { rate: number; samples: number } },
  ): {
    confidenceBreakdown: { high: number; mid: number; low: number };
    similarHistoricalHitRate: number | null;
    riskNote: string;
  } {
    let high = 0;
    let mid = 0;
    let low = 0;
    for (const p of picks) {
      const tier = this.classifyConfidence(p.probability);
      if (tier === 'high') high += 1;
      else if (tier === 'mid') mid += 1;
      else low += 1;
    }
    const confidenceBreakdown = { high, mid, low };

    // similarHistoricalHitRate: product of hit rates by tier; insufficient sample → null
    const allSufficient = hitRates.high.samples >= 20 && hitRates.mid.samples >= 20 && hitRates.low.samples >= 20;
    let similarHistoricalHitRate: number | null = null;
    if (allSufficient && picks.length > 0) {
      let product = 1;
      for (const p of picks) {
        const tier = this.classifyConfidence(p.probability);
        product *= hitRates[tier].rate;
      }
      similarHistoricalHitRate = Number(product.toFixed(4));
    }

    // riskNote
    let riskNote = '';
    if (low >= 2) {
      riskNote = '含低信心场次，风险较高';
    } else if (high >= 3) {
      riskNote = '该组合涉及多场高信心比赛，建议分散风险';
    }

    return { confidenceBreakdown, similarHistoricalHitRate, riskNote };
  }

  private async getConfidenceHistoricalHitRates(
    sportType: 'football' | 'basketball',
  ): Promise<{ high: { rate: number; samples: number }; mid: { rate: number; samples: number }; low: { rate: number; samples: number } }> {
    const table = sportType === 'football' ? matches : basketballMatches;
    const rows = await this.db
      .select({
        level: sql<string>`case
          when ${table.confidence} >= 65 then 'high'
          when ${table.confidence} >= 58 then 'mid'
          else 'low'
        end`,
        total: sql<number>`count(*) filter (where ${table.hitWdw} is not null)`,
        hits: sql<number>`count(*) filter (where ${table.hitWdw} = true)`,
      })
      .from(table)
      .where(eq(table.matchStatus, 'finished'))
      .groupBy(sql`case
          when ${table.confidence} >= 65 then 'high'
          when ${table.confidence} >= 58 then 'mid'
          else 'low'
        end`);

    const result = {
      high: { rate: 0, samples: 0 },
      mid: { rate: 0, samples: 0 },
      low: { rate: 0, samples: 0 },
    };
    for (const r of rows) {
      const key = r.level as 'high' | 'mid' | 'low';
      const total = Number(r.total);
      const hits = Number(r.hits);
      if (result[key]) {
        result[key].samples = total;
        result[key].rate = total > 0 ? hits / total : 0;
      }
    }
    return result;
  }

  private buildTiers(
    candidates: CandidateMatch[],
    category: PlayCategory,
    playLabel: string,
    sportPrefix: 'football' | 'basketball',
    sportName: string,
    tierDefs: TierDef[],
    date: string,
    confidenceHitRates: { high: { rate: number; samples: number }; mid: { rate: number; samples: number }; low: { rate: number; samples: number } },
  ): ParlayItem[] {
    const items: ParlayItem[] = [];
    const sortedByProb = [...candidates].sort((a, b) => {
      if (b.probability !== a.probability) return b.probability - a.probability;
      return (a.oddsEstimated ? 1 : 0) - (b.oddsEstimated ? 1 : 0);
    });
    const dedupedByProb = this.applyLeagueDedup(sortedByProb, 2);
    const sortedByOdds = [...candidates].sort((a, b) => b.odds - a.odds);
    const dedupedByOdds = this.applyLeagueDedup(sortedByOdds, 2);

    for (const tier of tierDefs) {
      let pickTop: CandidateMatch[] = [];

      if (tier.idSuffix === '2x1') {
        pickTop = dedupedByProb.slice(0, tier.legs);
      } else if (tier.idSuffix === '3x1') {
        pickTop = dedupedByProb.slice(0, tier.legs);
      } else if (tier.idSuffix === '3x4' && tier.tolerance) {
        if (dedupedByProb.length >= tier.legs + 1) {
          pickTop = dedupedByProb.slice(1, tier.legs + 1);
        } else {
          pickTop = dedupedByProb.slice(0, tier.legs);
        }
      } else if (tier.idSuffix === '4x1') {
        pickTop = dedupedByOdds.slice(0, tier.legs);
        if (pickTop.length < tier.legs) {
          pickTop = dedupedByProb.slice(0, tier.legs);
        }
      } else {
        pickTop = dedupedByProb.slice(0, tier.legs);
      }

      const hasEnough = pickTop.length >= tier.legs;

      if (hasEnough) {
        const hitRate = tier.tolerance
          ? this.calc3of4HitRate(pickTop)
          : this.calcHitRate(pickTop);
        const totalOdds = this.calcTotalOdds(pickTop);
        const hasEstimated = pickTop.some((m) => m.oddsEstimated);
        const reasonBase = `${tier.legs}场最高信心${playLabel}组合，合命中率${hitRate}%`;
        const reason = tier.tolerance ? `3场容错组合，至少中两场概率${hitRate}%` : reasonBase;
        const noteParts: string[] = [];
        if (hasEstimated) noteParts.push('部分指数为概率估算');
        if (tier.tolerance) noteParts.push('错1场仍有回本机会');

        const toleranceInfo = tier.tolerance
          ? this.calcToleranceIndexRange(pickTop)
          : undefined;

        items.push({
          id: `${sportPrefix}-${category}-${tier.idSuffix}`,
          date,
          name: `${sportName}${tier.nameLabel}·${playLabel}`,
          matches: pickTop.map((m) => this.toParlayMatchItem(m)),
          totalReferenceIndex: totalOdds,
          comboType: tier.comboType,
          hitRate,
          riskLevel: tier.riskLevel,
          reason,
          status: 'active',
          note: noteParts.length > 0 ? noteParts.join('；') : undefined,
          playCategory: category === 'straight' ? '胜平负' : (category === 'total' ? '大小分' : '让分'),
          toleranceInfo,
          probabilityNote: '按模型信心估算',
          ...this.computeParlayExtraFields(pickTop, confidenceHitRates),
        });
      } else {
        items.push({
          id: `${sportPrefix}-${category}-${tier.idSuffix}`,
          date,
          name: `${sportName}${tier.nameLabel}·${playLabel}`,
          matches: [],
          totalReferenceIndex: 0,
          comboType: tier.comboType,
          hitRate: 0,
          riskLevel: tier.riskLevel,
          reason: '',
          status: 'insufficient',
          note: `当日合格场次不足${tier.legs}场`,
          playCategory: category === 'straight' ? '胜平负' : (category === 'total' ? '大小分' : '让分'),
          probabilityNote: '按模型信心估算',
          ...this.computeParlayExtraFields([], confidenceHitRates),
        });
      }
    }

    return items;
  }

  private sortActiveItems(items: ParlayItem[]): ParlayItem[] {
    const active = items.filter((i) => i.status === 'active');
    const insufficient = items.filter((i) => i.status === 'insufficient');
    active.sort((a, b) => {
      if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
      return b.totalReferenceIndex * b.hitRate - a.totalReferenceIndex * a.hitRate;
    });
    return [...active, ...insufficient];
  }

  async getListByDate(date: string, sportType: 'football' | 'basketball' = 'football'): Promise<ParlayListResponse> {
    let handicapCandidates: CandidateMatch[] = [];
    let totalCandidates: CandidateMatch[] = [];

    let straightCandidates: CandidateMatch[] = [];

    if (sportType === 'football') {
      straightCandidates = await this.filterFootballStraight(date);
      handicapCandidates = await this.filterFootballHandicap(date);
      totalCandidates = await this.filterFootballTotal(date);
    } else {
      handicapCandidates = await this.filterBasketballHandicap(date);
      totalCandidates = await this.filterBasketballTotal(date);
    }

    const confidenceHitRates = await this.getConfidenceHistoricalHitRates(sportType);

    const sportName = sportType === 'football' ? '足球' : '篮球';
    const handicapLabel = sportType === 'football' ? '让球胜平负' : '让分胜负';
    const totalLabel = sportType === 'football' ? '总进球' : '大小分';
    const mainTiers = sportType === 'football' ? FOOTBALL_TIERS : BASKETBALL_TIERS;

    const straightItems = sportType === 'football'
      ? this.buildTiers(
          straightCandidates, 'straight', '胜平负', 'football', '足球', FOOTBALL_STRAIGHT_TIERS, date, confidenceHitRates,
        )
      : [];
    const handicapItems = this.buildTiers(
      handicapCandidates, 'handicap', handicapLabel, sportType, sportName, mainTiers, date, confidenceHitRates,
    );
    const totalItems = this.buildTiers(
      totalCandidates, 'total', totalLabel, sportType, sportName, TOTAL_TIERS, date, confidenceHitRates,
    );

    const allItems = [
      ...this.sortActiveItems(straightItems),
      ...this.sortActiveItems(handicapItems),
      ...this.sortActiveItems(totalItems),
    ];

    return { items: allItems, date };
  }
}
