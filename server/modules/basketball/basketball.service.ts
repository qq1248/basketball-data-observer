import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, lte, ne, sql, count, not, or } from 'drizzle-orm';
import { basketballMatches, dataSnapshots, basketballOddsSnapshots, ruleDisabled, injuryReports, teamSeasonStats, scoreSentinelLogs } from '@server/database/schema';
import { SportteryService } from '../sporttery/sporttery.service';
import { BasketballAnchorPredictionService } from './basketball-anchor-prediction.service';
import { EloHistoryService } from '../elo/elo-history.service';
import { BasketballDataDrivenPredictionService } from '../basketball-prediction/basketball-data-driven.service';
import { parseIntelFromRow } from './basketball-intel.service';
import { normalizeBasketballTeamName } from '../sporttery/team-mappings';
import {
  insertBasketballOddsSnapshotIfChanged,
  type BasketballOddsSnapshotHandicap,
  type BasketballOddsSnapshotTotal,
} from '@server/common/odds-snapshots';
import {
  shouldSkipPredictionWrite,
  stripPredictionFieldsFromPatch,
  isDataDrivenEngine,
} from '@server/common/utils/basketball-prediction-guard';
import type {
  BasketballListResponse,
  BasketballDetailResponse,
  InjuryReport,
  BasketballDateStatsResponse,
  BasketballMatchItem,
  BasketballStatsResponse,
  BasketballBacktestResponse,
  BasketballParlayResponse,
  BasketballParlayCombo,
  BasketballParlayPick,
  BasketballParlayMatch,
  BasketballOddsAlertsResponse,
  BasketballOddsAlertItem,
  CreateBasketballMatchRequest,
  BatchUpsertResponse,
  DataCheckResponse,
  DataCheckByDateItem,
  BasketballRecalcHandicapResponse,
  BasketballSubModelRef,
  BasketballDataSourceStatusResponse,
  BasketballDataSourceStatusItem,
  PredictionAccuracyResponse,
  OddsTrendResponse,
  OddsTrendPoint,
   MatchMultiSourceResponse,
   MatchSourceOdds,
   DivergenceDetail,
    RuleBacktestResponse,
   RuleBacktestItem,
   StarRating,
   BasketballFinalCard,
 } from '@shared/api.interface';

interface ListQueryParams {
   date: string;
   league?: string;
   confidence?: 'high' | 'medium' | 'low';
   direction?: string;
   sort?: 'kickoff_asc' | 'confidence_desc';
   status?: 'upcoming' | 'finished';
    sourceFilter?: 'all' | 'jingcai' | 'others';
    divergence?: 'divergent' | 'consistent';
    page?: number;
    pageSize?: number;
    dateMode?: 'business' | 'kickoff';
 }

interface TeamRecentStats {
  recent10Ppg: number;
  recent10Oppg: number;
  recent10Pd: number;
  recent20Ppg: number;
  recent20Oppg: number;
  recent20Pd: number;
  sampleCount: number;
}

interface H2HStats {
  recentPd: number | null;
  recentCount: number;
  historicalPd: number | null;
  historicalCount: number;
}

interface MatchFeatures {
  recent10HomePpg?: number;
  recent10AwayPpg?: number;
  recent10HomeOppg?: number;
  recent10AwayOppg?: number;
  recent20HomePpg?: number;
  recent20AwayPpg?: number;
  recent20HomeOppg?: number;
  recent20AwayOppg?: number;
  recentSampleCount?: number;
  h2hRecent?: number;
  h2hHistorical?: number;
  h2hRecentCount?: number;
  h2hHistoricalCount?: number;
}

interface V11BacktestHitStat {
  wdwHitRate: number;
  handicapHitRate: number;
  overunderHitRate: number;
  wdwSamples: number;
  handicapSamples: number;
  ouSamples: number;
}

interface V11BacktestLeagueItem {
  league: string;
  sampleSize: number;
  v11: V11BacktestHitStat;
  oldModel: V11BacktestHitStat;
}

interface V11BacktestOverall {
  v11: V11BacktestHitStat;
  oldModel: V11BacktestHitStat;
  sampleSize: number;
}

interface V11BacktestResponse {
  hasData: boolean;
  totalSamples: number;
  dateRange: { start: string; end: string };
  byLeague: V11BacktestLeagueItem[];
  overall: V11BacktestOverall;
}

@Injectable()
export class BasketballService {
  private readonly logger = new Logger(BasketballService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly sportteryService: SportteryService,
    private readonly anchorPrediction: BasketballAnchorPredictionService,
    private readonly eloHistoryService: EloHistoryService,
    private readonly dataDrivenService: BasketballDataDrivenPredictionService,
  ) {}

  private async filterDisabledRules(rules: string[]): Promise<string[]> {
    const disabledRows = await this.db
      .select({ rulePattern: ruleDisabled.rulePattern })
      .from(ruleDisabled)
      .where(
        sql`${ruleDisabled.sport} = 'basketball' AND ${ruleDisabled.action} = 'disabled'`,
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

  private isMatchAnalyzed(row: typeof basketballMatches.$inferSelect): boolean {
    const homeP = Number(row.homeWinProb) || 0;
    const awayP = Number(row.awayWinProb) || 0;
    const hasRealWdw = homeP + awayP > 0 && homeP !== awayP;
    const totalP = Number(row.totalPickProb) || 0;
    const overP = Number(row.overProb) || 0;
    const underP = Number(row.underProb) || 0;
    const hasRealTotal = totalP !== 50 && totalP > 0;
    const hCover = Number(row.handicapCoverProb) || 0;
    const hPickP = Number(row.handicapPickProb) || 0;
    const hasRealHandicap = (hCover > 0 && hCover !== 50) || (hPickP > 0 && hPickP !== 50);
    const predH = Number(row.predictedHomeScore) || 0;
    const predA = Number(row.predictedAwayScore) || 0;
    const hasRealScore = predH + predA > 0 && !(predH === 0 && predA === 0);
    return hasRealWdw || hasRealTotal || hasRealHandicap || hasRealScore;
  }

  private isWdwAnalyzed(row: typeof basketballMatches.$inferSelect): boolean {
    const dir = row.predictionDirection || '';
    const homeP = Number(row.homeWinProb) || 0;
    const awayP = Number(row.awayWinProb) || 0;
    if (dir === '主胜' || dir === '客胜') return true;
    return homeP + awayP > 0 && homeP !== awayP;
  }

  private isHandicapAnalyzed(row: typeof basketballMatches.$inferSelect): boolean {
    const rec = row.handicapRecommendation || '';
    if (rec.includes('观望') || rec.includes('待线值')) return false;
    const hPick = row.handicapPick || '';
    if (hPick.includes('观望') || hPick.includes('待线值')) return false;
    return rec.length > 0 || hPick.length > 0;
  }

  private isTotalAnalyzed(row: typeof basketballMatches.$inferSelect): boolean {
    const overP = Number(row.overProb) || 0;
    const underP = Number(row.underProb) || 0;
    const dir = row.totalDirection || '';
    if (dir.includes('观望') || dir.includes('待线值')) return false;
    if (overP + underP === 0) return false;
    if (dir === '大分' || dir === '小分') return overP > 0 && underP > 0;
    return overP !== 50 && overP > 0 && underP > 0;
  }

  private isHandicapProbValid(row: typeof basketballMatches.$inferSelect): boolean {
    const cp = Number(row.handicapCoverProb) || 0;
    return cp > 0 && cp < 100 && cp !== 50;
  }

  private resolveTotalPick(row: typeof basketballMatches.$inferSelect): string {
    const overP = Number(row.overProb) || 0;
    const underP = Number(row.underProb) || 0;
    if (overP + underP === 0) return '观望';
    const dir = row.totalDirection || '';
    if (dir.includes('观望') || !dir) return '观望';
    // 以 totalDirection 为权威，totalPick 仅作兜底
    // 历史遗留：V7模型写totalPick，V10/V11写totalDirection，可能不同步
    const pick = row.totalPick || '';
    if (!pick) return dir;
    // 方向一致：原样返回；方向冲突：以totalDirection为准
    const dirIsBig = dir.includes('大');
    const pickIsBig = pick.includes('大');
    if (dirIsBig === pickIsBig) return pick;
    return dirIsBig ? '大分' : '小分';
  }

  private resolveHandicapPick(row: typeof basketballMatches.$inferSelect): string {
    const cp = Number(row.handicapCoverProb) || 0;
    const rec = row.handicapRecommendation || '';
    if (cp === 0 || cp === 100) return '观望';
    if (rec.includes('观望') || !rec) {
      const wdw = row.predictionDirection || '';
      if (cp === 50 && (wdw === '主胜' || wdw === '客胜')) {
        return wdw === '主胜' ? '让分主胜' : '让分客胜';
      }
      return '观望';
    }
    // 以 handicapRecommendation 为权威方向（handicap_pick 历史数据可能与推荐不一致）
    const pick = rec === '让分主负' ? '让分客胜' : rec;
    return pick;
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

  async getListByDate(params: ListQueryParams): Promise<BasketballListResponse> {
    const {
      date,
      league,
      confidence,
      direction,
      sort = 'kickoff_asc',
      status,
      sourceFilter = 'all',
      divergence,
      page = 1,
      pageSize = 50,
    } = params;
    const actualPage = Math.max(1, page);
    const actualPageSize = Math.min(Math.max(1, pageSize), 200);
    const nextDate = this.getNextDate(date);
    const needsDivergence = divergence !== undefined;
    const useKickoffMode = params.dateMode === 'kickoff';
    const conditions = useKickoffMode
      ? [
          sql`${basketballMatches.kickoffTime} AT TIME ZONE 'Asia/Shanghai' >= ${date}::date`,
          sql`${basketballMatches.kickoffTime} AT TIME ZONE 'Asia/Shanghai' < ${nextDate}::date`,
        ]
      : [
          gte(basketballMatches.businessDate, date),
          lt(basketballMatches.businessDate, nextDate),
        ];

    if (league) {
      conditions.push(ilike(basketballMatches.league, `%${league}%`));
    }
    if (confidence === 'high') {
      conditions.push(gte(basketballMatches.confidence, 70));
    } else if (confidence === 'medium') {
      conditions.push(and(gte(basketballMatches.confidence, 50), lt(basketballMatches.confidence, 70)));
    } else if (confidence === 'low') {
      conditions.push(lt(basketballMatches.confidence, 50));
    }
    if (direction) {
      conditions.push(eq(basketballMatches.predictionDirection, direction));
    }
    if (status) {
      conditions.push(eq(basketballMatches.matchStatus, status));
    }
    if (sourceFilter === 'jingcai') {
      conditions.push(inArray(basketballMatches.source, ['sporttery', 'fox']));
      conditions.push(not(inArray(basketballMatches.league, ['Diff Batch', 'Perf55b'])));
    } else if (sourceFilter === 'others') {
      conditions.push(sql`${basketballMatches.source} <> 'sporttery' OR ${basketballMatches.source} IS NULL`);
    }

    const orderBy = sort === 'confidence_desc'
      ? [desc(basketballMatches.confidence), asc(basketballMatches.matchNo)]
      : [asc(basketballMatches.kickoffTime), asc(basketballMatches.matchNo)];

    const [{ total: dbTotal }] = await this.db
      .select({ total: count() })
      .from(basketballMatches)
      .where(and(...conditions));

    const rowsQuery = this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        matchDate: basketballMatches.matchDate,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        homeWinProb: basketballMatches.homeWinProb,
        awayWinProb: basketballMatches.awayWinProb,
        predictionDirection: basketballMatches.predictionDirection,
        confidence: basketballMatches.confidence,
        handicapLineNum: basketballMatches.handicapLineNum,
        handicapPick: basketballMatches.handicapPick,
        totalLineNum: basketballMatches.totalLineNum,
        totalPick: basketballMatches.totalPick,
        totalDirection: basketballMatches.totalDirection,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        liveScoreSource: basketballMatches.liveScoreSource,
        lastScoreAt: basketballMatches.lastScoreAt,
        lastDataSyncAt: basketballMatches.lastDataSyncAt,
        source: basketballMatches.source,
        businessDate: basketballMatches.businessDate,
        hitWdw: basketballMatches.hitWdw,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
        modelRules: basketballMatches.modelRules,
        intelSummary: basketballMatches.intelSummary,
        isNeutral: basketballMatches.isNeutral,
        category: basketballMatches.category,
        handicap: basketballMatches.handicap,
        handicapCoverProb: basketballMatches.handicapCoverProb,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapPickProb: basketballMatches.handicapPickProb,
        totalLine: basketballMatches.totalLine,
        overProb: basketballMatches.overProb,
        underProb: basketballMatches.underProb,
        totalPickProb: basketballMatches.totalPickProb,
        predictedHomeScore: basketballMatches.predictedHomeScore,
        predictedAwayScore: basketballMatches.predictedAwayScore,
        predictedTotal: basketballMatches.predictedTotal,
        livePeriod: basketballMatches.livePeriod,
        liveClock: basketballMatches.liveClock,
        livePeriodEstimated: basketballMatches.livePeriodEstimated,
        sourceMatchId: basketballMatches.sourceMatchId,
        handicapOddsHome: basketballMatches.handicapOddsHome,
        handicapOddsAway: basketballMatches.handicapOddsAway,
        totalOddsOver: basketballMatches.totalOddsOver,
        totalOddsUnder: basketballMatches.totalOddsUnder,
         homeWinOdds: basketballMatches.homeWinOdds,
         awayWinOdds: basketballMatches.awayWinOdds,
         injuries: basketballMatches.injuries,
         spreadProb15: basketballMatches.spreadProb15,
         spreadProb610: basketballMatches.spreadProb610,
         spreadProb1115: basketballMatches.spreadProb1115,
         spreadProb1620: basketballMatches.spreadProb1620,
         spreadProb21Plus: basketballMatches.spreadProb21Plus,
         spreadTopRange: basketballMatches.spreadTopRange,
         riskWarning: basketballMatches.riskWarning,
          ouConfidence: basketballMatches.ouConfidence,
          handicapConfidence: basketballMatches.handicapConfidence,
          oddsMovements: basketballMatches.oddsMovements,
          predEngineVersion: basketballMatches.predEngineVersion,
       })
      .from(basketballMatches)
      .where(and(...conditions))
      .orderBy(...orderBy);

    const allRows = needsDivergence
      ? await rowsQuery
      : await rowsQuery.limit(actualPageSize).offset((actualPage - 1) * actualPageSize);

    const allRowIds: string[] = allRows.map((row) => row.id);
    const divergenceMap = await this.getMatchesWithDivergence(allRowIds);

    const itemsWithDiv: BasketballMatchItem[] = allRows.map((row) => {
      const item = this.mapToListItem(row as unknown as Parameters<BasketballService['mapToListItem']>[0]);
      if (item.intelSummary && item.intelSummary.length > 120) {
        (item as { intelSummary: string }).intelSummary = item.intelSummary.replace(/\s+/g, ' ').slice(0, 117) + '...';
      }
      const sources = divergenceMap.get(row.id) ?? [];
      const matchSource = row.source ?? 'sporttery';
      const matchSourceExists = sources.some((s: MatchSourceOdds) => s.source === matchSource);
      let allSources: MatchSourceOdds[] = [...sources];
      if (!matchSourceExists) {
        const matchSourceItem: MatchSourceOdds = {
          source: matchSource,
          updatedAt: row.lastDataSyncAt
            ? row.lastDataSyncAt instanceof Date
              ? row.lastDataSyncAt.toISOString()
              : String(row.lastDataSyncAt)
            : '',
        };
        if (row.homeWinOdds != null) matchSourceItem.homeWinOdds = Number(row.homeWinOdds);
        if (row.awayWinOdds != null) matchSourceItem.awayWinOdds = Number(row.awayWinOdds);
        if (row.handicapOddsHome != null) matchSourceItem.handicapOddsHome = Number(row.handicapOddsHome);
        if (row.handicapOddsAway != null) matchSourceItem.handicapOddsAway = Number(row.handicapOddsAway);
        if (row.totalOddsOver != null) matchSourceItem.totalOddsOver = Number(row.totalOddsOver);
        if (row.totalOddsUnder != null) matchSourceItem.totalOddsUnder = Number(row.totalOddsUnder);
        allSources = [matchSourceItem, ...sources];
      }
      const divResult = this.calcDivergence(
        {
          handicapLineNum: row.handicapLineNum != null ? Number(row.handicapLineNum) : null,
          handicapPick: row.handicapPick ?? null,
          totalDirection: row.totalDirection ?? null,
          predictionDirection: row.predictionDirection ?? null,
        },
        allSources,
      );
      item.divergenceStatus = divResult.status;
      (item as { divergenceDetail: DivergenceDetail | null }).divergenceDetail = divResult.detail;
      return item;
    });

    let filteredItems: BasketballMatchItem[] = itemsWithDiv;
    if (divergence === 'divergent') {
      filteredItems = itemsWithDiv.filter((item: BasketballMatchItem) => item.divergenceStatus === 'divergent');
    } else if (divergence === 'consistent') {
      filteredItems = itemsWithDiv.filter((item: BasketballMatchItem) => item.divergenceStatus === 'consistent');
    }

    const finalTotal = divergence === 'divergent'
      ? filteredItems.length
      : divergence === 'consistent'
      ? filteredItems.length
      : Number(dbTotal);
    const highConfCount = filteredItems.filter(
      (item: BasketballMatchItem) => item.confidence >= 65,
    ).length;
    const startIdx = (actualPage - 1) * actualPageSize;
    const items: BasketballMatchItem[] = needsDivergence
      ? filteredItems.slice(startIdx, startIdx + actualPageSize)
      : filteredItems;

    // Lazy-trigger ESPN live sync if any live/today-upcoming match is stale
    const todayBeijing = this.getBeijingDateStr(new Date());
    let oldestLiveSync: Date | null = null;
    let oldestUpcomingSync: Date | null = null;
    let hasLive = false;
    let hasTodayUpcoming = false;
    for (const row of allRows) {
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
      this.sportteryService.lazyTriggerBasketballSync(oldestLiveSync, 'live');
    } else if (hasTodayUpcoming) {
      this.sportteryService.lazyTriggerBasketballSync(oldestUpcomingSync, 'upcoming');
    }

    return {
      items,
      date,
      total: finalTotal,
      highConfCount,
      page: actualPage,
      pageSize: actualPageSize,
    };
  }

  async getDateStats(startDate: string, endDate: string): Promise<BasketballDateStatsResponse> {
    const rows = await this.db
      .select({
        matchDate: basketballMatches.businessDate,
        total: sql<number>`count(*)`,
        finished: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished')`,
        upcoming: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'upcoming')`,
        wdwHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.predictionDirection} in ('主胜', '客胜'))`,
        handicapHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitHandicap} = true)`,
        handicapTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.handicapRecommendation} is not null and ${basketballMatches.handicapRecommendation} <> '' and ${basketballMatches.handicapRecommendation} not like '%观望%')`,
        ouHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and (${basketballMatches.totalDirection} in ('大', '小') or ${basketballMatches.totalDirection} in ('大分', '小分')))`,
      })
      .from(basketballMatches)
      .where(and(gte(basketballMatches.businessDate, startDate), lt(basketballMatches.businessDate, this.getNextDate(endDate))))
      .groupBy(basketballMatches.businessDate)
      .orderBy(asc(basketballMatches.businessDate));

    const dateMap = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      dateMap.set(row.matchDate.toString(), row);
    }

    const items: BasketballDateStatsResponse['items'] = [];
    let current = startDate;
    while (current <= endDate) {
      const row = dateMap.get(current);
      if (row) {
        const wdwTotal = Number(row.wdwTotal);
        const hcTotal = Number(row.handicapTotal);
        const ouTotal = Number(row.ouTotal);
        const wdwHits = Number(row.wdwHits);
        const hcHits = Number(row.handicapHits);
        const ouHits = Number(row.ouHits);
        items.push({
          date: current,
          totalMatches: Number(row.total),
          finishedCount: Number(row.finished),
          upcomingCount: Number(row.upcoming),
          wdwHitRate: wdwTotal > 0 ? wdwHits / wdwTotal : 0,
          handicapHitRate: hcTotal > 0 ? hcHits / hcTotal : 0,
          overUnderHitRate: ouTotal > 0 ? ouHits / ouTotal : 0,
          wdwTotal,
          wdwHit: wdwHits,
          wdwAccuracy: wdwTotal > 0 ? (wdwHits / wdwTotal) * 100 : 0,
          handicapTotal: hcTotal,
          handicapHit: hcHits,
          handicapAccuracy: hcTotal > 0 ? (hcHits / hcTotal) * 100 : 0,
          overunderTotal: ouTotal,
          overunderHit: ouHits,
          overunderAccuracy: ouTotal > 0 ? (ouHits / ouTotal) * 100 : 0,
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
          wdwTotal: 0,
          wdwHit: 0,
          wdwAccuracy: 0,
          handicapTotal: 0,
          handicapHit: 0,
          handicapAccuracy: 0,
          overunderTotal: 0,
          overunderHit: 0,
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

  async runV113Backtest(
    businessDate?: string,
    source?: string,
  ): Promise<{
    matches: Array<{
      matchNo: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      league: string | null;
      line: number | null;
      oldHandicapRec: string | null;
      newHandicapRec: string;
      oldTotalDir: string | null;
      newTotalDir: string;
      oldHomeProb: number | null;
      newHomeProb: number;
      weightedHome: number;
      weightedAway: number;
      injuryShift: number;
      modelVersion: string;
      hitHandicapOld: boolean | null;
      hitHandicapNew: boolean | null;
      hitOuOld: boolean | null;
      hitOuNew: boolean | null;
      homeScore: number | null;
      awayScore: number | null;
    }>;
    summary: {
      total: number;
      oldHandicapHitRate: number;
      newHandicapHitRate: number;
      oldOuHitRate: number;
      newOuHitRate: number;
      shallowLineSamples: number;
      shallowLineOldHitRate: number;
      shallowLineNewHitRate: number;
    };
  }> {
    const whereConditions = [];
    if (businessDate) {
      whereConditions.push(eq(basketballMatches.businessDate, businessDate));
    }
    if (source) {
      whereConditions.push(eq(basketballMatches.source, source));
    }
    whereConditions.push(eq(basketballMatches.matchStatus, 'finished'));
    whereConditions.push(isNotNull(basketballMatches.handicapLineNum));
    whereConditions.push(isNotNull(basketballMatches.totalLineNum));

    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
        predictionDirection: basketballMatches.predictionDirection,
        homeWinProb: basketballMatches.homeWinProb,
        awayWinProb: basketballMatches.awayWinProb,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        totalDirection: basketballMatches.totalDirection,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
        injuries: basketballMatches.injuries,
        teamStats: basketballMatches.teamStats,
        recentForm: basketballMatches.recentForm,
        intel: basketballMatches.intel,
        intelSummary: basketballMatches.intelSummary,
        h2hHistory: basketballMatches.h2hHistory,
        keyPlayers: basketballMatches.keyPlayers,
      })
      .from(basketballMatches)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(asc(basketballMatches.kickoffTime))
      .limit(100);

    const matchResults: Array<{
      matchNo: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      league: string | null;
      line: number | null;
      oldHandicapRec: string | null;
      newHandicapRec: string;
      oldTotalDir: string | null;
      newTotalDir: string;
      oldHomeProb: number | null;
      newHomeProb: number;
      weightedHome: number;
      weightedAway: number;
      injuryShift: number;
      modelVersion: string;
      hitHandicapOld: boolean | null;
      hitHandicapNew: boolean | null;
      hitOuOld: boolean | null;
      hitOuNew: boolean | null;
      homeScore: number | null;
      awayScore: number | null;
    }> = [];

    let hcOldHits = 0;
    let hcNewHits = 0;
    let ouOldHits = 0;
    let ouNewHits = 0;
    let validCount = 0;
    let shallowCount = 0;
    let shallowOldHits = 0;
    let shallowNewHits = 0;

    for (const row of rows) {
      const handicapVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
      const hasValidSpread = !Number.isNaN(handicapVal) && Math.abs(handicapVal) > 0;
      const totalVal = row.totalLineNum != null ? Number(row.totalLineNum) : 0;

      const isHomeFavorite = handicapVal < 0;
      let favoriteTeamSide: 'home' | 'away' | null = null;
      if (hasValidSpread) {
        favoriteTeamSide = isHomeFavorite ? 'home' : 'away';
      }

      let coreInjuriesHome = 0;
      let coreInjuriesAway = 0;
      let weightedInjuriesHome = 0;
      let weightedInjuriesAway = 0;
      let freshCoreHome = 0;
      let freshCoreAway = 0;
      let freshWeightedHome = 0;
      let freshWeightedAway = 0;

      if (row.injuries && typeof row.injuries === 'object') {
        const inj = row.injuries as Record<string, unknown>;
        const parseInjuryList = (list: unknown): { impact?: string; status?: string; date?: string; comment?: string; player?: string }[] => {
          if (!Array.isArray(list)) return [];
          return list.map((item: unknown) => {
            if (item && typeof item === 'object') {
              const o = item as Record<string, unknown>;
              return {
                impact: o.impactRating as string || o.impact as string,
                status: o.status as string,
                date: o.injuryDate as string || o.date as string,
                comment: (o.shortComment || o.comment || '') as string,
                player: (o.name || o.player || '') as string,
              };
            }
            return {};
          });
        };
        const homeList = parseInjuryList(inj.home);
        const awayList = parseInjuryList(inj.away);
        const LONG_TERM_DAYS = 10;
        const kickoffMs = row.kickoffTime ? new Date(row.kickoffTime).getTime() : Date.now();

        const classifyImpact = (p: { impact?: string; status?: string; comment?: string }): { rating: string; weight: number; isCore: boolean } => {
          const impact = (p.impact || '').toLowerCase();
          const status = (p.status || '').toLowerCase();
          const commentLow = (p.comment || '').toLowerCase();

          if (impact === 'high') return { rating: 'high', weight: 1.0, isCore: true };
          if (impact === 'medium') return { rating: 'medium', weight: 0.5, isCore: false };
          if (impact === 'low') return { rating: 'low', weight: 0.2, isCore: false };

          if (
            status.includes('out') ||
            status.includes('赛季报销') ||
            status.includes('报销') ||
            status.includes('indefinitely') ||
            status.includes('无限期') ||
            /核心|主力|star|starter/.test(commentLow)
          ) {
            return { rating: 'high', weight: 1.0, isCore: true };
          }
          if (
            status.includes('day-to-day') ||
            status.includes('每日观察') ||
            status.includes('questionable') ||
            status.includes('出战成疑') ||
            status.includes('doubtful') ||
            status.includes('缺阵') ||
            status.includes('缺席')
          ) {
            return { rating: 'medium', weight: 0.5, isCore: false };
          }
          if (status.includes('probable') || status.includes('available') || status.includes('可以出战')) {
            return { rating: 'low', weight: 0.2, isCore: false };
          }

          return { rating: 'unknown', weight: 0.3, isCore: status.includes('out') };
        };

        for (const p of homeList) {
          const cls = classifyImpact(p);
          if (cls.isCore) coreInjuriesHome += 1;
          weightedInjuriesHome += cls.weight;

          const injDate = p.date ? new Date(p.date).getTime() : null;
          const daysSince = injDate ? (kickoffMs - injDate) / (24 * 60 * 60 * 1000) : 0;
          const commentLow = (p.comment || '').toLowerCase();
          const isSeasonOut = /赛季报销|season[\s-]*ending|out[\s-]*for[\s-]*the[\s-]*season|out[\s-]*indefinitely|indefinitely|out.*season(?!\s*opener|\s*debut)|miss.*(the\s+)?season|for\s+the\s+rest\s+of\s+the\s+season|achilles\s+(surgery|repair|rupture)|torn\s+(acl|achilles|meniscus|ligament|rotator\s+cuff)|acl\s+(surgery|tear|torn|reconstruction)|rupture|fracture|broken\s+(bone|leg|arm|foot|hand|wrist)|out\s+(6|8|10|12|16)\s*weeks|out\s+\d+\s*months|year(s)?\s+out/.test(commentLow);
          const isLongTerm = isSeasonOut || (daysSince > LONG_TERM_DAYS && /out|长期|无限期/.test(p.status || ''));
          if (!isLongTerm) {
            freshWeightedHome += cls.weight;
            if (cls.isCore) freshCoreHome += 1;
          }
        }
        for (const p of awayList) {
          const cls = classifyImpact(p);
          if (cls.isCore) coreInjuriesAway += 1;
          weightedInjuriesAway += cls.weight;

          const injDate = p.date ? new Date(p.date).getTime() : null;
          const daysSince = injDate ? (kickoffMs - injDate) / (24 * 60 * 60 * 1000) : 0;
          const commentLow = (p.comment || '').toLowerCase();
          const isSeasonOut = /赛季报销|season[\s-]*ending|out[\s-]*for[\s-]*the[\s-]*season|out[\s-]*indefinitely|indefinitely|out.*season(?!\s*opener|\s*debut)|miss.*(the\s+)?season|for\s+the\s+rest\s+of\s+the\s+season|achilles\s+(surgery|repair|rupture)|torn\s+(acl|achilles|meniscus|ligament|rotator\s+cuff)|acl\s+(surgery|tear|torn|reconstruction)|rupture|fracture|broken\s+(bone|leg|arm|foot|hand|wrist)|out\s+(6|8|10|12|16)\s*weeks|out\s+\d+\s*months|year(s)?\s+out/.test(commentLow);
          const isLongTerm = isSeasonOut || (daysSince > LONG_TERM_DAYS && /out|长期|无限期/.test(p.status || ''));
          if (!isLongTerm) {
            freshWeightedAway += cls.weight;
            if (cls.isCore) freshCoreAway += 1;
          }
        }
      }

      let homePpg: number | undefined;
      let awayPpg: number | undefined;
      let homeOppg: number | undefined;
      let awayOppg: number | undefined;
      if (row.teamStats && typeof row.teamStats === 'object') {
        const ts = row.teamStats as Record<string, unknown>;
        const hs = ts.home as Record<string, unknown> | null;
        const as = ts.away as Record<string, unknown> | null;
        if (hs) {
          const v = Number(hs.pointsPerGame ?? hs.ppg);
          if (!Number.isNaN(v) && v > 0) homePpg = v;
          const ov = Number(hs.opponentsPointsPerGame ?? hs.oppg);
          if (!Number.isNaN(ov) && ov > 0) homeOppg = ov;
        }
        if (as) {
          const v = Number(as.pointsPerGame ?? as.ppg);
          if (!Number.isNaN(v) && v > 0) awayPpg = v;
          const ov = Number(as.opponentsPointsPerGame ?? as.oppg);
          if (!Number.isNaN(ov) && ov > 0) awayOppg = ov;
        }
      }

      const hwOdds = row.homeWinOdds != null ? Number(row.homeWinOdds) : 0;
      const awOdds = row.awayWinOdds != null ? Number(row.awayWinOdds) : 0;

      const anchorResult = this.anchorPrediction.predict({
        handicapLineNum: hasValidSpread ? handicapVal : null,
        totalLineNum: totalVal > 0 ? totalVal : null,
        league: row.league || 'default',
        homeTeam: row.homeTeam ?? '',
        awayTeam: row.awayTeam ?? '',
        homeWinOdds: hwOdds > 0 ? hwOdds : undefined,
        awayWinOdds: awOdds > 0 ? awOdds : undefined,
        coreInjuriesHome,
        coreInjuriesAway,
        weightedInjuriesHome,
        weightedInjuriesAway,
        freshCoreInjuriesHome: freshCoreHome,
        freshCoreInjuriesAway: freshCoreAway,
        freshWeightedInjuriesHome: freshWeightedHome,
        freshWeightedInjuriesAway: freshWeightedAway,
        favoriteTeamSide,
        favoriteCoreInjuries: favoriteTeamSide === 'home' ? freshCoreHome : favoriteTeamSide === 'away' ? freshCoreAway : 0,
        homePpg,
        awayPpg,
        homeOppg,
        awayOppg,
      });

      if (!anchorResult) continue;

      const homeScore = row.homeScore;
      const awayScore = row.awayScore;
      const lineNum = hasValidSpread ? handicapVal : null;
      const actualDiff = homeScore != null && awayScore != null ? homeScore - awayScore : null;

      let hitHcNew: boolean | null = null;
      if (actualDiff !== null && lineNum != null) {
        const newRec = anchorResult.handicapRecommendation;
        if (newRec === '让分主胜') {
          hitHcNew = actualDiff > -lineNum;
        } else if (newRec === '让分客胜') {
          hitHcNew = actualDiff < -lineNum;
        }
      }

      let hitOuNew: boolean | null = null;
      if (actualDiff !== null && totalVal > 0 && row.homeScore != null && row.awayScore != null) {
        const actualTotal = row.homeScore + row.awayScore;
        const newDir = anchorResult.totalDirection;
        if (newDir === '大分') hitOuNew = actualTotal > totalVal;
        else if (newDir === '小分') hitOuNew = actualTotal < totalVal;
      }

      const isShallow = lineNum != null && Math.abs(lineNum) < 5.5;
      if (isShallow && hitHcNew != null) shallowCount++;

      const oldHc = row.hitHandicap;
      const oldOu = row.hitOverunder;

      if (oldHc != null) { hcOldHits += oldHc ? 1 : 0; validCount++; }
      if (hitHcNew != null && oldHc != null) hcNewHits += hitHcNew ? 1 : 0;
      if (oldOu != null) ouOldHits += oldOu ? 1 : 0;
      if (hitOuNew != null && oldOu != null) ouNewHits += hitOuNew ? 1 : 0;
      if (isShallow && oldHc != null) shallowOldHits += oldHc ? 1 : 0;
      if (isShallow && hitHcNew != null) shallowNewHits += hitHcNew ? 1 : 0;

      matchResults.push({
        matchNo: row.matchNo,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        league: row.league,
        line: lineNum,
        oldHandicapRec: row.handicapRecommendation,
        newHandicapRec: anchorResult.handicapRecommendation,
        oldTotalDir: row.totalDirection,
        newTotalDir: anchorResult.totalDirection,
        oldHomeProb: row.homeWinProb,
        newHomeProb: anchorResult.homeWinProb,
        weightedHome: Math.round(freshWeightedHome * 10) / 10,
        weightedAway: Math.round(freshWeightedAway * 10) / 10,
        injuryShift: Math.round((anchorResult.injuryAdjustApplied || 0) * 10) / 10,
        modelVersion: anchorResult.predEngineVersion || 'v11.1-unified',
        hitHandicapOld: oldHc,
        hitHandicapNew: hitHcNew,
        hitOuOld: oldOu,
        hitOuNew: hitOuNew,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
      });
    }

    const rate = (hits: number, total: number): number =>
      total > 0 ? Math.round((hits / total) * 1000) / 10 : 0;

    return {
      matches: matchResults,
      summary: {
        total: matchResults.length,
        oldHandicapHitRate: rate(hcOldHits, validCount),
        newHandicapHitRate: rate(hcNewHits, validCount),
        oldOuHitRate: rate(ouOldHits, validCount),
        newOuHitRate: rate(ouNewHits, validCount),
        shallowLineSamples: shallowCount,
        shallowLineOldHitRate: rate(shallowOldHits, shallowCount),
        shallowLineNewHitRate: rate(shallowNewHits, shallowCount),
      },
    };
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
        unnest(${basketballMatches.modelRules}) AS rule,
        count(*) AS sample_size,
        round(
          count(*) FILTER (WHERE ${basketballMatches.hitWdw} = true)::numeric
          / NULLIF(count(*) FILTER (WHERE ${basketballMatches.hitWdw} IS NOT NULL), 0)::numeric
          * 100, 2
        ) AS wdw_hit_rate,
        round(
          count(*) FILTER (WHERE ${basketballMatches.hitHandicap} = true)::numeric
          / NULLIF(count(*) FILTER (WHERE ${basketballMatches.hitHandicap} IS NOT NULL), 0)::numeric
          * 100, 2
        ) AS handicap_hit_rate,
        round(
          count(*) FILTER (WHERE ${basketballMatches.hitOverunder} = true)::numeric
          / NULLIF(count(*) FILTER (WHERE ${basketballMatches.hitOverunder} IS NOT NULL), 0)::numeric
          * 100, 2
        ) AS overunder_hit_rate
      FROM ${basketballMatches}
      WHERE ${basketballMatches.matchStatus} = 'finished'
        AND ${basketballMatches.modelRules} IS NOT NULL
        AND array_length(${basketballMatches.modelRules}, 1) > 0
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
      const handicapHitRate = row.handicap_hit_rate != null ? Number(row.handicap_hit_rate) : null;
      return {
        rule: row.rule,
        totalTriggered: sampleSize,
        adoptedCount: sampleSize,
        adoptedRate: 100,
        wdwHitRate: row.wdw_hit_rate != null ? Number(row.wdw_hit_rate) : null,
        handicapHitRate,
        overunderHitRate: row.overunder_hit_rate != null ? Number(row.overunder_hit_rate) : null,
        primaryDimension: 'handicap',
        action: this.resolveRuleAction(sampleSize, handicapHitRate),
        category: this.resolveRuleCategory(row.rule),
        ruleGroup: 'legacy',
      };
    });

    return {
      sport: 'basketball',
      totalRules: items.length,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  async getDetail(id: string): Promise<BasketballDetailResponse> {
    const rows = await this.db
      .select()
      .from(basketballMatches)
      .where(eq(basketballMatches.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    const row = rows[0];
    const todayBeijing = this.getBeijingDateStr(new Date());
    if (row.matchStatus === 'live') {
      this.sportteryService.lazyTriggerBasketballSync(
        row.lastDataSyncAt ? new Date(row.lastDataSyncAt) : null,
        'live',
      );
    } else if (row.matchStatus === 'upcoming' && String(row.businessDate) === todayBeijing) {
      this.sportteryService.lazyTriggerBasketballSync(
        row.lastDataSyncAt ? new Date(row.lastDataSyncAt) : null,
        'upcoming',
      );
    }

    const match = this.mapToItem(row);
    const handicapVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : NaN;
    const hasValidSpread =
      !Number.isNaN(handicapVal) && handicapVal !== 0 && Math.abs(handicapVal) <= 40;
    match.predEngineVersion = row.predEngineVersion ?? undefined;
    match.predictionAnchor = hasValidSpread ? 'spread_anchored' : 'no_line_fallback';
    match.advancedDataReady = false;
    match.advancedDataNotice = '高阶数据（四要素/效率模型）待接入';

    if (row.matchStatus === 'upcoming' || row.matchStatus === 'live') {
      const sourceCounts: Record<string, number> = {};
      for (const r of rows) {
        const s = r.source ?? 'unknown';
        sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
      }
      this.logger.error(`[ROWS-DEBUG] total rows=${rows.length}, by source: ${JSON.stringify(sourceCounts)}`);

      const historicalBaselines = await this.computeLeagueHistoricalBaselines();
      const histBaseline = historicalBaselines.get(row.league || 'default');

      // V11 近期战绩 + H2H 特征
      const kickoffTime = row.kickoffTime
        ? (row.kickoffTime instanceof Date ? row.kickoffTime : new Date(row.kickoffTime))
        : undefined;
      const recentMap = row.homeTeam && row.awayTeam
        ? await this.computeTeamRecentStats([row.homeTeam, row.awayTeam], kickoffTime, { enableFuzzy: false })
        : new Map<string, TeamRecentStats>();
      const homeRecent = row.homeTeam ? recentMap.get(row.homeTeam) : undefined;
      const awayRecent = row.awayTeam ? recentMap.get(row.awayTeam) : undefined;
      const h2h = row.homeTeam && row.awayTeam
        ? await this.computeH2HStats(row.homeTeam, row.awayTeam, kickoffTime)
        : null;

      // V11.3 伤停加权升级（球员重要性分级 + 长期缺阵适应）
      const injuryRowsForWeight = await this.db
        .select({
          teamSide: injuryReports.teamSide,
          impactRating: injuryReports.impactRating,
          injuryDate: injuryReports.injuryDate,
          status: injuryReports.status,
          shortComment: injuryReports.shortComment,
          expectedReturn: injuryReports.expectedReturn,
        })
        .from(injuryReports)
        .where(eq(injuryReports.matchId, id));

      const LONG_TERM_INJURY_DAYS = 10;
      const longTermCutoffMs = LONG_TERM_INJURY_DAYS * 24 * 60 * 60 * 1000;

      let weightedInjuriesHome = 0;
      let weightedInjuriesAway = 0;
      let coreInjuriesHome = 0;
      let coreInjuriesAway = 0;
      let freshWeightedInjuriesHome = 0;
      let freshWeightedInjuriesAway = 0;
      let freshCoreInjuriesHome = 0;
      let freshCoreInjuriesAway = 0;

      for (const ir of injuryRowsForWeight) {
        const isHigh = ir.impactRating === 'high';
        const isMed = ir.impactRating === 'medium';
        const isLow = ir.impactRating === 'low';
        const weight = isHigh ? 1.0 : isMed ? 0.5 : isLow ? 0.2 : 0.1;

        const injuryDate = ir.injuryDate
          ? (ir.injuryDate instanceof Date ? ir.injuryDate : new Date(ir.injuryDate))
          : null;
        const daysSinceInjury = injuryDate && kickoffTime
          ? (kickoffTime.getTime() - injuryDate.getTime()) / (24 * 60 * 60 * 1000)
          : 0;

        const comment = ir.shortComment || '';
        const isSeasonOut = /赛季报销|season[\s-]*ending|out[\s-]*for[\s-]*(the[\s-]*)*season|out[\s-]*indefinitely|indefinitely|out.*season(?!\s*opener|\s*debut|\s*high)|miss.*(the\s+)?season|for\s+the\s+rest\s+of\s+the\s+season|achilles\s+(surgery|repair|rupture)|torn\s+(acl|achilles|meniscus|ligament|rotator\s+cuff)|acl\s+(surgery|tear|torn|reconstruction)|rupture|fracture|broken\s+(bone|leg|arm|foot|hand|wrist)|out\s+(6|8|10|12|16)\s*weeks|out\s+\d+\s*months|year(s)?\s+out/.test(comment.toLowerCase());
        const isLongTerm = isSeasonOut
          || (daysSinceInjury > LONG_TERM_INJURY_DAYS && ir.status === 'out')
          || (ir.expectedReturn && /weeks|months|6-8|4-6|8-10|10-12/.test(ir.expectedReturn.toLowerCase()) && daysSinceInjury > 3);

        const isFreshSudden = !isLongTerm && (!injuryDate || daysSinceInjury <= LONG_TERM_INJURY_DAYS);

        if (ir.teamSide === 'home') {
          weightedInjuriesHome += weight;
          if (isHigh || isMed) coreInjuriesHome += 1;
          if (isFreshSudden) {
            freshWeightedInjuriesHome += weight;
            if (isHigh || isMed) freshCoreInjuriesHome += 1;
          }
        } else if (ir.teamSide === 'away') {
          weightedInjuriesAway += weight;
          if (isHigh || isMed) coreInjuriesAway += 1;
          if (isFreshSudden) {
            freshWeightedInjuriesAway += weight;
            if (isHigh || isMed) freshCoreInjuriesAway += 1;
          }
        }
      }
      const isHomeFavorite = hasValidSpread ? handicapVal < 0 : false;
      const favoriteTeamSide: 'home' | 'away' | null = hasValidSpread
        ? (isHomeFavorite ? 'home' : 'away')
        : null;
      const favoriteCoreInjuries = favoriteTeamSide === 'home'
        ? coreInjuriesHome
        : favoriteTeamSide === 'away' ? coreInjuriesAway : 0;

      const anchorResult = this.anchorPrediction.predict({
        handicapLineNum: hasValidSpread ? handicapVal : null,
        totalLineNum: row.totalLineNum != null ? Number(row.totalLineNum) : null,
        league: row.league || 'default',
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeWinOdds: row.homeWinOdds != null ? Number(row.homeWinOdds) : undefined,
        awayWinOdds: row.awayWinOdds != null ? Number(row.awayWinOdds) : undefined,
        historicalBaselineTotal: histBaseline?.avgTotal,
        historicalSampleSize: histBaseline?.sampleSize ?? 0,
        coreInjuriesHome,
        coreInjuriesAway,
        weightedInjuriesHome,
        weightedInjuriesAway,
        freshCoreInjuriesHome,
        freshCoreInjuriesAway,
        freshWeightedInjuriesHome,
        freshWeightedInjuriesAway,
        favoriteTeamSide,
        favoriteCoreInjuries,
        homeRecentForm: undefined,
        awayRecentForm: undefined,
        recent10HomePpg: homeRecent?.recent10Ppg,
        recent10AwayPpg: awayRecent?.recent10Ppg,
        recent10HomeOppg: homeRecent?.recent10Oppg,
        recent10AwayOppg: awayRecent?.recent10Oppg,
        recent20HomePpg: homeRecent?.recent20Ppg,
        recent20AwayPpg: awayRecent?.recent20Ppg,
        recent20HomeOppg: homeRecent?.recent20Oppg,
        recent20AwayOppg: awayRecent?.recent20Oppg,
        recent10HomePd: homeRecent?.recent10Pd,
        recent10AwayPd: awayRecent?.recent10Pd,
        recentSampleCount: homeRecent && awayRecent
          ? Math.min(homeRecent.sampleCount, awayRecent.sampleCount)
          : (homeRecent?.sampleCount ?? awayRecent?.sampleCount),
        h2hRecent: h2h?.recentPd ?? undefined,
        h2hHistorical: h2h?.historicalPd ?? undefined,
        h2hRecentCount: h2h?.recentCount,
        h2hHistoricalCount: h2h?.historicalCount,
      });
      if (anchorResult) {
        match.subModels = anchorResult.subModels;
        match.injuryAdjustApplied = anchorResult.injuryAdjustApplied;
        match.injuryAdjustPct = anchorResult.injuryAdjustPct;
      }
    }

    const injuryRows = await this.db
      .select({
        id: injuryReports.id,
        matchId: injuryReports.matchId,
        sport: injuryReports.sport,
        teamSide: injuryReports.teamSide,
        teamName: injuryReports.teamName,
        playerName: injuryReports.playerName,
        position: injuryReports.position,
        injuryType: injuryReports.injuryType,
        status: injuryReports.status,
        impactRating: injuryReports.impactRating,
        expectedReturn: injuryReports.expectedReturn,
        source: injuryReports.source,
        dataSource: injuryReports.dataSource,
        shortComment: injuryReports.shortComment,
        longComment: injuryReports.longComment,
        injuryDate: injuryReports.injuryDate,
      })
      .from(injuryReports)
      .where(eq(injuryReports.matchId, id))
      .orderBy(injuryReports.teamSide, injuryReports.impactRating, injuryReports.playerName);

    const injuryReportsList: InjuryReport[] = injuryRows.map((row) => ({
      id: row.id,
      matchId: row.matchId ?? undefined,
      sport: row.sport,
      teamSide: (row.teamSide as 'home' | 'away'),
      teamName: row.teamName,
      playerName: row.playerName,
      position: row.position ?? '',
      injuryType: row.injuryType ?? '',
      status: row.status,
      impactRating: (row.impactRating as 'high' | 'medium' | 'low'),
      expectedReturn: row.expectedReturn ?? '',
      source: row.source,
      dataSource: row.dataSource,
      shortComment: row.shortComment ?? '',
      longComment: row.longComment ?? '',
      injuryDate: row.injuryDate ? new Date(row.injuryDate).toISOString() : undefined,
    }));

    const injurySummary = {
      homeHigh: injuryReportsList.filter((r) => r.teamSide === 'home' && r.impactRating === 'high').length,
      homeMedium: injuryReportsList.filter((r) => r.teamSide === 'home' && r.impactRating === 'medium').length,
      awayHigh: injuryReportsList.filter((r) => r.teamSide === 'away' && r.impactRating === 'high').length,
      awayMedium: injuryReportsList.filter((r) => r.teamSide === 'away' && r.impactRating === 'medium').length,
    };

    return { match, injuryReports: injuryReportsList, injurySummary };
  }

  async getOddsTrend(matchId: string): Promise<OddsTrendResponse> {
    const matchRows = await this.db
      .select({ id: basketballMatches.id })
      .from(basketballMatches)
      .where(eq(basketballMatches.id, matchId))
      .limit(1);
    if (matchRows.length === 0) {
      throw new NotFoundException('比赛不存在');
    }

    const rows = await this.db
      .select()
      .from(basketballOddsSnapshots)
      .where(eq(basketballOddsSnapshots.matchId, matchId))
      .orderBy(asc(basketballOddsSnapshots.createdAt));

    const items: OddsTrendPoint[] = rows
      .map((row: typeof basketballOddsSnapshots.$inferSelect) => {
        const json = row.oddsJson as Record<string, unknown>;
        const point: OddsTrendPoint = {
          time: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          oddsType: row.oddsType as OddsTrendPoint['oddsType'],
          source: row.source ?? '',
        };
        if (json.home !== undefined && json.home !== null) point.home = Number(json.home);
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

  private calcDivergence(
    match: { handicapLineNum: number | null; handicapPick: string | null; totalDirection: string | null; predictionDirection: string | null },
    sources: MatchSourceOdds[],
  ): { status: 'consistent' | 'divergent' | 'unknown'; detail: DivergenceDetail | null } {
    const sourceCount = sources.length;

    const handicapStatus: 'consistent' | 'divergent' | 'unknown' = this.calcHandicapDivergence(match, sources);
    const totalStatus: 'consistent' | 'divergent' | 'unknown' = this.calcTotalDivergence(match, sources);
    const wdwStatus: 'consistent' | 'divergent' | 'unknown' = this.calcWdwDivergence(match, sources);

    if (sourceCount < 2) {
      return { status: 'unknown', detail: null };
    }

    const allUnknown = handicapStatus === 'unknown' && totalStatus === 'unknown' && wdwStatus === 'unknown';
    if (allUnknown) {
      return { status: 'unknown', detail: null };
    }

    const detail: DivergenceDetail = {
      handicap: handicapStatus,
      total: totalStatus,
      wdw: wdwStatus,
      sourceCount,
    };

    const anyDivergent = handicapStatus === 'divergent' || totalStatus === 'divergent' || wdwStatus === 'divergent';
    const allConsistent =
      (handicapStatus === 'consistent' || handicapStatus === 'unknown') &&
      (totalStatus === 'consistent' || totalStatus === 'unknown') &&
      (wdwStatus === 'consistent' || wdwStatus === 'unknown') &&
      (handicapStatus === 'consistent' || totalStatus === 'consistent' || wdwStatus === 'consistent');

    if (anyDivergent) {
      return { status: 'divergent', detail };
    }
    if (allConsistent) {
      return { status: 'consistent', detail };
    }
    return { status: 'unknown', detail: null };
  }

  private calcHandicapDivergence(
    match: { handicapPick: string | null },
    sources: MatchSourceOdds[],
  ): 'consistent' | 'divergent' | 'unknown' {
    const pick = match.handicapPick ?? '';
    if (!pick || pick.includes('观望')) return 'unknown';

    const validSources: MatchSourceOdds[] = sources.filter((s: MatchSourceOdds) => {
      const h = s.handicapOddsHome;
      const a = s.handicapOddsAway;
      return h != null && a != null && h > 0 && a > 0;
    });
    if (validSources.length < 2) return 'unknown';

    const modelFavorsHome = pick.includes('主胜');

    let divergentCount = 0;
    for (const source of validSources) {
      const h = source.handicapOddsHome as number;
      const a = source.handicapOddsAway as number;
      const marketFavorsHome = h < a;
      if (marketFavorsHome !== modelFavorsHome) {
        divergentCount += 1;
      }
    }

    return divergentCount > 0 ? 'divergent' : 'consistent';
  }

  private calcTotalDivergence(
    match: { totalDirection: string | null },
    sources: MatchSourceOdds[],
  ): 'consistent' | 'divergent' | 'unknown' {
    const dir = match.totalDirection ?? '';
    if (!dir || dir.includes('观望')) return 'unknown';

    const validSources: MatchSourceOdds[] = sources.filter((s: MatchSourceOdds) => {
      const o = s.totalOddsOver;
      const u = s.totalOddsUnder;
      return o != null && u != null && o > 0 && u > 0;
    });
    if (validSources.length < 2) return 'unknown';

    const modelFavorsOver = dir === '大' || dir === '大分';

    let divergentCount = 0;
    for (const source of validSources) {
      const o = source.totalOddsOver as number;
      const u = source.totalOddsUnder as number;
      const marketFavorsOver = o < u;
      if (marketFavorsOver !== modelFavorsOver) {
        divergentCount += 1;
      }
    }

    return divergentCount > 0 ? 'divergent' : 'consistent';
  }

  private calcWdwDivergence(
    match: { predictionDirection: string | null },
    sources: MatchSourceOdds[],
  ): 'consistent' | 'divergent' | 'unknown' {
    const dir = match.predictionDirection ?? '';
    if (!dir || dir.includes('观望')) return 'unknown';

    const validSources: MatchSourceOdds[] = sources.filter((s: MatchSourceOdds) => {
      const h = s.homeWinOdds;
      const a = s.awayWinOdds;
      return h != null && a != null && h > 0 && a > 0;
    });
    if (validSources.length < 2) return 'unknown';

    const modelFavorsHome = dir === '主胜';

    let divergentCount = 0;
    for (const source of validSources) {
      const h = source.homeWinOdds as number;
      const a = source.awayWinOdds as number;
      const marketFavorsHome = h < a;
      if (marketFavorsHome !== modelFavorsHome) {
        divergentCount += 1;
      }
    }

    return divergentCount > 0 ? 'divergent' : 'consistent';
  }

  async getMatchesWithDivergence(matchIds: string[]): Promise<Map<string, MatchSourceOdds[]>> {
    if (matchIds.length === 0) return new Map();

    const subQuery = this.db
      .select({
        matchId: basketballOddsSnapshots.matchId,
        source: basketballOddsSnapshots.source,
        oddsType: basketballOddsSnapshots.oddsType,
        oddsJson: basketballOddsSnapshots.oddsJson,
        createdAt: basketballOddsSnapshots.createdAt,
        rn: sql<number>`ROW_NUMBER() OVER (
          PARTITION BY ${basketballOddsSnapshots.matchId},
          ${basketballOddsSnapshots.source},
          ${basketballOddsSnapshots.oddsType}
          ORDER BY ${basketballOddsSnapshots.createdAt} DESC
        )`.as('rn'),
      })
      .from(basketballOddsSnapshots)
      .where(inArray(basketballOddsSnapshots.matchId, matchIds))
      .as('snap_ranked');

    const rowsResult = await this.db
      .select({
        matchId: subQuery.matchId,
        source: subQuery.source,
        oddsType: subQuery.oddsType,
        oddsJson: subQuery.oddsJson,
        createdAt: subQuery.createdAt,
      })
      .from(subQuery)
    const rows = await this.db
      .select({
        matchId: subQuery.matchId,
        source: subQuery.source,
        oddsType: subQuery.oddsType,
        oddsJson: subQuery.oddsJson,
        createdAt: subQuery.createdAt,
      })
      .from(subQuery)
      .where(eq(subQuery.rn, 1));

    const byMatch = new Map<string, Map<string, MatchSourceOdds>>();
    for (const row of rows) {
      const matchId = row.matchId;
      const source = row.source ?? 'unknown';
      if (!byMatch.has(matchId)) {
        byMatch.set(matchId, new Map());
      }
      const sourceMap = byMatch.get(matchId) as Map<string, MatchSourceOdds>;
      if (!sourceMap.has(source)) {
        sourceMap.set(source, {
          source,
          updatedAt: '',
        });
      }
      const item = sourceMap.get(source) as MatchSourceOdds;
      const j = row.oddsJson as Record<string, unknown>;
      if (row.oddsType === '1x2') {
        if (j.home !== undefined && j.home !== null) item.homeWinOdds = Number(j.home);
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
      const createdAtVal = row.createdAt;
      const createdIso = createdAtVal instanceof Date
        ? createdAtVal.toISOString()
        : String(createdAtVal);
      if (!item.updatedAt || createdIso > item.updatedAt) {
        item.updatedAt = createdIso;
      }
    }

    const result = new Map<string, MatchSourceOdds[]>();
    for (const [matchId, sourceMap] of byMatch.entries()) {
      result.set(matchId, Array.from(sourceMap.values()));
    }
    return result;
  }

  async getMultiSource(matchId: string): Promise<MatchMultiSourceResponse> {
    const matchRows = await this.db
      .select()
      .from(basketballMatches)
      .where(eq(basketballMatches.id, matchId))
      .limit(1);
    if (matchRows.length === 0) {
      throw new NotFoundException('比赛不存在');
    }
    const match = matchRows[0];

    const snapshotRows = await this.db
      .select()
      .from(basketballOddsSnapshots)
      .where(eq(basketballOddsSnapshots.matchId, matchId))
      .orderBy(desc(basketballOddsSnapshots.createdAt));

    const bySource = new Map<string, typeof basketballOddsSnapshots.$inferSelect[]>();
    for (const row of snapshotRows) {
      const key = row.source ?? 'unknown';
      const list = bySource.get(key) ?? [];
      list.push(row);
      bySource.set(key, list);
    }

    const sources: MatchSourceOdds[] = [];
    for (const [source, list] of bySource.entries()) {
      const latest = list[0];
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
      if (match.homeWinOdds != null) matchSourceItem.homeWinOdds = Number(match.homeWinOdds);
      if (match.awayWinOdds != null) matchSourceItem.awayWinOdds = Number(match.awayWinOdds);
      if (match.handicap != null) matchSourceItem.handicap = String(match.handicap);
      if (match.handicapOddsHome != null) matchSourceItem.handicapOddsHome = Number(match.handicapOddsHome);
      if (match.handicapOddsAway != null) matchSourceItem.handicapOddsAway = Number(match.handicapOddsAway);
      if (match.totalLine != null) matchSourceItem.overUnder = String(match.totalLine);
      if (match.totalOddsOver != null) matchSourceItem.totalOddsOver = Number(match.totalOddsOver);
      if (match.totalOddsUnder != null) matchSourceItem.totalOddsUnder = Number(match.totalOddsUnder);
      sources.unshift(matchSourceItem);
    }

    const divResult = this.calcDivergence(
      {
        handicapLineNum: match.handicapLineNum != null ? Number(match.handicapLineNum) : null,
        handicapPick: match.handicapPick ?? null,
        totalDirection: match.totalDirection ?? null,
        predictionDirection: match.predictionDirection ?? null,
      },
      sources,
    );

    return {
      matchId,
      sources,
      hasComparison: sources.length >= 2,
      divergenceStatus: divResult.status,
      divergenceDetail: divResult.detail,
    };
  }

  mapToItem(row: typeof basketballMatches.$inferSelect): BasketballMatchItem {
    const handicapNum = parseFloat(row.handicap);
    const handicapTeam = handicapNum < 0 ? row.homeTeam : row.awayTeam;

    let homeStats: BasketballMatchItem['homeStats'] = null;
    let awayStats: BasketballMatchItem['awayStats'] = null;
    let homeRadar: BasketballMatchItem['homeRadar'] = null;
    let awayRadar: BasketballMatchItem['awayRadar'] = null;
    let homeRecentForm: BasketballMatchItem['homeRecentForm'] = null;
    let awayRecentForm: BasketballMatchItem['awayRecentForm'] = null;
    let homeInjuries: BasketballMatchItem['homeInjuries'] = null;
    let awayInjuries: BasketballMatchItem['awayInjuries'] = null;
    let h2hHistory: BasketballMatchItem['h2hHistory'] = null;
    let homeTeamProfile: BasketballMatchItem['homeTeamProfile'] = null;
    let awayTeamProfile: BasketballMatchItem['awayTeamProfile'] = null;

    if (row.teamStats && typeof row.teamStats === 'object') {
      const ts = row.teamStats as Record<string, unknown>;
      homeStats = ts.home as BasketballMatchItem['homeStats'] || null;
      awayStats = ts.away as BasketballMatchItem['awayStats'] || null;
      homeTeamProfile = ts.home as BasketballMatchItem['homeTeamProfile'] || null;
      awayTeamProfile = ts.away as BasketballMatchItem['awayTeamProfile'] || null;
    }
    if (row.radarData && typeof row.radarData === 'object') {
      const rd = row.radarData as Record<string, unknown>;
      homeRadar = rd.home as BasketballMatchItem['homeRadar'] || null;
      awayRadar = rd.away as BasketballMatchItem['awayRadar'] || null;
    }
    if (row.recentForm && typeof row.recentForm === 'object') {
      const rf = row.recentForm as Record<string, unknown>;
      homeRecentForm = this.recentFormToString(rf.home);
      awayRecentForm = this.recentFormToString(rf.away);
    }
    if (row.injuries && typeof row.injuries === 'object') {
      const inj = row.injuries as Record<string, unknown>;
      homeInjuries = inj.home as BasketballMatchItem['homeInjuries'] || null;
      awayInjuries = inj.away as BasketballMatchItem['awayInjuries'] || null;
    }
    if (row.h2hHistory && Array.isArray(row.h2hHistory)) {
      h2hHistory = row.h2hHistory as BasketballMatchItem['h2hHistory'];
    }

    let homeKeyPlayers: BasketballMatchItem['homeKeyPlayers'] = null;
    let awayKeyPlayers: BasketballMatchItem['awayKeyPlayers'] = null;
    if (row.keyPlayers && typeof row.keyPlayers === 'object') {
      const kp = row.keyPlayers as Record<string, unknown>;
      homeKeyPlayers = kp.home as BasketballMatchItem['homeKeyPlayers'] || null;
      awayKeyPlayers = kp.away as BasketballMatchItem['awayKeyPlayers'] || null;
    }

    const handicapLineNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : parseFloat(row.handicap);
    const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : parseFloat(row.totalLine);

    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime instanceof Date ? row.kickoffTime.toISOString() : row.kickoffTime,
      matchDate: row.matchDate.toString(),
      businessDate: row.businessDate.toString(),
      venue: row.venue,
      source: row.source,
      sourceMatchId: row.sourceMatchId ?? undefined,
      homeWinProb: row.homeWinProb,
      awayWinProb: row.awayWinProb,
      predictionDirection: row.predictionDirection,
      handicap:
        row.handicapLineNum != null
          ? String(row.handicapLineNum)
          : row.handicap,
      handicapCoverProb: row.handicapCoverProb,
       handicapRecommendation: row.handicapRecommendation === '让分主负' ? '让分客胜' : row.handicapRecommendation,
       handicapPick: this.resolveHandicapPick(row),
       handicapPickProb: row.handicapPickProb ?? (this.resolveHandicapPick(row).includes('主胜') ? row.handicapCoverProb : row.handicapCoverProb != null ? 100 - row.handicapCoverProb : null),
      totalLine:
        row.totalLineNum != null && Number(row.totalLineNum) !== 0
          ? String(row.totalLineNum)
          : row.totalLine,
      overProb: row.overProb,
      underProb: row.underProb,
      totalDirection: row.totalDirection,
      totalPick: this.resolveTotalPick(row),
      totalPickProb: row.totalPickProb || (row.totalDirection === '大' || row.totalDirection === '大分' ? row.overProb : row.underProb),
      predictedHomeScore: row.predictedHomeScore,
      predictedAwayScore: row.predictedAwayScore,
      predictedTotal: row.predictedTotal != null ? Number(row.predictedTotal) : undefined,
      confidence: row.confidence,
      isModelAnalyzed: this.isMatchAnalyzed(row),
      wdwAnalyzed: this.isWdwAnalyzed(row),
      handicapAnalyzed: this.isHandicapAnalyzed(row),
      totalAnalyzed: this.isTotalAnalyzed(row),
      ouConfidence: row.ouConfidence as '高' | '中' | '低' | undefined,
      handicapConfidence: row.handicapConfidence as '高' | '中' | '低' | undefined,
      intel: row.intel,
      riskWarning: row.riskWarning,
      matchStatus: this.computeStatusFromTime(row, new Date()) as BasketballMatchItem['matchStatus'],
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      livePeriod: row.livePeriod ?? null,
      liveClock: row.liveClock ?? null,
      livePeriodEstimated: Boolean(row.livePeriodEstimated),
      liveScoreSource: row.liveScoreSource ?? '',
      lastScoreAt: row.lastScoreAt ? (row.lastScoreAt instanceof Date ? row.lastScoreAt.toISOString() : String(row.lastScoreAt)) : null,
      lastDataSyncAt: row.lastDataSyncAt
        ? row.lastDataSyncAt instanceof Date
          ? row.lastDataSyncAt.toISOString()
          : String(row.lastDataSyncAt)
        : null,
      hitWdw: row.hitWdw,
      hitHandicap: row.hitHandicap,
      hitOverunder: row.hitOverunder,
      isNeutral: row.isNeutral,
      category: row.category as 'official' | 'overseas' | 'wnba',
      handicapOddsHome: row.handicapOddsHome != null ? Number(row.handicapOddsHome) : null,
      handicapOddsAway: row.handicapOddsAway != null ? Number(row.handicapOddsAway) : null,
      totalOddsOver: row.totalOddsOver != null ? Number(row.totalOddsOver) : null,
      totalOddsUnder: row.totalOddsUnder != null ? Number(row.totalOddsUnder) : null,
      homeWinOdds: row.homeWinOdds != null ? Number(row.homeWinOdds) : null,
      awayWinOdds: row.awayWinOdds != null ? Number(row.awayWinOdds) : null,
      spreadProb1_5: row.spreadProb15,
      spreadProb6_10: row.spreadProb610,
      spreadProb11_15: row.spreadProb1115,
      spreadProb16_20: row.spreadProb1620,
      spreadProb21Plus: row.spreadProb21Plus,
      spreadTopRange: row.spreadTopRange || '6-10分',
      modelRules: row.modelRules || [],
      dataUpdatedAt: row.dataUpdatedAt instanceof Date ? row.dataUpdatedAt.toISOString() : String(row.dataUpdatedAt),
      predHtHome: row.predHtHome ?? 0,
      predHtAway: row.predHtAway ?? 0,
      intelSummary: row.intelSummary || '',
      upsetWarning: row.upsetWarning || '',
      homeKeyPlayers,
      awayKeyPlayers,
      handicapLineNum,
      totalLineNum,
      homeStats,
      awayStats,
      homeRadar,
      awayRadar,
       homeRecentForm,
       awayRecentForm,
       recentFormDetail: row.recentFormDetail as BasketballMatchItem['recentFormDetail'] ?? null,
      homeInjuries,
      awayInjuries,
      h2hHistory,
      homeTeamProfile,
      awayTeamProfile,
      teamNews: row.teamNews ?? '',
       injuries: this.normalizeToText(row.injuries),
       mediaConsensus: row.mediaConsensus ?? '',
       expertPicks: row.expertPicks ?? '',
       keyPlayers: this.normalizeToText(row.keyPlayers),
       predEngineVersion: row.predEngineVersion ?? undefined,
       predictionAnchor: (row.predictionAnchor as 'spread_anchored' | null) ?? null,
       subModels: Array.isArray(row.subModels) ? (row.subModels as BasketballSubModelRef[]) : [],
       injuryAdjustApplied: row.injuryAdjustApplied != null ? Number(row.injuryAdjustApplied) : 0,
       injuryAdjustPct: row.injuryAdjustPct ?? 0,
       injuryUpdatedAt: row.injuryUpdatedAt
         ? row.injuryUpdatedAt instanceof Date
           ? row.injuryUpdatedAt.toISOString()
           : String(row.injuryUpdatedAt)
         : undefined,
        advancedDataReady: row.advancedDataReady ?? false,
        advancedDataNotice: row.advancedDataNotice ?? '',
        wdwIsWait: (row.predictionDirection ?? '') === '观望' || (row.predictionDirection ?? '') === '待线值',
        handicapIsWait: (row.handicapRecommendation ?? '') === '观望' || (row.handicapPick ?? '') === '观望' || (row.handicapRecommendation ?? '') === '待线值' || (row.handicapPick ?? '') === '待线值',
        totalIsWait: (row.totalDirection ?? '') === '观望' || (row.totalPick ?? '') === '观望' || (row.totalDirection ?? '') === '待线值' || (row.totalPick ?? '') === '待线值',
        handicapPendingLine: (row.handicapRecommendation ?? '') === '待线值' || (row.handicapPick ?? '') === '待线值',
        totalPendingLine: (row.totalDirection ?? '') === '待线值' || (row.totalPick ?? '') === '待线值',
        starRating: this.computeStarRating(
          row.confidence ?? 0,
          this.isHandicapAnalyzed(row),
        ),
         intelUpdatedAt: row.intelUpdatedAt
          ? row.intelUpdatedAt instanceof Date
            ? row.intelUpdatedAt.toISOString()
            : String(row.intelUpdatedAt)
          : undefined,
         divergenceStatus: undefined,
         divergenceDetail: null,
       };
  }

  async getFinalCardByMatchNo(matchNo: string): Promise<BasketballFinalCard | null> {
    const rows = await this.db
      .select()
      .from(basketballMatches)
      .where(eq(basketballMatches.matchNo, matchNo))
      .orderBy(
        sql`CASE WHEN ${basketballMatches.isOfficialLocked} = true AND (${basketballMatches.league} LIKE '%NBA%' OR ${basketballMatches.league} LIKE '%美国职业%') THEN 0 WHEN ${basketballMatches.isOfficialLocked} = true THEN 1 ELSE 2 END`,
        sql`CASE WHEN ${basketballMatches.matchStatus} = 'upcoming' THEN 0 WHEN ${basketballMatches.matchStatus} = 'live' THEN 1 ELSE 2 END`,
        basketballMatches.kickoffTime,
      )
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];

    const handicapLine = row.handicapLineNum != null ? Number(row.handicapLineNum) : null;
    const totalLine = row.totalLineNum != null ? Number(row.totalLineNum) : null;

    let homePpg: number | null = null;
    let homeOppg: number | null = null;
    let awayPpg: number | null = null;
    let awayOppg: number | null = null;
    if (row.teamStats && typeof row.teamStats === 'object') {
      const ts = row.teamStats as Record<string, unknown>;
      const home = ts.home as Record<string, unknown> | undefined;
      const away = ts.away as Record<string, unknown> | undefined;
      if (home) {
        const hPpgRaw = home.pointsPerGame ?? home.ppg;
        if (hPpgRaw !== undefined && hPpgRaw !== null && hPpgRaw !== '') {
          const n = Number(hPpgRaw);
          if (!Number.isNaN(n) && n > 0) homePpg = n;
        }
        const hOppgRaw = home.oppg ?? home.opponentsPointsPerGame ?? home.pointsAllowedPerGame;
        if (hOppgRaw !== undefined && hOppgRaw !== null && hOppgRaw !== '') {
          const n = Number(hOppgRaw);
          if (!Number.isNaN(n) && n > 0) homeOppg = n;
        }
      }
      if (away) {
        const aPpgRaw = away.pointsPerGame ?? away.ppg;
        if (aPpgRaw !== undefined && aPpgRaw !== null && aPpgRaw !== '') {
          const n = Number(aPpgRaw);
          if (!Number.isNaN(n) && n > 0) awayPpg = n;
        }
        const aOppgRaw = away.oppg ?? away.opponentsPointsPerGame ?? away.pointsAllowedPerGame;
        if (aOppgRaw !== undefined && aOppgRaw !== null && aOppgRaw !== '') {
          const n = Number(aOppgRaw);
          if (!Number.isNaN(n) && n > 0) awayOppg = n;
        }
      }
    }

    if (homeOppg == null || awayOppg == null || homePpg == null || awayPpg == null) {
      const [homeRows, awayRows] = await Promise.all([
        this.db
          .select({
            teamName: teamSeasonStats.teamName,
            ppg: teamSeasonStats.ppg,
            oppg: teamSeasonStats.oppg,
          })
          .from(teamSeasonStats)
          .where(and(
            eq(teamSeasonStats.sport, 'basketball'),
            eq(teamSeasonStats.season, '2024-25'),
            ilike(teamSeasonStats.teamName, `%${row.homeTeam ?? ''}%`),
          ))
          .limit(1),
        this.db
          .select({
            teamName: teamSeasonStats.teamName,
            ppg: teamSeasonStats.ppg,
            oppg: teamSeasonStats.oppg,
          })
          .from(teamSeasonStats)
          .where(and(
            eq(teamSeasonStats.sport, 'basketball'),
            eq(teamSeasonStats.season, '2024-25'),
            ilike(teamSeasonStats.teamName, `%${row.awayTeam ?? ''}%`),
          ))
          .limit(1),
      ]);
      const homeSeason = homeRows[0];
      const awaySeason = awayRows[0];
      if (homeSeason) {
        const hp = Number(homeSeason.ppg);
        const ho = Number(homeSeason.oppg);
        if (hp > 0 && homePpg == null) homePpg = hp;
        if (ho > 0 && homeOppg == null) homeOppg = ho;
      }
      if (awaySeason) {
        const ap = Number(awaySeason.ppg);
        const ao = Number(awaySeason.oppg);
        if (ap > 0 && awayPpg == null) awayPpg = ap;
        if (ao > 0 && awayOppg == null) awayOppg = ao;
      }
    }

    let recentFormHome: string[] | null = null;
    let recentFormAway: string[] | null = null;
    if (row.recentForm && typeof row.recentForm === 'object') {
      const rf = row.recentForm as Record<string, unknown>;
      recentFormHome = this.extractRecentFormArray(rf.home);
      recentFormAway = this.extractRecentFormArray(rf.away);
    }

    const injuriesHome: Array<{ name: string; position?: string; status?: string }> = [];
    const injuriesAway: Array<{ name: string; position?: string; status?: string }> = [];
    let injuriesSource = 'unknown';
    if (row.injuries && typeof row.injuries === 'object') {
      const inj = row.injuries as Record<string, unknown>;
      const homeList = Array.isArray(inj.home) ? (inj.home as Array<Record<string, unknown>>) : [];
      const awayList = Array.isArray(inj.away) ? (inj.away as Array<Record<string, unknown>>) : [];
      for (const p of homeList) {
        const pName = String(p.playerName ?? p.name ?? '');
        injuriesHome.push({
          name: pName,
          position: p.position ? String(p.position) : undefined,
          status: p.status ? String(p.status) : undefined,
        });
      }
      for (const p of awayList) {
        const pName = String(p.playerName ?? p.name ?? '');
        injuriesAway.push({
          name: pName,
          position: p.position ? String(p.position) : undefined,
          status: p.status ? String(p.status) : undefined,
        });
      }
      if (inj.source) injuriesSource = String(inj.source);
    }

    let confidenceLabel: string | null = null;
    if (row.confidence != null) {
      if (row.confidence >= 65) confidenceLabel = 'high';
      else if (row.confidence >= 58) confidenceLabel = 'medium';
      else confidenceLabel = 'low';
    }

    return {
      matchNo: row.matchNo,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime instanceof Date ? row.kickoffTime.toISOString() : String(row.kickoffTime),
      league: row.league ?? '',
      officialLines: {
        handicapLine,
        totalLine,
        isLocked: !!row.isOfficialLocked,
      },
      injuries: {
        home: injuriesHome,
        away: injuriesAway,
        source: injuriesSource,
      },
      efficiencyBaseline: {
        homePpg,
        homeOppg,
        awayPpg,
        awayOppg,
        recentFormHome,
        recentFormAway,
      },
      predictions: {
        wdwDirection: row.predictionDirection ?? null,
        wdwHomeProb: row.homeWinProb ?? null,
        wdwAwayProb: row.awayWinProb ?? null,
        handicapDirection: row.handicapRecommendation ?? null,
        handicapLine,
        handicapProb: row.handicapCoverProb ?? null,
        totalDirection: row.totalDirection ?? null,
        totalLine,
        overProb: row.overProb ?? null,
        underProb: row.underProb ?? null,
        predictedTotal: row.predictedTotal != null ? Number(row.predictedTotal) : null,
        diffVsLine: row.ouDiffVsLine != null ? Number(row.ouDiffVsLine) : null,
        confidence: confidenceLabel,
        engineVersion: row.predEngineVersion ?? null,
      },
    };
  }

  /**
   * Lean list-item mapper — returns only fields used by the list card.
   * Cuts 15+ detail-only fields (teamStats, radarData, h2hHistory, teamProfile,
   * keyPlayers arrays, recentForm, etc.) from each row to reduce JSON payload size.
   */
  mapToListItem(row: Partial<typeof basketballMatches.$inferSelect> & {
    id: string;
    matchNo: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    kickoffTime: Date | string;
    matchDate: string | Date;
    businessDate: string | Date;
    venue: string | null;
    source: string | null;
    sourceMatchId: string | null;
    homeWinProb: number | null;
    awayWinProb: number | null;
    predictionDirection: string | null;
    handicapLineNum: number | null;
    handicapPick: string | null;
    handicapPickProb: number | null;
    handicapCoverProb: number | null;
    handicapRecommendation: string | null;
    totalLineNum: number | null;
    totalPick: string | null;
    totalPickProb: number | null;
    overProb: number | null;
    underProb: number | null;
    totalDirection: string | null;
    predictedHomeScore: number | null;
    predictedAwayScore: number | null;
    predictedTotal: number | null;
    confidence: number | null;
    matchStatus: string;
    homeScore: number | null;
    awayScore: number | null;
    livePeriod: number | null;
    liveClock: string | null;
    livePeriodEstimated: boolean;
    liveScoreSource: string | null;
    lastScoreAt: Date | string | null;
    lastDataSyncAt: Date | string | null;
    hitWdw: boolean | null;
    hitHandicap: boolean | null;
    hitOverunder: boolean | null;
    isNeutral: boolean | null;
    category: string | null;
    handicapOddsHome: number | null;
    handicapOddsAway: number | null;
    totalOddsOver: number | null;
    totalOddsUnder: number | null;
    homeWinOdds: number | null;
    awayWinOdds: number | null;
    spreadProb15: number | null;
    spreadProb610: number | null;
    spreadProb1115: number | null;
    spreadProb1620: number | null;
    spreadProb21Plus: number | null;
    spreadTopRange: string | null;
    intelSummary: string | null;
    riskWarning: string | null;
    modelRules: string[] | null;
    handicap: string | null;
    totalLine: string | null;
    ouConfidence: string | null;
    dataUpdatedAt: Date | string | null;
    predHtHome: number | null;
    predHtAway: number | null;
    upsetWarning: string | null;
    teamNews: string | null;
    injuries: unknown;
    mediaConsensus: string | null;
    expertPicks: string | null;
      keyPlayers: unknown;
      oddsMovements: unknown;
      predEngineVersion: string | null;
    }): BasketballMatchItem {
    const handicapLineNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : parseFloat(row.handicap || '0');
    const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : parseFloat(row.totalLine || '0');

    let homeInjuries: BasketballMatchItem['homeInjuries'] = null;
    let awayInjuries: BasketballMatchItem['awayInjuries'] = null;
    if (row.injuries && typeof row.injuries === 'object') {
      const inj = row.injuries as Record<string, unknown>;
      homeInjuries = inj.home as BasketballMatchItem['homeInjuries'] || null;
      awayInjuries = inj.away as BasketballMatchItem['awayInjuries'] || null;
    }

    return {
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime instanceof Date ? row.kickoffTime.toISOString() : row.kickoffTime,
      matchDate: row.matchDate.toString(),
      businessDate: row.businessDate.toString(),
      venue: row.venue ?? '',
      source: row.source ?? undefined,
      sourceMatchId: row.sourceMatchId ?? undefined,
      homeWinProb: row.homeWinProb ?? 0,
      awayWinProb: row.awayWinProb ?? 0,
      predictionDirection: row.predictionDirection ?? '',
      handicap:
        row.handicapLineNum != null
          ? String(row.handicapLineNum)
          : row.handicap ?? '',
      handicapCoverProb: row.handicapCoverProb ?? 0,
      handicapRecommendation: (row.handicapRecommendation === '让分主负' ? '让分客胜' : (row.handicapRecommendation ?? '')),
      handicapPick: this.resolveHandicapPick(row as typeof basketballMatches.$inferSelect),
      handicapPickProb: row.handicapPickProb ?? (this.resolveHandicapPick(row as typeof basketballMatches.$inferSelect).includes('主胜') ? row.handicapCoverProb ?? 0 : row.handicapCoverProb != null ? 100 - row.handicapCoverProb : 0),
      totalLine:
        row.totalLineNum != null && Number(row.totalLineNum) !== 0
          ? String(row.totalLineNum)
          : row.totalLine ?? '',
      overProb: row.overProb ?? 0,
      underProb: row.underProb ?? 0,
      totalDirection: row.totalDirection ?? '',
      totalPick: this.resolveTotalPick(row as typeof basketballMatches.$inferSelect),
      totalPickProb: row.totalPickProb ?? (row.totalDirection === '大' || row.totalDirection === '大分' ? row.overProb : row.underProb) ?? 0,
      predictedHomeScore: row.predictedHomeScore ?? 0,
      predictedAwayScore: row.predictedAwayScore ?? 0,
      predictedTotal: row.predictedTotal != null ? Number(row.predictedTotal) : undefined,
      confidence: row.confidence ?? 0,
      isModelAnalyzed: this.isMatchAnalyzed(row as typeof basketballMatches.$inferSelect),
      wdwAnalyzed: this.isWdwAnalyzed(row as typeof basketballMatches.$inferSelect),
      handicapAnalyzed: this.isHandicapAnalyzed(row as typeof basketballMatches.$inferSelect),
      totalAnalyzed: this.isTotalAnalyzed(row as typeof basketballMatches.$inferSelect),
      ouConfidence: row.ouConfidence as '高' | '中' | '低' | undefined,
      handicapConfidence: row.handicapConfidence as '高' | '中' | '低' | undefined,
      intel: '',
      riskWarning: row.riskWarning ?? '',
      matchStatus: this.computeStatusFromTime(row as typeof basketballMatches.$inferSelect, new Date()) as BasketballMatchItem['matchStatus'],
      homeScore: row.homeScore ?? null,
      awayScore: row.awayScore ?? null,
      livePeriod: row.livePeriod ?? null,
      liveClock: row.liveClock ?? null,
      livePeriodEstimated: Boolean(row.livePeriodEstimated),
      liveScoreSource: row.liveScoreSource ?? '',
      lastScoreAt: row.lastScoreAt ? (row.lastScoreAt instanceof Date ? row.lastScoreAt.toISOString() : String(row.lastScoreAt)) : null,
      lastDataSyncAt: row.lastDataSyncAt
        ? row.lastDataSyncAt instanceof Date
          ? row.lastDataSyncAt.toISOString()
          : String(row.lastDataSyncAt)
        : null,
      hitWdw: row.hitWdw ?? null,
      hitHandicap: row.hitHandicap ?? null,
      hitOverunder: row.hitOverunder ?? null,
      isNeutral: row.isNeutral ?? false,
      category: (row.category as 'official' | 'overseas' | 'wnba') ?? 'official',
      handicapOddsHome: row.handicapOddsHome != null ? Number(row.handicapOddsHome) : null,
      handicapOddsAway: row.handicapOddsAway != null ? Number(row.handicapOddsAway) : null,
      totalOddsOver: row.totalOddsOver != null ? Number(row.totalOddsOver) : null,
      totalOddsUnder: row.totalOddsUnder != null ? Number(row.totalOddsUnder) : null,
      homeWinOdds: row.homeWinOdds != null ? Number(row.homeWinOdds) : null,
      awayWinOdds: row.awayWinOdds != null ? Number(row.awayWinOdds) : null,
      spreadProb1_5: row.spreadProb15 ?? 0,
      spreadProb6_10: row.spreadProb610 ?? 0,
      spreadProb11_15: row.spreadProb1115 ?? 0,
      spreadProb16_20: row.spreadProb1620 ?? 0,
      spreadProb21Plus: row.spreadProb21Plus ?? 0,
      spreadTopRange: row.spreadTopRange ?? '6-10分',
      modelRules: row.modelRules ?? [],
      lastOddsUpdateAt: undefined,
      homeStats: null,
      awayStats: null,
      homeRadar: null,
      awayRadar: null,
      homeRecentForm: null,
      awayRecentForm: null,
      homeInjuries,
      awayInjuries,
      h2hHistory: null,
      homeTeamProfile: null,
      awayTeamProfile: null,
      predHtHome: row.predHtHome ?? 0,
      predHtAway: row.predHtAway ?? 0,
      intelSummary: row.intelSummary ?? '',
      upsetWarning: row.upsetWarning ?? '',
      handicapLineNum,
      totalLineNum,
      teamNews: '',
      injuries: '',
      mediaConsensus: '',
      expertPicks: '',
      keyPlayers: '',
      intelUpdatedAt: undefined,
      predEngineVersion: row.predEngineVersion ?? undefined,
      predictionAnchor: null,
      subModels: [],
      injuryAdjustApplied: 0,
      injuryAdjustPct: 0,
      injuryUpdatedAt: undefined,
      advancedDataReady: false,
      advancedDataNotice: '',
      wdwIsWait: (row.predictionDirection ?? '') === '观望' || (row.predictionDirection ?? '') === '待线值',
      handicapIsWait: (row.handicapRecommendation ?? '') === '观望' || (row.handicapPick ?? '') === '观望' || (row.handicapRecommendation ?? '') === '待线值' || (row.handicapPick ?? '') === '待线值',
      totalIsWait: (row.totalDirection ?? '') === '观望' || (row.totalPick ?? '') === '观望' || (row.totalDirection ?? '') === '待线值' || (row.totalPick ?? '') === '待线值',
      handicapPendingLine: (row.handicapRecommendation ?? '') === '待线值' || (row.handicapPick ?? '') === '待线值',
      totalPendingLine: (row.totalDirection ?? '') === '待线值' || (row.totalPick ?? '') === '待线值',
      homeKeyPlayers: null,
      awayKeyPlayers: null,
      isFavorited: undefined,
      dataUpdatedAt: row.dataUpdatedAt ? (row.dataUpdatedAt instanceof Date ? row.dataUpdatedAt.toISOString() : String(row.dataUpdatedAt)) : '',
      starRating: this.computeStarRating(
        row.confidence ?? 0,
        this.isHandicapAnalyzed(row as typeof basketballMatches.$inferSelect),
      ),
      divergenceStatus: undefined,
      divergenceDetail: null,
      oddsMovements: Array.isArray(row.oddsMovements) ? (row.oddsMovements as Array<{ time: string; type: string; oldValue: string; newValue: string }>) : null,
    };
  }

  private computeStatusFromTime(
    row: typeof basketballMatches.$inferSelect,
    now: Date,
  ): string {
    if (row.matchStatus === 'finished' && row.homeScore != null) {
      return 'finished';
    }
    const hasLiveSource = !!row.liveScoreSource && row.liveScoreSource !== '';
    if (hasLiveSource) {
      return row.matchStatus || 'upcoming';
    }
    const kickoffMs =
      row.kickoffTime instanceof Date
        ? row.kickoffTime.getTime()
        : new Date(row.kickoffTime).getTime();
    const oneFiftyMinutesMs = 150 * 60 * 1000;
    if (
      now.getTime() >= kickoffMs + oneFiftyMinutesMs &&
      row.homeScore == null
    ) {
      return 'finished_pending';
    }
    if (now.getTime() >= kickoffMs) {
      return 'live';
    }
    return row.matchStatus || 'upcoming';
  }

  private recentFormToString(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      return value.trim() || null;
    }
    if (Array.isArray(value)) {
      const str = value.map((v) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') {
          const r = v as Record<string, unknown>;
          if (typeof r.result === 'string') return r.result;
          if (typeof r.score === 'string') return r.score;
        }
        return '';
      }).filter(Boolean).join('');
      return str || null;
    }
    return null;
  }

  private extractRecentFormArray(value: unknown): string[] | null {
    if (value == null) return null;
    if (Array.isArray(value)) {
      const results: string[] = [];
      for (const v of value) {
        if (typeof v === 'string' && v.trim()) {
          results.push(v.trim());
        } else if (v && typeof v === 'object') {
          const r = v as Record<string, unknown>;
          if (typeof r.result === 'string' && r.result.trim()) results.push(r.result.trim());
          else if (typeof r.score === 'string' && r.score.trim()) results.push(r.score.trim());
        }
      }
      return results.length > 0 ? results : null;
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim().split(/\s+/);
    }
    return null;
  }

  private normalizeToText(value: unknown): string {
     if (value == null) return '';
     if (typeof value === 'string') return value;
     try {
       return JSON.stringify(value);
     } catch {
       return String(value);
     }
   }

  async getPredictionAccuracy(days: number): Promise<PredictionAccuracyResponse> {
    const now = new Date();
    const startDate = new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000);
    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateStr = now.toISOString().slice(0, 10);
    const endPlusOne = this.getNextDate(endDateStr);

    const [overviewRow] = await this.db
      .select({
        totalFinished: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished')`,
        directionalCount: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.predictionDirection} in ('主胜', '客胜'))`,
        wdwHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.predictionDirection} in ('主胜', '客胜') and ${basketballMatches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.predictionDirection} in ('主胜', '客胜') and ${basketballMatches.hitWdw} is not null)`,
        hcHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.handicapRecommendation} is not null and ${basketballMatches.handicapRecommendation} <> '' and ${basketballMatches.handicapRecommendation} not like '%观望%' and ${basketballMatches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.handicapRecommendation} is not null and ${basketballMatches.handicapRecommendation} <> '' and ${basketballMatches.handicapRecommendation} not like '%观望%' and ${basketballMatches.hitHandicap} is not null)`,
        ouHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分') and ${basketballMatches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分') and ${basketballMatches.hitOverunder} is not null)`,
      })
      .from(basketballMatches)
      .where(and(
        gte(basketballMatches.matchDate, startDateStr),
        lt(basketballMatches.matchDate, endPlusOne),
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
        date: basketballMatches.matchDate,
        wdwHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.predictionDirection} in ('主胜', '客胜') and ${basketballMatches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.predictionDirection} in ('主胜', '客胜') and ${basketballMatches.hitWdw} is not null)`,
        hcHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.handicapRecommendation} is not null and ${basketballMatches.handicapRecommendation} <> '' and ${basketballMatches.handicapRecommendation} not like '%观望%' and ${basketballMatches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.handicapRecommendation} is not null and ${basketballMatches.handicapRecommendation} <> '' and ${basketballMatches.handicapRecommendation} not like '%观望%' and ${basketballMatches.hitHandicap} is not null)`,
        ouHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分') and ${basketballMatches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.totalPick} in ('大', '小', '大球', '小球', '大分', '小分') and ${basketballMatches.hitOverunder} is not null)`,
      })
      .from(basketballMatches)
      .where(and(
        gte(basketballMatches.matchDate, startDateStr),
        lt(basketballMatches.matchDate, endPlusOne),
      ))
      .groupBy(basketballMatches.matchDate)
      .orderBy(asc(basketballMatches.matchDate));

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

   async getStats(): Promise<BasketballStatsResponse> {
    // ===== Overview counts (all matches, all finished) =====
    const [countRow] = await this.db
      .select({
        total: sql<number>`count(*)`,
        finished: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished')`,
        wdwHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitWdw} is not null)`,
        hcHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitHandicap} is not null)`,
        ouHits: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${basketballMatches.matchStatus} = 'finished' and ${basketballMatches.hitOverunder} is not null)`,
      })
      .from(basketballMatches);

    const totalMatches = Number(countRow.total);
    const finishedMatches = Number(countRow.finished);
    const wdwHits = Number(countRow.wdwHits);
    const wdwTotal = Number(countRow.wdwTotal);
    const hcHits = Number(countRow.hcHits);
    const hcTotal = Number(countRow.hcTotal);
    const ouHits = Number(countRow.ouHits);
    const ouTotal = Number(countRow.ouTotal);

    // ===== byLeague =====
    const leagueRows = await this.db
      .select({
        league: basketballMatches.league,
        total: sql<number>`count(*)`,
        wdw: sql<number>`count(*) filter (where ${basketballMatches.hitWdw} = true)`,
        wdwTotal: sql<number>`count(*) filter (where ${basketballMatches.hitWdw} is not null)`,
        hc: sql<number>`count(*) filter (where ${basketballMatches.hitHandicap} = true)`,
        hcTotal: sql<number>`count(*) filter (where ${basketballMatches.hitHandicap} is not null)`,
        ou: sql<number>`count(*) filter (where ${basketballMatches.hitOverunder} = true)`,
        ouTotal: sql<number>`count(*) filter (where ${basketballMatches.hitOverunder} is not null)`,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.matchStatus, 'finished'))
      .groupBy(basketballMatches.league)
        .orderBy(desc(sql`count(*) filter (where ${basketballMatches.hitWdw} is not null)`));

      const byLeague = leagueRows.map((row) => {
      const t = Number(row.wdwTotal);
      return {
        league: row.league,
        total: t,
        wdwHitRate: t > 0 ? Number(row.wdw) / t : 0,
        handicapHitRate: Number(row.hcTotal) > 0 ? Number(row.hc) / Number(row.hcTotal) : 0,
        overUnderHitRate: Number(row.ouTotal) > 0 ? Number(row.ou) / Number(row.ouTotal) : 0,
      };
    });

    // ===== bySpreadRange: handicap depth (handicap hit rate) =====
    // 安全转换：仅匹配数值格式才转numeric，否则归为"无指数线"组，避免 22P02
    const spreadRows = await this.db
      .select({
        range: sql<string>`case
          when ${basketballMatches.handicap} ~ '^-?[0-9]+(\.[0-9]+)?$' and abs(${basketballMatches.handicap}::numeric) < 5 then '浅盘(<5分)'
          when ${basketballMatches.handicap} ~ '^-?[0-9]+(\.[0-9]+)?$' and abs(${basketballMatches.handicap}::numeric) <= 10 then '中盘(5-10分)'
          when ${basketballMatches.handicap} ~ '^-?[0-9]+(\.[0-9]+)?$' then '深盘(>10分)'
          else '无指数线'
        end`,
        total: sql<number>`count(*) filter (where ${basketballMatches.hitHandicap} is not null)`,
        hits: sql<number>`count(*) filter (where ${basketballMatches.hitHandicap} = true)`,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.matchStatus, 'finished'))
      .groupBy(sql`case
          when ${basketballMatches.handicap} ~ '^-?[0-9]+(\.[0-9]+)?$' and abs(${basketballMatches.handicap}::numeric) < 5 then '浅盘(<5分)'
          when ${basketballMatches.handicap} ~ '^-?[0-9]+(\.[0-9]+)?$' and abs(${basketballMatches.handicap}::numeric) <= 10 then '中盘(5-10分)'
          when ${basketballMatches.handicap} ~ '^-?[0-9]+(\.[0-9]+)?$' then '深盘(>10分)'
          else '无指数线'
        end`);

    const spreadOrder = ['浅盘(<5分)', '中盘(5-10分)', '深盘(>10分)', '无指数线'];
    const spreadMap = new Map<string, { total: number; hits: number }>();
    for (const r of spreadRows) {
      spreadMap.set(r.range, { total: Number(r.total), hits: Number(r.hits) });
    }
    const bySpreadRange = spreadOrder.map((range) => {
      const r = spreadMap.get(range) ?? { total: 0, hits: 0 };
      return {
        range,
        total: r.total,
        hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 1000 : 0,
      };
    });

    // ===== byConfidence: wdw hit rate =====
    const confRows = await this.db
      .select({
        level: sql<string>`case
          when ${basketballMatches.confidence} >= 65 then '高(≥65%)'
          when ${basketballMatches.confidence} >= 58 then '中(58-65%)'
          else '低(<58%)'
        end`,
        total: sql<number>`count(*) filter (where ${basketballMatches.hitWdw} is not null)`,
        hits: sql<number>`count(*) filter (where ${basketballMatches.hitWdw} = true)`,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.matchStatus, 'finished'))
         .groupBy(sql`case
           when ${basketballMatches.confidence} >= 65 then '高(≥65%)'
           when ${basketballMatches.confidence} >= 58 then '中(58-65%)'
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
        total: r.total,
        hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 1000 : 0,
      };
    });

    // ===== recentHits: last 10 finished matches =====
    const recentRows = await this.db
      .select()
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.matchStatus, 'finished'),
        inArray(basketballMatches.predictionDirection, ['主胜', '客胜']),
      ))
      .orderBy(desc(basketballMatches.kickoffTime))
      .limit(10);

    const recentHits = recentRows.map((r) => ({
      id: r.id,
      matchNo: r.matchNo,
      league: r.league,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      homeScore: r.homeScore ?? 0,
      awayScore: r.awayScore ?? 0,
      predictionDirection: r.predictionDirection,
      handicapPick: this.resolveHandicapPick(r),
      totalPick: this.resolveTotalPick(r),
      hitWdw: r.hitWdw === true,
      hitHandicap: r.hitHandicap === true,
      hitOverunder: r.hitOverunder === true,
      matchDate: r.matchDate.toString(),
    }));

    return {
      overview: {
        totalWdw: wdwTotal,
        totalHandicap: hcTotal,
        totalOverUnder: ouTotal,
        wdwHitRate: wdwTotal > 0 ? wdwHits / wdwTotal : 0,
        handicapHitRate: hcTotal > 0 ? hcHits / hcTotal : 0,
        overUnderHitRate: ouTotal > 0 ? ouHits / ouTotal : 0,
        totalMatches,
        finishedMatches,
      },
      byLeague,
      bySpreadRange,
      byConfidence,
      recentHits,
    };
  }

  async getBacktest(params?: { startDate?: string; endDate?: string; days?: number }): Promise<BasketballBacktestResponse> {
    const { start, end, days } = this.resolveBacktestRange(params);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        league: basketballMatches.league,
        predictionDirection: basketballMatches.predictionDirection,
        confidence: basketballMatches.confidence,
        handicapLineNum: basketballMatches.handicapLineNum,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        hitWdw: basketballMatches.hitWdw,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
        kickoffTime: basketballMatches.kickoffTime,
        injuries: basketballMatches.injuries,
        totalDirection: basketballMatches.totalDirection,
        totalPick: basketballMatches.totalPick,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapPick: basketballMatches.handicapPick,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'finished'),
          gte(basketballMatches.matchDate, startStr),
          lte(basketballMatches.matchDate, endStr),
          isNotNull(basketballMatches.predictionDirection),
          ne(basketballMatches.predictionDirection, '观望'),
        ),
      );

    const emptyResult: BasketballBacktestResponse = {
      hasData: false,
      totalSamples: 0,
      dateRange: { start: startStr, end: endStr, days },
      byLeague: [],
      byConfidence: [],
      byDepth: [],
      byInjury: [],
      byMonth: [],
      detailList: [],
    };

    if (rows.length === 0) return emptyResult;

    const totalSamples = rows.length;

    // --- byLeague ---
    type LeagueStat = {
      samples: number;
      wdwHit: number;
      wdwTotal: number;
      hcHit: number;
      hcTotal: number;
      ouHit: number;
      ouTotal: number;
    };
    const leagueMap = new Map<string, LeagueStat>();
    for (const row of rows) {
      const cur: LeagueStat = leagueMap.get(row.league) ?? { samples: 0, wdwHit: 0, wdwTotal: 0, hcHit: 0, hcTotal: 0, ouHit: 0, ouTotal: 0 };
      cur.samples += 1;
      const dir = row.predictionDirection ?? '';
      if (dir === '主胜' || dir === '客胜') {
        cur.wdwTotal += 1;
        if (row.hitWdw === true) cur.wdwHit += 1;
      }
      if (row.hitHandicap !== null && row.hitHandicap !== undefined) {
        cur.hcTotal += 1;
        if (row.hitHandicap === true) cur.hcHit += 1;
      }
      if (row.hitOverunder !== null && row.hitOverunder !== undefined) {
        cur.ouTotal += 1;
        if (row.hitOverunder === true) cur.ouHit += 1;
      }
      leagueMap.set(row.league, cur);
    }
    const byLeague = Array.from(leagueMap.entries())
      .sort((a, b) => b[1].samples - a[1].samples)
      .map(([league, s]) => ({
        league,
        samples: s.samples,
        wdw: s.wdwTotal > 0 ? Number((s.wdwHit / s.wdwTotal).toFixed(4)) : 0,
        handicap: s.hcTotal > 0 ? Number((s.hcHit / s.hcTotal).toFixed(4)) : 0,
        overUnder: s.ouTotal > 0 ? Number((s.ouHit / s.ouTotal).toFixed(4)) : 0,
      }));

    // --- byConfidence (胜负命中率) ---
    const confTiers = [
      { label: '高(≥65%)', min: 65, max: 101 },
      { label: '中(58-65%)', min: 58, max: 65 },
      { label: '低(<58%)', min: 0, max: 58 },
    ];
    const byConfidence = confTiers.map((tier) => {
      const tierRows = rows.filter((r) => r.confidence >= tier.min && r.confidence < tier.max);
      const wdwRows = tierRows.filter((r) => (r.predictionDirection ?? '') === '主胜' || (r.predictionDirection ?? '') === '客胜');
      const hits = wdwRows.filter((r) => r.hitWdw === true).length;
      return {
        level: tier.label,
        hitRate: wdwRows.length > 0 ? Number((hits / wdwRows.length).toFixed(4)) : 0,
        samples: tierRows.length,
      };
    });

    // --- byDepth (让分命中率) ---
    const depthTiers = [
      { label: '浅盘(≤3)', min: 0, max: 3.5 },
      { label: '中盘(3.5-6)', min: 3.5, max: 6.5 },
      { label: '深盘(6.5-10.5)', min: 6.5, max: 11 },
      { label: '超深盘(≥11)', min: 11, max: 999 },
    ];
    const byDepth = depthTiers.map((tier) => {
      const depthRows = rows.filter((r) => {
        if (r.handicapLineNum === null || r.handicapLineNum === undefined) return false;
        const absLine = Math.abs(Number(r.handicapLineNum));
        return absLine >= tier.min && absLine < tier.max;
      });
      const validHc = depthRows.filter((r) => r.hitHandicap !== null && r.hitHandicap !== undefined);
      const hits = validHc.filter((r) => r.hitHandicap === true).length;
      return {
        depth: tier.label,
        hitRate: validHc.length > 0 ? Number((hits / validHc.length).toFixed(4)) : 0,
        samples: depthRows.length,
      };
    });

    // --- byInjury (用 injuries jsonb 是否非空判断) ---
    const injuryLabelYes = '有核心缺阵';
    const injuryLabelNo = '无';
    type InjuryStat = { samples: number; overPickTotal: number; overPickHit: number; totalPoints: number; scoredMatches: number };
    const injuryMap = new Map<string, InjuryStat>([
      [injuryLabelYes, { samples: 0, overPickTotal: 0, overPickHit: 0, totalPoints: 0, scoredMatches: 0 }],
      [injuryLabelNo, { samples: 0, overPickTotal: 0, overPickHit: 0, totalPoints: 0, scoredMatches: 0 }],
    ]);
    for (const row of rows) {
      const inj = row.injuries;
      let hasInjury = false;
      if (inj !== null && inj !== undefined) {
        const injStr = JSON.stringify(inj);
        if (injStr !== '{}' && injStr !== '[]' && injStr !== '') hasInjury = true;
      }
      const label = hasInjury ? injuryLabelYes : injuryLabelNo;
      const g = injuryMap.get(label)!;
      g.samples += 1;
      // 大小分大命中率：选"大"的场次中的命中率
      const totalDir = (row.totalDirection ?? '').trim();
      const totalPick = (row.totalPick ?? '').trim();
      const isOverPick = totalDir.startsWith('大') || totalPick.startsWith('大');
      if (isOverPick && row.hitOverunder !== null && row.hitOverunder !== undefined) {
        g.overPickTotal += 1;
        if (row.hitOverunder === true) g.overPickHit += 1;
      }
      // 平均总分
      if (row.homeScore !== null && row.homeScore !== undefined && row.awayScore !== null && row.awayScore !== undefined) {
        g.totalPoints += row.homeScore + row.awayScore;
        g.scoredMatches += 1;
      }
    }
    const byInjury = Array.from(injuryMap.entries()).map(([label, s]) => ({
      label,
      overRate: s.overPickTotal > 0 ? Number((s.overPickHit / s.overPickTotal).toFixed(4)) : 0,
      avgPoints: s.scoredMatches > 0 ? Number((s.totalPoints / s.scoredMatches).toFixed(1)) : 0,
      samples: s.samples,
    }));

    // --- byMonth (按月趋势) ---
    type MonthStat = { samples: number; hcTotal: number; hcHit: number; overPickTotal: number; overPickHit: number };
    const monthMap = new Map<string, MonthStat>();
    for (const row of rows) {
      const kdt = new Date(row.kickoffTime);
      const year = kdt.getFullYear();
      const month = String(kdt.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      const cur: MonthStat = monthMap.get(key) ?? { samples: 0, hcTotal: 0, hcHit: 0, overPickTotal: 0, overPickHit: 0 };
      cur.samples += 1;
      if (row.hitHandicap !== null && row.hitHandicap !== undefined) {
        cur.hcTotal += 1;
        if (row.hitHandicap === true) cur.hcHit += 1;
      }
      const totalDir = (row.totalDirection ?? '').trim();
      const totalPick = (row.totalPick ?? '').trim();
      const isOverPick = totalDir.startsWith('大') || totalPick.startsWith('大');
      if (isOverPick && row.hitOverunder !== null && row.hitOverunder !== undefined) {
        cur.overPickTotal += 1;
        if (row.hitOverunder === true) cur.overPickHit += 1;
      }
      monthMap.set(key, cur);
    }
    const byMonth = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, s]) => ({
        month,
        handicapHit: s.hcTotal > 0 ? Number((s.hcHit / s.hcTotal).toFixed(4)) : 0,
        overRate: s.overPickTotal > 0 ? Number((s.overPickHit / s.overPickTotal).toFixed(4)) : 0,
        samples: s.samples,
      }));

    // --- detailList: 最近 100 场已完赛且有预测的比赛明细 ---
    const detailRows = rows
      .slice()
      .sort((a, b) => new Date(b.kickoffTime).getTime() - new Date(a.kickoffTime).getTime())
      .slice(0, 100);
    const detailList = detailRows.map((row) => ({
      id: row.id,
      matchNo: row.matchNo,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoffTime: row.kickoffTime.toISOString(),
      predictionDirection: row.predictionDirection ?? '',
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
      byDepth,
      byInjury,
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

  // ---- V11 模型回测 ----

  async getV11ModelBacktest(params?: {
    league?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<V11BacktestResponse> {
    const { start, end } = this.resolveBacktestRange({
      startDate: params?.startDate,
      endDate: params?.endDate,
      days: 365,
    });
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    // Step 1: 取所有已完赛且有有效盘口的比赛（回测目标集）
    // 仅纳入有真实大小分线(>0)的比赛，无盘口的比赛预测无意义、命中率虚高
    const matchConditions = [
      eq(basketballMatches.matchStatus, 'finished'),
      isNotNull(basketballMatches.homeScore),
      isNotNull(basketballMatches.awayScore),
      isNotNull(basketballMatches.totalLineNum),
      gt(basketballMatches.totalLineNum, '0'),
      gte(basketballMatches.kickoffTime, start),
      lte(basketballMatches.kickoffTime, end),
    ];
    if (params?.league) {
      matchConditions.push(ilike(basketballMatches.league, `%${params.league}%`));
    }

    const targetRows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        homeWinOdds: basketballMatches.homeWinOdds,
        awayWinOdds: basketballMatches.awayWinOdds,
        handicapOddsHome: basketballMatches.handicapOddsHome,
        handicapOddsAway: basketballMatches.handicapOddsAway,
        totalOddsOver: basketballMatches.totalOddsOver,
        totalOddsUnder: basketballMatches.totalOddsUnder,
        source: basketballMatches.source,
        // 老模型命中标记，用于对比
        hitWdw: basketballMatches.hitWdw,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
        predictionDirection: basketballMatches.predictionDirection,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapPick: basketballMatches.handicapPick,
        totalDirection: basketballMatches.totalDirection,
      })
      .from(basketballMatches)
      .where(and(...matchConditions))
      .orderBy(asc(basketballMatches.kickoffTime));

    if (targetRows.length === 0) {
      return {
        hasData: false,
        totalSamples: 0,
        dateRange: { start: startStr, end: endStr },
        byLeague: [],
        overall: this.emptyV11OverallStat(),
      };
    }

    // Step 2: 收集目标比赛涉及的所有球队，一次性查这些球队的全部历史完赛记录
    const teamSet = new Set<string>();
    for (const row of targetRows) {
      if (row.homeTeam) teamSet.add(row.homeTeam);
      if (row.awayTeam) teamSet.add(row.awayTeam);
    }
    const allTeamNames: string[] = Array.from(teamSet);

    const historyRows = await this.db
      .select({
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        kickoffTime: basketballMatches.kickoffTime,
        league: basketballMatches.league,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'finished'),
          isNotNull(basketballMatches.homeScore),
          isNotNull(basketballMatches.awayScore),
          or(
            inArray(basketballMatches.homeTeam, allTeamNames),
            inArray(basketballMatches.awayTeam, allTeamNames),
          ),
        ),
      )
      .orderBy(asc(basketballMatches.kickoffTime));

    // Step 3: 内存中按球队建索引（按时间升序存，回测时用二分找 kickoffTime 之前的）
    type TeamGame = { ppg: number; oppg: number; pd: number; kickoffTime: Date };
    const teamHistory = new Map<string, TeamGame[]>();
    for (const row of historyRows) {
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      const kt = row.kickoffTime instanceof Date
        ? row.kickoffTime
        : new Date(String(row.kickoffTime));
      if (row.homeTeam) {
        const arr = teamHistory.get(row.homeTeam) ?? [];
        arr.push({ ppg: hs, oppg: as, pd: hs - as, kickoffTime: kt });
        teamHistory.set(row.homeTeam, arr);
      }
      if (row.awayTeam) {
        const arr = teamHistory.get(row.awayTeam) ?? [];
        arr.push({ ppg: as, oppg: hs, pd: as - hs, kickoffTime: kt });
        teamHistory.set(row.awayTeam, arr);
      }
    }

    // 每支球队内按时间升序排列（SQL 整体升序，混了主客场后可能需要重排）
    for (const [team, games] of teamHistory) {
      games.sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime());
      teamHistory.set(team, games);
    }

    // Step 4: 内存 H2H 索引（按两队名拼接排序后做 key）
    type H2HGame = { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; kickoffTime: Date };
    const h2hHistory: H2HGame[] = [];
    for (const row of historyRows) {
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      const kt = row.kickoffTime instanceof Date
        ? row.kickoffTime
        : new Date(String(row.kickoffTime));
      if (row.homeTeam && row.awayTeam) {
        h2hHistory.push({ homeTeam: row.homeTeam, awayTeam: row.awayTeam, homeScore: hs, awayScore: as, kickoffTime: kt });
      }
    }
    h2hHistory.sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime());

    // 按 pair key 分组
    const h2hByPair = new Map<string, H2HGame[]>();
    for (const g of h2hHistory) {
      const key = this.h2hPairKey(g.homeTeam, g.awayTeam);
      const arr = h2hByPair.get(key) ?? [];
      arr.push(g);
      h2hByPair.set(key, arr);
    }

    // Step 5: 批量查 injury_reports
    const targetIds: string[] = targetRows.map((r) => r.id);
    const kickoffById = new Map<string, Date>();
    for (const r of targetRows) {
      if (r.kickoffTime) {
        kickoffById.set(r.id, r.kickoffTime instanceof Date ? r.kickoffTime : new Date(String(r.kickoffTime)));
      }
    }
    const freshCutoffMs = 21 * 24 * 60 * 60 * 1000;
    const injuryMap = new Map<string, { weightedHome: number; weightedAway: number; coreHome: number; coreAway: number }>();
    const injuryRows = await this.db
      .select({
        matchId: injuryReports.matchId,
        teamSide: injuryReports.teamSide,
        impactRating: injuryReports.impactRating,
        injuryDate: injuryReports.injuryDate,
      })
      .from(injuryReports)
      .where(inArray(injuryReports.matchId, targetIds));
    for (const ir of injuryRows) {
      if (!ir.matchId) continue;
      const cur = injuryMap.get(ir.matchId) ?? { weightedHome: 0, weightedAway: 0, coreHome: 0, coreAway: 0 };
      const isHigh = ir.impactRating === 'high';
      const isMed = ir.impactRating === 'medium';
      const weight = isHigh ? 1.0 : isMed ? 0.5 : 0.2;
      const injuryDate = ir.injuryDate
        ? (ir.injuryDate instanceof Date ? ir.injuryDate : new Date(String(ir.injuryDate)))
        : null;
      const kickoff = kickoffById.get(ir.matchId);
      const isFresh = !injuryDate || Number.isNaN(injuryDate.getTime())
        || !kickoff
        || (kickoff.getTime() - injuryDate.getTime() <= freshCutoffMs);
      if (ir.teamSide === 'home') {
        cur.weightedHome += weight;
        if ((isHigh || isMed) && isFresh) cur.coreHome += 1;
      } else if (ir.teamSide === 'away') {
        cur.weightedAway += weight;
        if ((isHigh || isMed) && isFresh) cur.coreAway += 1;
      }
      injuryMap.set(ir.matchId, cur);
    }

    // Step 6: 历史基线（全量，简化处理）
    const historicalBaselines = await this.computeLeagueHistoricalBaselines();

    // Step 7: 逐场用 V11 模型预测 + 计算命中
    type LeagueAgg = {
      sampleSize: number;
      v11WdwHit: number;
      v11WdwTotal: number;
      v11HandicapHit: number;
      v11HandicapTotal: number;
      v11OuHit: number;
      v11OuTotal: number;
      oldWdwHit: number;
      oldWdwTotal: number;
      oldHandicapHit: number;
      oldHandicapTotal: number;
      oldOuHit: number;
      oldOuTotal: number;
    };
    const leagueAgg = new Map<string, LeagueAgg>();
    let processed = 0;

    for (const row of targetRows) {
      const league = row.league || 'unknown';
      const agg: LeagueAgg = leagueAgg.get(league) ?? {
        sampleSize: 0,
        v11WdwHit: 0, v11WdwTotal: 0,
        v11HandicapHit: 0, v11HandicapTotal: 0,
        v11OuHit: 0, v11OuTotal: 0,
        oldWdwHit: 0, oldWdwTotal: 0,
        oldHandicapHit: 0, oldHandicapTotal: 0,
        oldOuHit: 0, oldOuTotal: 0,
      };
      agg.sampleSize += 1;

      const kickoffTime = row.kickoffTime instanceof Date
        ? row.kickoffTime
        : new Date(String(row.kickoffTime));
      const kickoffMs = kickoffTime.getTime();

      // 近期战绩（严格取 kickoffTime 之前）
      const homeRecent = row.homeTeam
        ? this.computeRecentStatsFromHistory(teamHistory.get(row.homeTeam) ?? [], kickoffMs)
        : null;
      const awayRecent = row.awayTeam
        ? this.computeRecentStatsFromHistory(teamHistory.get(row.awayTeam) ?? [], kickoffMs)
        : null;

      // H2H（严格取 kickoffTime 之前）
      const h2hStats = row.homeTeam && row.awayTeam
        ? this.computeH2HFromHistory(
            h2hByPair.get(this.h2hPairKey(row.homeTeam, row.awayTeam)) ?? [],
            row.homeTeam,
            kickoffMs,
          )
        : { recentPd: null, recentCount: 0, historicalPd: null, historicalCount: 0 };

      // 伤停
      const injury = injuryMap.get(row.id) ?? { weightedHome: 0, weightedAway: 0, coreHome: 0, coreAway: 0 };

      // 让分热门方判定
      const handicapVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : null;
      const hasValidSpread = handicapVal != null && Number.isFinite(handicapVal);
      const isHomeFavorite = hasValidSpread ? handicapVal < 0 : false;
      const favoriteTeamSide: 'home' | 'away' | null = hasValidSpread
        ? (isHomeFavorite ? 'home' : 'away')
        : null;
      const favoriteCoreInjuries = favoriteTeamSide === 'home'
        ? injury.coreHome
        : favoriteTeamSide === 'away' ? injury.coreAway : 0;

      // 历史基线
      const histBaseline = historicalBaselines.get(league);

      const anchorResult = this.anchorPrediction.predict({
        handicapLineNum: hasValidSpread ? handicapVal : null,
        totalLineNum: row.totalLineNum != null ? Number(row.totalLineNum) : null,
        league,
        kickoffMonth: kickoffTime.getMonth() + 1,
        homeTeam: row.homeTeam ?? undefined,
        awayTeam: row.awayTeam ?? undefined,
        homeWinOdds: row.homeWinOdds != null ? Number(row.homeWinOdds) : undefined,
        awayWinOdds: row.awayWinOdds != null ? Number(row.awayWinOdds) : undefined,
        historicalBaselineTotal: histBaseline?.avgTotal,
        historicalSampleSize: histBaseline?.sampleSize ?? 0,
        coreInjuriesHome: injury.coreHome,
        coreInjuriesAway: injury.coreAway,
        weightedInjuriesHome: injury.weightedHome,
        weightedInjuriesAway: injury.weightedAway,
        favoriteTeamSide,
        favoriteCoreInjuries,
        recent10HomePpg: homeRecent?.recent10Ppg,
        recent10AwayPpg: awayRecent?.recent10Ppg,
        recent10HomeOppg: homeRecent?.recent10Oppg,
        recent10AwayOppg: awayRecent?.recent10Oppg,
        recent20HomePpg: homeRecent?.recent20Ppg,
        recent20AwayPpg: awayRecent?.recent20Ppg,
        recent20HomeOppg: homeRecent?.recent20Oppg,
        recent20AwayOppg: awayRecent?.recent20Oppg,
        recent10HomePd: homeRecent?.recent10Pd,
        recent10AwayPd: awayRecent?.recent10Pd,
        recent20HomePd: homeRecent?.recent20Pd,
        recent20AwayPd: awayRecent?.recent20Pd,
        recentSampleCount: homeRecent && awayRecent
          ? Math.min(homeRecent.sampleCount, awayRecent.sampleCount)
          : (homeRecent?.sampleCount ?? awayRecent?.sampleCount),
        h2hRecent: h2hStats.recentPd ?? undefined,
        h2hHistorical: h2hStats.historicalPd ?? undefined,
        h2hRecentCount: h2hStats.recentCount,
        h2hHistoricalCount: h2hStats.historicalCount,
      });

      if (anchorResult) {
        const homeScore = Number(row.homeScore) || 0;
        const awayScore = Number(row.awayScore) || 0;
        const totalScore = homeScore + awayScore;
        const totalLine = row.totalLineNum != null ? Number(row.totalLineNum) : null;

        // V11 胜负命中
        const wdwDir = anchorResult.predictionDirection;
        if (wdwDir === '主胜' || wdwDir === '客胜') {
          agg.v11WdwTotal += 1;
          const wdwHit = wdwDir === '主胜'
            ? homeScore > awayScore
            : awayScore > homeScore;
          if (wdwHit) agg.v11WdwHit += 1;
        }

        // V11 让分命中
        const hcPick = anchorResult.handicapPick || anchorResult.handicapRecommendation;
        if (hasValidSpread && hcPick && !hcPick.includes('观望') && !hcPick.includes('待线值')) {
          agg.v11HandicapTotal += 1;
          const adjusted = homeScore + handicapVal;
          // 让分主胜：主队让分后仍赢客队
          // 让分客胜：客队让分后赢主队
          let hcHit = false;
          if (hcPick.includes('让分主胜') || hcPick === '主胜') {
            hcHit = adjusted > awayScore;
          } else if (hcPick.includes('让分客胜') || hcPick === '客胜') {
            hcHit = adjusted < awayScore;
          }
          if (hcHit) agg.v11HandicapHit += 1;
        }

        // V11 大小分命中
        const totalDir = anchorResult.totalDirection || anchorResult.totalPick;
        if (totalLine != null && totalDir && !totalDir.includes('观望') && !totalDir.includes('待线值')) {
          agg.v11OuTotal += 1;
          const ouHit = totalDir.startsWith('大')
            ? totalScore > totalLine
            : totalScore < totalLine;
          if (ouHit) agg.v11OuHit += 1;
        }
      }

      // 老模型命中（直接读数据库字段）
      const oldWdwDir = row.predictionDirection ?? '';
      if (oldWdwDir === '主胜' || oldWdwDir === '客胜') {
        agg.oldWdwTotal += 1;
        if (row.hitWdw === true) agg.oldWdwHit += 1;
      }
      const oldHandicapPick = (row.handicapPick || row.handicapRecommendation || '').trim();
      if (oldHandicapPick.length > 0 && !oldHandicapPick.includes('观望') && !oldHandicapPick.includes('待线值')) {
        agg.oldHandicapTotal += 1;
        if (row.hitHandicap === true) agg.oldHandicapHit += 1;
      }
      const oldTotalDir = (row.totalDirection || '').trim();
      if (oldTotalDir.length > 0 && !oldTotalDir.includes('观望') && !oldTotalDir.includes('待线值')) {
        agg.oldOuTotal += 1;
        if (row.hitOverunder === true) agg.oldOuHit += 1;
      }

      leagueAgg.set(league, agg);
      processed += 1;
    }

    // Step 8: 组装输出
    const byLeague: V11BacktestLeagueItem[] = Array.from(leagueAgg.entries())
      .sort((a, b) => b[1].sampleSize - a[1].sampleSize)
      .map(([leagueName, s]) => ({
        league: leagueName,
        sampleSize: s.sampleSize,
        v11: {
          wdwHitRate: s.v11WdwTotal > 0 ? Number((s.v11WdwHit / s.v11WdwTotal).toFixed(4)) : 0,
          handicapHitRate: s.v11HandicapTotal > 0 ? Number((s.v11HandicapHit / s.v11HandicapTotal).toFixed(4)) : 0,
          overunderHitRate: s.v11OuTotal > 0 ? Number((s.v11OuHit / s.v11OuTotal).toFixed(4)) : 0,
          wdwSamples: s.v11WdwTotal,
          handicapSamples: s.v11HandicapTotal,
          ouSamples: s.v11OuTotal,
        },
        oldModel: {
          wdwHitRate: s.oldWdwTotal > 0 ? Number((s.oldWdwHit / s.oldWdwTotal).toFixed(4)) : 0,
          handicapHitRate: s.oldHandicapTotal > 0 ? Number((s.oldHandicapHit / s.oldHandicapTotal).toFixed(4)) : 0,
          overunderHitRate: s.oldOuTotal > 0 ? Number((s.oldOuHit / s.oldOuTotal).toFixed(4)) : 0,
          wdwSamples: s.oldWdwTotal,
          handicapSamples: s.oldHandicapTotal,
          ouSamples: s.oldOuTotal,
        },
      }));

    // 总计
    let v11WdwH = 0, v11WdwT = 0, v11HcH = 0, v11HcT = 0, v11OuH = 0, v11OuT = 0;
    let oldWdwH = 0, oldWdwT = 0, oldHcH = 0, oldHcT = 0, oldOuH = 0, oldOuT = 0;
    for (const s of leagueAgg.values()) {
      v11WdwH += s.v11WdwHit; v11WdwT += s.v11WdwTotal;
      v11HcH += s.v11HandicapHit; v11HcT += s.v11HandicapTotal;
      v11OuH += s.v11OuHit; v11OuT += s.v11OuTotal;
      oldWdwH += s.oldWdwHit; oldWdwT += s.oldWdwTotal;
      oldHcH += s.oldHandicapHit; oldHcT += s.oldHandicapTotal;
      oldOuH += s.oldOuHit; oldOuT += s.oldOuTotal;
    }

    return {
      hasData: true,
      totalSamples: processed,
      dateRange: { start: startStr, end: endStr },
      byLeague,
      overall: {
        v11: {
          wdwHitRate: v11WdwT > 0 ? Number((v11WdwH / v11WdwT).toFixed(4)) : 0,
          handicapHitRate: v11HcT > 0 ? Number((v11HcH / v11HcT).toFixed(4)) : 0,
          overunderHitRate: v11OuT > 0 ? Number((v11OuH / v11OuT).toFixed(4)) : 0,
          wdwSamples: v11WdwT,
          handicapSamples: v11HcT,
          ouSamples: v11OuT,
        },
        oldModel: {
          wdwHitRate: oldWdwT > 0 ? Number((oldWdwH / oldWdwT).toFixed(4)) : 0,
          handicapHitRate: oldHcT > 0 ? Number((oldHcH / oldHcT).toFixed(4)) : 0,
          overunderHitRate: oldOuT > 0 ? Number((oldOuH / oldOuT).toFixed(4)) : 0,
          wdwSamples: oldWdwT,
          handicapSamples: oldHcT,
          ouSamples: oldOuT,
        },
        sampleSize: processed,
      },
    };
  }

  private emptyV11OverallStat(): V11BacktestOverall {
    const empty: V11BacktestHitStat = {
      wdwHitRate: 0,
      handicapHitRate: 0,
      overunderHitRate: 0,
      wdwSamples: 0,
      handicapSamples: 0,
      ouSamples: 0,
    };
    return { v11: { ...empty }, oldModel: { ...empty }, sampleSize: 0 };
  }

  private h2hPairKey(a: string, b: string): string {
    return a < b ? `${a}||${b}` : `${b}||${a}`;
  }

  /**
   * 从内存球队历史数组（按时间升序）中，取 kickoffMs 之前的最近 N 场计算数据。
   * 使用二分查找定位，保证严格使用赛前数据，防止泄露。
   */
  private computeRecentStatsFromHistory(
    games: Array<{ ppg: number; oppg: number; pd: number; kickoffTime: Date }>,
    kickoffMs: number,
  ): TeamRecentStats | null {
    if (games.length === 0) return null;
    // 二分找最后一个 < kickoffMs 的索引
    let lo = 0;
    let hi = games.length - 1;
    let lastBefore = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = games[mid].kickoffTime.getTime();
      if (t < kickoffMs) {
        lastBefore = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (lastBefore < 0) return null;

    // 取 lastBefore 往前数，最近的在最后面（数组升序），所以倒着取
    const available = lastBefore + 1; // 0..lastBefore 共 lastBefore+1 场
    const recent20: Array<{ ppg: number; oppg: number; pd: number }> = [];
    for (let i = lastBefore; i >= 0 && recent20.length < 20; i--) {
      recent20.push(games[i]);
    }
    const recent10 = recent20.slice(0, 10);
    const sampleCount = available;

    const avg = (arr: typeof recent20, field: 'ppg' | 'oppg' | 'pd'): number => {
      if (arr.length === 0) return 0;
      const sum = arr.reduce((s, g) => s + g[field], 0);
      return sum / arr.length;
    };

    return {
      recent10Ppg: avg(recent10, 'ppg'),
      recent10Oppg: avg(recent10, 'oppg'),
      recent10Pd: avg(recent10, 'pd'),
      recent20Ppg: avg(recent20, 'ppg'),
      recent20Oppg: avg(recent20, 'oppg'),
      recent20Pd: avg(recent20, 'pd'),
      sampleCount,
    };
  }

  /**
   * 从内存 H2H 数组（按时间升序）中，取 kickoffMs 之前的交锋记录。
   * 净胜分以 homeTeam（主队视角）为基准。
   */
  private computeH2HFromHistory(
    games: Array<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; kickoffTime: Date }>,
    homeTeam: string,
    kickoffMs: number,
  ): { recentPd: number | null; recentCount: number; historicalPd: number | null; historicalCount: number } {
    if (games.length === 0) {
      return { recentPd: null, recentCount: 0, historicalPd: null, historicalCount: 0 };
    }
    // 二分找最后一个 < kickoffMs
    let lo = 0;
    let hi = games.length - 1;
    let lastBefore = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = games[mid].kickoffTime.getTime();
      if (t < kickoffMs) {
        lastBefore = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (lastBefore < 0) {
      return { recentPd: null, recentCount: 0, historicalPd: null, historicalCount: 0 };
    }

    // 收集所有赛前交锋的净胜分（主队视角），最近的在前面
    const allPd: number[] = [];
    for (let i = lastBefore; i >= 0; i--) {
      const g = games[i];
      if (g.homeTeam === homeTeam) {
        allPd.push(g.homeScore - g.awayScore);
      } else {
        allPd.push(g.awayScore - g.homeScore);
      }
    }

    const historicalCount = allPd.length;
    let historicalPd: number | null = null;
    if (historicalCount >= 5) {
      const sum = allPd.reduce((s, v) => s + v, 0);
      historicalPd = sum / historicalCount;
    }

    const recent = allPd.slice(0, 5);
    const recentCount = recent.length;
    let recentPd: number | null = null;
    if (recentCount >= 2) {
      const sum = recent.reduce((s, v) => s + v, 0);
      recentPd = sum / recentCount;
    }

    return { recentPd, recentCount, historicalPd, historicalCount };
  }

  async getParlay(date: string): Promise<BasketballParlayResponse> {
    const { items: matches } = await this.getListByDate({ date });
    const dayMatches = matches.filter((m) => m.matchDate === date);

    const confidenceHitRates = await this.getBasketballConfidenceHitRates();

    const groups = this.groupBySalesDay(dayMatches, date);
    const combos: BasketballParlayCombo[] = [];

    for (const [salesDay, dayMatches] of groups) {
      const handicapPicks = dayMatches
        .filter((m) => m.handicapAnalyzed === true || (m.handicapPick && m.handicapPick.startsWith('模型参考')))
        .map((m) => this.tryMakeHandicapPick(m))
        .filter((p): p is BasketballParlayPick => p !== null)
        .filter((p) => p.singleProb >= 0.51)
        .sort((a, b) => b.singleProb - a.singleProb);

      const totalPicks = dayMatches
        .filter((m) => m.totalAnalyzed === true || (m.totalPick && m.totalPick.startsWith('模型参考')))
        .map((m) => this.tryMakeTotalPick(m))
        .filter((p): p is BasketballParlayPick => p !== null)
        .filter((p) => p.singleProb >= 0.51)
        .sort((a, b) => b.singleProb - a.singleProb);

      this.buildCombosForGroup(combos, salesDay, 'handicap', '让分胜负', handicapPicks, confidenceHitRates);
      this.buildCombosForGroup(combos, salesDay, 'total', '大小分', totalPicks, confidenceHitRates);
    }

    combos.sort((a, b) => {
      const order = ['2x1', '3x1', '3x4'];
      const ta = order.indexOf(a.type);
      const tb = order.indexOf(b.type);
      if (ta !== tb) return ta - tb;
      if (a.playType !== b.playType) return a.playType === 'handicap' ? -1 : 1;
      return a.salesDay.localeCompare(b.salesDay);
    });

    const availableMatches: BasketballParlayMatch[] = dayMatches
      .filter((m) => {
        if (m.matchStatus && m.matchStatus !== 'upcoming' && m.matchStatus !== 'live') return false;
        const h = m.handicapLineNum;
        const t = m.totalLineNum;
        const hasHc = h !== null && h !== undefined && String(h) !== '' && String(h) !== '0' && String(h) !== '0.0';
        const hasTl = t !== null && t !== undefined && String(t) !== '';
        return hasHc || hasTl;
      })
      .map((m) => ({
        id: m.id,
        matchNo: m.matchNo,
        league: m.league,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffTime: m.kickoffTime,
        confidence: m.confidence,
        handicap: m.handicap,
        handicapLineNum: m.handicapLineNum,
        handicapRecommendation: m.handicapRecommendation,
        handicapOddsHome: m.handicapOddsHome ?? null,
        handicapOddsAway: m.handicapOddsAway ?? null,
        totalLineNum: m.totalLineNum,
        totalOddsOver: m.totalOddsOver ?? null,
        totalOddsUnder: m.totalOddsUnder ?? null,
        homeWinOdds: m.homeWinOdds ?? null,
        awayWinOdds: m.awayWinOdds ?? null,
        matchStatus: m.matchStatus,
      }));

    return { date, combos, availableMatches };
  }

  private buildCombosForGroup(
    combos: BasketballParlayCombo[],
    salesDay: string,
    playType: 'handicap' | 'total',
    playLabel: string,
    picks: BasketballParlayPick[],
    confidenceHitRates: { high: { rate: number; samples: number }; mid: { rate: number; samples: number }; low: { rate: number; samples: number } },
  ): void {
    if (picks.length >= 2) {
      const picks2 = picks.slice(0, 2);
      const totalOdds2 = picks2.reduce((acc, p) => acc * p.odds, 1);
      const hitProb2 = this.clamp01(picks2.reduce((acc, p) => acc * p.singleProb, 1));
      const extra2 = this.computeParlayComboExtra(picks2, confidenceHitRates);
      combos.push({
        type: '2x1',
        playType,
        name: `${salesDay} ${playLabel} 精选组合·2场`,
        salesDay,
        league: this.summarizeLeague(picks2),
        picks: picks2,
        totalOdds: Number(totalOdds2.toFixed(2)),
        hitProbability: Number(hitProb2.toFixed(4)),
        expectedReturn: Number((totalOdds2 * hitProb2).toFixed(2)),
        description: `同销售日 ${playLabel} 真实概率最高 2 场，1 注全中方可赢`,
        note: '共 1 注，需全中',
        ...extra2,
      });
    }

    if (picks.length >= 3) {
      const picks3 = picks.slice(0, 3);
      const totalOdds3 = picks3.reduce((acc, p) => acc * p.odds, 1);
      const hitProb3 = this.clamp01(picks3.reduce((acc, p) => acc * p.singleProb, 1));
      const extra3 = this.computeParlayComboExtra(picks3, confidenceHitRates);
      combos.push({
        type: '3x1',
        playType,
        name: `${salesDay} ${playLabel} 精选组合·3场`,
        salesDay,
        league: this.summarizeLeague(picks3),
        picks: picks3,
        totalOdds: Number(totalOdds3.toFixed(2)),
        hitProbability: Number(hitProb3.toFixed(4)),
        expectedReturn: Number((totalOdds3 * hitProb3).toFixed(2)),
        description: `同销售日 ${playLabel} 真实概率最高 3 场，指数更高，1 注需全中`,
        note: '共 1 注，需全中',
        ...extra3,
      });

      const p = picks3.map((pk) => pk.singleProb);
      const o = picks3.map((pk) => pk.odds);
      const p12 = p[0] * p[1];
      const p13 = p[0] * p[2];
      const p23 = p[1] * p[2];
      const p123 = p[0] * p[1] * p[2];
      const o12 = o[0] * o[1];
      const o13 = o[0] * o[2];
      const o23 = o[1] * o[2];
      const o123 = o[0] * o[1] * o[2];
      const hitProb3x4 = this.clamp01(p12 + p13 + p23 - 2 * p123);
      const expectedReturn3x4 = (o12 * p12 + o13 * p13 + o23 * p23 + o123 * p123) / 4;
      combos.push({
        type: '3x4',
        playType,
        name: `${salesDay} ${playLabel} 精选组合·3场容错`,
        salesDay,
        league: this.summarizeLeague(picks3),
        picks: picks3,
        totalOdds: Number((o123 / 4).toFixed(2)),
        hitProbability: Number(hitProb3x4.toFixed(4)),
        expectedReturn: Number(expectedReturn3x4.toFixed(2)),
        description: `容错维度，3 场错 1 场仍可中 1 注 2 场组合`,
        note: '共 4 注（3 注 2 场 + 1 注 3 场），错 1 场仍可中 1 注 2 场',
        ...extra3,
      });
    }
  }

  private computeParlayComboExtra(
    picks: BasketballParlayPick[],
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
      const probPct = p.singleProb * 100;
      if (probPct >= 65) high += 1;
      else if (probPct >= 58) mid += 1;
      else low += 1;
    }
    const confidenceBreakdown = { high, mid, low };

    const allSufficient = hitRates.high.samples >= 20 && hitRates.mid.samples >= 20 && hitRates.low.samples >= 20;
    let similarHistoricalHitRate: number | null = null;
    if (allSufficient && picks.length > 0) {
      let product = 1;
      for (const p of picks) {
        const probPct = p.singleProb * 100;
        if (probPct >= 65) product *= hitRates.high.rate;
        else if (probPct >= 58) product *= hitRates.mid.rate;
        else product *= hitRates.low.rate;
      }
      similarHistoricalHitRate = Number(product.toFixed(4));
    }

    let riskNote = '';
    if (low >= 2) {
      riskNote = '含低信心场次，风险较高';
    } else if (high >= 3) {
      riskNote = '该组合涉及多场高信心比赛，建议分散风险';
    }

    return { confidenceBreakdown, similarHistoricalHitRate, riskNote };
  }

  private async getBasketballConfidenceHitRates(): Promise<
    { high: { rate: number; samples: number }; mid: { rate: number; samples: number }; low: { rate: number; samples: number } }
  > {
    const rows = await this.db
      .select({
        level: sql<string>`case
          when ${basketballMatches.confidence} >= 65 then 'high'
          when ${basketballMatches.confidence} >= 58 then 'mid'
          else 'low'
        end`,
        total: sql<number>`count(*) filter (where ${basketballMatches.hitWdw} is not null)`,
        hits: sql<number>`count(*) filter (where ${basketballMatches.hitWdw} = true)`,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.matchStatus, 'finished'))
      .groupBy(sql`case
          when ${basketballMatches.confidence} >= 65 then 'high'
          when ${basketballMatches.confidence} >= 58 then 'mid'
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

  private groupBySalesDay(matches: BasketballMatchItem[], fallbackLabel: string): Map<string, BasketballMatchItem[]> {
    const groups = new Map<string, BasketballMatchItem[]>();
    const fallbackKey = fallbackLabel || '当日赛事';
    for (const m of matches) {
      const prefix = this.extractSalesDay(m.matchNo);
      const key = prefix ?? fallbackKey;
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }
    return groups;
  }

  private extractSalesDay(matchNo: string): string | null {
    const m = matchNo.match(/^(周[一二三四五六日])/);
    return m ? m[1] : null;
  }

  private clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  private summarizeLeague(picks: BasketballParlayPick[]): string {
    const leagues = Array.from(new Set(picks.map((p) => p.league)));
    return leagues.length <= 2 ? leagues.join(' / ') : `${leagues[0]} 等 ${leagues.length} 联赛`;
  }

  private tryMakeHandicapPick(match: BasketballMatchItem): BasketballParlayPick | null {
    const hcLine = match.handicapLineNum;
    const handicapHasRealProb = match.handicapPickProb != null && match.handicapPickProb >= 51;
    const handicapLineValid = hcLine !== null && hcLine !== undefined && hcLine !== 0;
    const isModelRef = match.handicapPick?.startsWith('模型参考');
    if (!handicapHasRealProb || !match.handicapPick || match.handicapPick === '观望') return null;

    let pickDirection = '';
    let odds = 1.85;
    let lineForDisplay = hcLine ?? 0;

    if (handicapLineValid && !isModelRef) {
      const isHomeCover = match.handicapPick.startsWith('让分主胜');
      const coverTeam = isHomeCover ? match.homeTeam : match.awayTeam;
      const lineForCoverTeam = isHomeCover ? hcLine : -hcLine;
      const coverTeamIsFavorite = lineForCoverTeam < 0;
      const absLine = Math.abs(lineForCoverTeam);
      const lineSign = coverTeamIsFavorite ? '-' : '+';
      const lineStr = `${lineSign}${absLine.toFixed(1)}`;
      const actionText = coverTeamIsFavorite ? '让分赢指数' : '受让赢指数';
      pickDirection = `${coverTeam} ${lineStr} ${actionText}`;
      odds = isHomeCover ? (match.handicapOddsHome ?? 1.85) : (match.handicapOddsAway ?? 1.85);
    } else {
      const homePred = match.predictedHomeScore ?? 0;
      const awayPred = match.predictedAwayScore ?? 0;
      const expectedMargin = homePred - awayPred;
      const isHomeCover = match.handicapPick.includes('主胜');
      const coverTeam = isHomeCover ? match.homeTeam : match.awayTeam;
      const refLine = isHomeCover ? -Math.abs(expectedMargin) : Math.abs(expectedMargin);
      lineForDisplay = refLine;
      const lineSign = expectedMargin >= 0 ? '+' : '-';
      const absLine = Math.abs(expectedMargin);
      pickDirection = `${coverTeam} 模型参考 ${lineSign}${absLine.toFixed(1)}`;
      odds = 1.80;
    }
    const singleProb = match.handicapPickProb / 100;
    if (singleProb <= 0 || singleProb >= 1) return null;

    return {
      matchId: match.id,
      matchNo: match.matchNo,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffTime: match.kickoffTime,
      pickType: 'handicap',
      pickDirection,
      odds: Number(odds.toFixed(2)),
      singleProb: Number(singleProb.toFixed(4)),
      handicapLineNum: lineForDisplay,
      totalLineNum: match.totalLineNum ?? undefined,
    };
  }

  private tryMakeTotalPick(match: BasketballMatchItem): BasketballParlayPick | null {
    const totalLine = match.totalLineNum;
    const totalHasRealProb = match.totalPickProb != null && match.totalPickProb >= 51;
    const totalLineValid = totalLine !== null && totalLine !== undefined && totalLine !== 0;
    const totalIsValid = match.totalPick && match.totalPick !== '观望';
    const isModelRef = match.totalPick?.startsWith('模型参考');
    if (!totalHasRealProb || !totalIsValid) return null;

    let pickDirection = '';
    let odds = 1.85;
    let lineVal = totalLine ?? ((match.predictedTotal ?? 0) || 150);

    if (totalLineValid && !isModelRef) {
      const isOver = match.totalPick === '大分';
      lineVal = Number(totalLine);
      pickDirection = isOver ? `大 ${lineVal.toFixed(1)}` : `小 ${lineVal.toFixed(1)}`;
      odds = isOver ? (match.totalOddsOver ?? 1.85) : (match.totalOddsUnder ?? 1.85);
    } else {
      const predTotal = match.predictedTotal || 150;
      lineVal = predTotal;
      const isOver = match.totalPick.includes('大分');
      pickDirection = `模型参考 ${isOver ? '大' : '小'} ${predTotal.toFixed(0)}`;
      odds = 1.80;
    }
    const singleProb = match.totalPickProb / 100;
    if (singleProb <= 0 || singleProb >= 1) return null;

    return {
      matchId: match.id,
      matchNo: match.matchNo,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffTime: match.kickoffTime,
      pickType: 'total',
      pickDirection,
      odds: Number(odds.toFixed(2)),
      singleProb: Number(singleProb.toFixed(4)),
      totalLineNum: lineVal,
      handicapLineNum: match.handicapLineNum ?? undefined,
    };
  }

  validateMatchData(data: {
    homeTeam: string;
    awayTeam: string;
    handicapLineNum: number;
    handicapFavorite?: string | null;
    predHandicap: string;
    predScoreHome: number;
    predScoreAway: number;
    totalLineNum: number;
    predTotal: string;
    predWinHome: number;
    predWinAway: number;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const { homeTeam, awayTeam, handicapLineNum, handicapFavorite, predHandicap, predScoreHome, predScoreAway, totalLineNum, predTotal, predWinHome, predWinAway } = data;

    if (handicapFavorite) {
      if (handicapFavorite !== homeTeam && handicapFavorite !== awayTeam) {
        errors.push(`校验1失败：让球方 ${handicapFavorite} 必须是主队(${homeTeam})或客队(${awayTeam})之一`);
      }
      if (handicapLineNum > 0 && handicapFavorite !== awayTeam) {
        errors.push(`校验2失败：handicap_line=${handicapLineNum}(主队受让)，让球方应为客队(${awayTeam})，实际为${handicapFavorite}`);
      }
      if (handicapLineNum < 0 && handicapFavorite !== homeTeam) {
        errors.push(`校验3失败：handicap_line=${handicapLineNum}(主队让球)，让球方应为主队(${homeTeam})，实际为${handicapFavorite}`);
      }
    }

    const awayMargin = predScoreAway - predScoreHome;
    if (handicapLineNum > 0) {
      if (predHandicap === '让分客胜' && awayMargin <= Math.abs(handicapLineNum)) {
        errors.push(`校验4失败：推荐让分客胜(客队过线)但客队净胜${awayMargin}分 ≤ 让分线${Math.abs(handicapLineNum)}`);
      }
      if (predHandicap === '让分主胜' && awayMargin >= Math.abs(handicapLineNum)) {
        errors.push(`校验4失败：推荐让分主胜(客队不过线)但客队净胜${awayMargin}分 ≥ 让分线${Math.abs(handicapLineNum)}`);
      }
    } else if (handicapLineNum < 0) {
      const homeMargin = predScoreHome - predScoreAway;
      if (predHandicap === '让分主胜' && homeMargin <= Math.abs(handicapLineNum)) {
        errors.push(`校验4失败：推荐让分主胜(主队过线)但主队净胜${homeMargin}分 ≤ 让分线${Math.abs(handicapLineNum)}`);
      }
      if (predHandicap === '让分客胜' && homeMargin >= Math.abs(handicapLineNum)) {
        errors.push(`校验4失败：推荐让分客胜(主队不过线)但主队净胜${homeMargin}分 ≥ 让分线${Math.abs(handicapLineNum)}`);
      }
    }

    const totalScore = predScoreHome + predScoreAway;
    if (predTotal === '大' && totalScore <= totalLineNum) {
      errors.push(`校验5失败：推荐大分但预期总分${totalScore} ≤ 指数线${totalLineNum}`);
    }
    if (predTotal === '小' && totalScore >= totalLineNum) {
      errors.push(`校验5失败：推荐小分但预期总分${totalScore} ≥ 指数线${totalLineNum}`);
    }

    const sum = predWinHome + predWinAway;
    if (sum < 95 || sum > 105) {
      errors.push(`校验6失败：主胜概率+客胜概率=${sum}%，不在95%-105%合理范围内`);
    }

    return { valid: errors.length === 0, errors };
  }

  calculateHitResults(data: {
    homeScore: number;
    awayScore: number;
    predWinHome: number;
    predWinAway: number;
    handicapLineNum: number;
    predHandicap: string;
    totalLineNum: number;
    predTotal: string;
  }): { hitWdw: boolean; hitHandicap: boolean | null; hitTotal: boolean } {
    const { homeScore, awayScore, predWinHome, predWinAway, handicapLineNum, predHandicap, totalLineNum, predTotal } = data;

    const predHomeWin = predWinHome > predWinAway;
    const actualHomeWin = homeScore > awayScore;
    const hitWdw = predHomeWin === actualHomeWin;

    const cover = (homeScore - awayScore) + handicapLineNum;
    let hitHandicap: boolean | null = null;
    if (cover > 0) {
      hitHandicap = predHandicap === '让分主胜';
    } else if (cover < 0) {
      hitHandicap = predHandicap === '让分客胜';
    }

    const total = homeScore + awayScore;
    const actualOver = total > totalLineNum;
    const predOver = predTotal === '大';
    const hitTotal = actualOver === predOver;

    return { hitWdw, hitHandicap, hitTotal };
  }

  async getDataSourceStatus(): Promise<BasketballDataSourceStatusResponse> {
    const items: BasketballDataSourceStatusItem[] = [
      { league: 'NBA', coverage: 'espn_auto', source: 'ESPN实时比分', hasLiveScore: true },
      { league: 'WNBA', coverage: 'espn_auto', source: 'ESPN实时比分', hasLiveScore: true },
      { league: '亚运男篮', coverage: 'backup_manual', source: '新华网/直播吧/懂球帝/OCA官网', hasLiveScore: false },
      { league: '亚运女篮', coverage: 'backup_manual', source: '新华网/直播吧/懂球帝/OCA官网', hasLiveScore: false },
      { league: '德篮联', coverage: 'backup_manual', source: 'easyCredit BBL官网/sportradar/eurosport', hasLiveScore: false },
      { league: '澳NBL', coverage: 'nbl_official_auto', source: 'NBL官方实时比分', hasLiveScore: true },
      { league: 'CBA', coverage: 'backup_manual', source: 'CBA官网/直播吧/懂球帝', hasLiveScore: false },
      { league: '欧冠篮', coverage: 'backup_manual', source: 'Euroleague官网/sportradar', hasLiveScore: false },
    ];
    return { items };
  }

  async ensureHandicapRecommendationConsistency(): Promise<{ fixedCount: number }> {
    const table = basketballMatches;
    const result = await this.db
      .update(table)
      .set({
        handicapRecommendation: sql<string>`case
          when (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) > 0.1 then '让分主胜'
          else '让分客胜'
        end`,
        handicapPick: sql<string>`case
          when (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) > 0.1 then '让分主胜'
          else '让分客胜'
        end`,
        modelRules: sql<string[]>`array_append(${table.modelRules}, '让分推荐自洽修复：对齐至预期比分与新线值')`,
        updatedAt: new Date(),
      })
      .where(and(
        isNotNull(table.handicapLineNum),
        sql`${table.handicapLineNum} <> 0`,
        isNotNull(table.predictedHomeScore),
        isNotNull(table.predictedAwayScore),
        gt(table.predictedHomeScore, 0),
        gt(table.predictedAwayScore, 0),
        sql`${table.handicapRecommendation} is not null`,
        sql`${table.handicapRecommendation} <> ''`,
        sql`${table.handicapRecommendation} not like '%观望%'`,
        sql`(
          (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) > 0.1
          and ${table.handicapRecommendation} = '让分客胜'
        ) or (
          (coalesce(${table.predictedHomeScore}, 0) - coalesce(${table.predictedAwayScore}, 0) + coalesce(${table.handicapLineNum}, 0)) < -0.1
          and ${table.handicapRecommendation} = '让分主胜'
        )`,
      ))
      .returning({ id: table.id });
    return { fixedCount: result.length };
  }

  async recalculateHandicapHits(): Promise<BasketballRecalcHandicapResponse> {
    const table = basketballMatches;

    // Step 0: Fix recommendation ↔ line inconsistency across all matches
    const step0Result = await this.ensureHandicapRecommendationConsistency();
    const fixedRecCount = step0Result.fixedCount;

    // Step 1: Fix handicap_pick inconsistency — pick differs from recommendation
    // Direction rule: handicapCoverProb > 50 → 让分主胜(home covers); < 50 → 让分客胜(away covers)
    // Use handicapPickProb if it deviates from 50, otherwise fall back to handicapCoverProb
    const pickFixResult = await this.db
      .update(table)
      .set({
        handicapPick: sql<string>`case
          when coalesce(nullif(${table.handicapPickProb}, 50), ${table.handicapCoverProb}) > 50 then '让分主胜'
          else '让分客胜'
        end`,
        updatedAt: new Date(),
      })
      .where(and(
        isNotNull(table.handicapLineNum),
        ne(table.handicapLineNum, '0'),
        sql`${table.handicapRecommendation} is not null`,
        sql`${table.handicapRecommendation} <> ''`,
        sql`${table.handicapRecommendation} not like '%观望%'`,
        sql`coalesce(${table.handicapPick}, '') <> ${table.handicapRecommendation}`,
        sql`coalesce(nullif(${table.handicapPickProb}, 50), ${table.handicapCoverProb}) <> 50`,
      ))
      .returning({ id: table.id });
    const fixedPickCount = pickFixResult.length;

    // Step 2: Recalculate hit_handicap for all finished matches with scores and valid line
    const rows = await this.db
      .select({
        id: table.id,
        homeScore: table.homeScore,
        awayScore: table.awayScore,
        handicapPick: table.handicapPick,
        handicapLineNum: table.handicapLineNum,
      })
      .from(table)
      .where(and(
        eq(table.matchStatus, 'finished'),
        isNotNull(table.homeScore),
        isNotNull(table.awayScore),
        isNotNull(table.handicapLineNum),
        ne(table.handicapLineNum, '0'),
      ));

    let hitCount = 0;
    let missCount = 0;
    let pushCount = 0;
    const toUpdate: { id: string; hitHandicap: boolean | null }[] = [];

    for (const row of rows) {
      const hScore = Number(row.homeScore);
      const aScore = Number(row.awayScore);
      const lineNum = Number(row.handicapLineNum);
      const pick = row.handicapPick || '';

      const cover = (hScore - aScore) + lineNum;
      let actualResult: 'home' | 'away' | 'push' = 'push';
      if (cover > 0) actualResult = 'home';
      else if (cover < 0) actualResult = 'away';

      let hitHandicap: boolean | null = null;
      if (actualResult === 'push') {
        hitHandicap = null;
        pushCount += 1;
      } else if (pick === '让分主胜') {
        hitHandicap = actualResult === 'home';
        if (hitHandicap) hitCount += 1; else missCount += 1;
      } else if (pick === '让分客胜') {
        hitHandicap = actualResult === 'away';
        if (hitHandicap) hitCount += 1; else missCount += 1;
      } else {
        // 观望 or unknown — set to null
        hitHandicap = null;
      }

      toUpdate.push({ id: row.id, hitHandicap });
    }

    // Batch update using a transaction
    if (toUpdate.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const item of toUpdate) {
          await tx
            .update(table)
            .set({ hitHandicap: item.hitHandicap, updatedAt: new Date() })
            .where(eq(table.id, item.id));
        }
      });
    }

    const recalculatedCount = rows.length;

    // Step 3: Recalculate hit_wdw and hit_overunder for all finished matches with scores
    const wdwOuRows = await this.db
      .select({
        id: table.id,
        homeScore: table.homeScore,
        awayScore: table.awayScore,
        predictionDirection: table.predictionDirection,
        homeWinProb: table.homeWinProb,
        awayWinProb: table.awayWinProb,
        totalLineNum: table.totalLineNum,
        totalDirection: table.totalDirection,
        totalPick: table.totalPick,
        overProb: table.overProb,
        underProb: table.underProb,
      })
      .from(table)
      .where(and(
        eq(table.matchStatus, 'finished'),
        isNotNull(table.homeScore),
        isNotNull(table.awayScore),
      ));

    let wdwHit = 0;
    let wdwMiss = 0;
    let ouHit = 0;
    let ouMiss = 0;
    let ouPush = 0;
    const wdwOuUpdates: { id: string; hitWdw: boolean | null; hitOverunder: boolean | null }[] = [];

    for (const row of wdwOuRows) {
      const hScore = Number(row.homeScore);
      const aScore = Number(row.awayScore);
      const actualHomeWin = hScore > aScore;
      const predDir = row.predictionDirection || '';

      let hitWdw: boolean | null = null;
      if (predDir === '主胜') {
        hitWdw = actualHomeWin;
        if (hitWdw) wdwHit += 1; else wdwMiss += 1;
      } else if (predDir === '客胜') {
        hitWdw = !actualHomeWin;
        if (hitWdw) wdwHit += 1; else wdwMiss += 1;
      }

      let hitOu: boolean | null = null;
      const tLine = Number(row.totalLineNum);
      const total = hScore + aScore;
      const tPick = row.totalPick || '';
      if (tLine > 0 && tPick && tPick !== '观望') {
        if (total > tLine) {
          hitOu = tPick === '大分' || tPick.includes('大分');
        } else if (total < tLine) {
          hitOu = tPick === '小分' || tPick.includes('小分');
        } else {
          ouPush += 1;
          hitOu = null;
        }
        if (hitOu === true) ouHit += 1;
        else if (hitOu === false) ouMiss += 1;
      }

      wdwOuUpdates.push({ id: row.id, hitWdw, hitOverunder: hitOu });
    }

    if (wdwOuUpdates.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const item of wdwOuUpdates) {
          await tx
            .update(table)
            .set({ hitWdw: item.hitWdw, hitOverunder: item.hitOverunder, updatedAt: new Date() })
            .where(eq(table.id, item.id));
        }
      });
    }

    this.logger.log(
      `让分命中重算完成: 重算${recalculatedCount}场, 推荐自洽修复${fixedRecCount}场, 修正pick${fixedPickCount}场, 命中${hitCount}, 未中${missCount}, 走指${pushCount}`,
    );
    this.logger.log(
      `胜负/大小分命中重算完成: 重算${wdwOuRows.length}场, 胜负命中${wdwHit}/${wdwMiss}, 大小分命中${ouHit}/${ouMiss}, 走指${ouPush}`,
    );

    return {
      recalculatedCount,
      fixedPickCount,
      fixedRecommendationCount: fixedRecCount,
      hitCount,
      missCount,
      pushCount,
    };
  }

  async getOddsAlerts(date: string, threshold = 0.5): Promise<BasketballOddsAlertsResponse> {
    // --- Monitored count: basketball matches with odds data on the given date ---
    const conditions = [
      sql`(
        (${basketballMatches.handicapOddsHome} IS NOT NULL AND ${basketballMatches.handicapOddsHome}::numeric > 0)
        OR (${basketballMatches.handicapOddsAway} IS NOT NULL AND ${basketballMatches.handicapOddsAway}::numeric > 0)
        OR (${basketballMatches.totalOddsOver} IS NOT NULL AND ${basketballMatches.totalOddsOver}::numeric > 0)
        OR (${basketballMatches.totalOddsUnder} IS NOT NULL AND ${basketballMatches.totalOddsUnder}::numeric > 0)
        OR (${basketballMatches.homeWinOdds} IS NOT NULL AND ${basketballMatches.homeWinOdds}::numeric > 0)
        OR (${basketballMatches.awayWinOdds} IS NOT NULL AND ${basketballMatches.awayWinOdds}::numeric > 0)
      )`,
    ];
    if (date) {
      conditions.push(eq(basketballMatches.matchDate, date));
    }

    const [{ count: totalMonitored }] = await this.db
      .select({ count: count() })
      .from(basketballMatches)
      .where(and(...conditions));
    const monitoredCount = Number(totalMonitored ?? 0);

    // --- Real alerts from basketball_odds_snapshots: adjacent snapshot comparison ---
    const dateCondition = date
      ? sql`AND m.match_date = ${date}`
      : sql``;

    const alertsQuery = sql`
      WITH ranked AS (
        SELECT
          s.id,
          s.match_id,
          s.odds_type,
          s.odds_json,
          s.created_at,
          LAG(s.odds_json) OVER (
            PARTITION BY s.match_id, s.odds_type
            ORDER BY s.created_at ASC
          ) AS prev_json
        FROM basketball_odds_snapshots s
        JOIN basketball_matches m ON m.id = s.match_id
        WHERE 1=1
          ${dateCondition}
      )
      SELECT
        r.match_id,
        r.odds_type,
        r.odds_json,
        r.prev_json,
        r.created_at,
        m.match_no,
        m.league,
        m.home_team,
        m.away_team,
        m.kickoff_time
      FROM ranked r
      JOIN basketball_matches m ON m.id = r.match_id
      WHERE r.prev_json IS NOT NULL
      ORDER BY r.created_at DESC
    `;

    const rows = await this.db.execute<{
      match_id: string;
      odds_type: string;
      odds_json: Record<string, unknown>;
      prev_json: Record<string, unknown>;
      created_at: Date;
      match_no: string;
      league: string;
      home_team: string;
      away_team: string;
      kickoff_time: Date;
    }>(alertsQuery);

    const items: BasketballOddsAlertItem[] = [];
    const ABS_THRESHOLD = threshold;

    for (const row of rows) {
      const curr = row.odds_json;
      const prev = row.prev_json;
      const oddsType = row.odds_type as 'h2h' | 'handicap' | 'total';
      const createdAtDate = typeof row.created_at === 'string'
        ? new Date(row.created_at)
        : (row.created_at as Date);
      const detectedAt = createdAtDate.toISOString();

      if (oddsType === 'h2h') {
        const fields: Array<{ key: string; team: string }> = [
          { key: 'home', team: 'home' },
          { key: 'away', team: 'away' },
        ];
        for (const f of fields) {
          const oldVal = Number(prev[f.key]);
          const newVal = Number(curr[f.key]);
          if (oldVal > 0 && newVal > 0) {
            const diff = newVal - oldVal;
            if (Math.abs(diff) >= ABS_THRESHOLD) {
              const changePct = oldVal > 0 ? (diff / oldVal) * 100 : 0;
              items.push({
                id: `${row.match_id}-h2h-${f.team}-${createdAtDate.getTime()}`,
                matchId: row.match_id,
                matchNo: row.match_no,
                league: row.league,
                homeTeam: row.home_team,
                awayTeam: row.away_team,
                kickoffTime: typeof row.kickoff_time === 'string' ? row.kickoff_time : new Date(row.kickoff_time as Date).toISOString(),
                alertType: 'h2h',
                team: f.team,
                initialValue: Math.round(oldVal * 100) / 100,
                currentValue: Math.round(newVal * 100) / 100,
                changeAmount: Math.round(diff * 100) / 100,
                changeDirection: diff >= 0 ? 'up' : 'down',
                changePercent: Math.round(changePct * 100) / 100,
                detectedAt,
              });
            }
          }
        }
      } else if (oddsType === 'handicap') {
        // Handicap line change
        const oldLine = Number(prev['line']);
        const newLine = Number(curr['line']);
        if (!Number.isNaN(oldLine) && !Number.isNaN(newLine) && Math.abs(newLine - oldLine) > 1e-9) {
          const diff = newLine - oldLine;
          items.push({
            id: `${row.match_id}-handicap-line-${createdAtDate.getTime()}`,
            matchId: row.match_id,
            matchNo: row.match_no,
            league: row.league,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            kickoffTime: typeof row.kickoff_time === 'string' ? row.kickoff_time : new Date(row.kickoff_time as Date).toISOString(),
            alertType: 'handicap',
            team: 'line',
            initialValue: Math.round(oldLine * 100) / 100,
            currentValue: Math.round(newLine * 100) / 100,
            changeAmount: Math.round(diff * 100) / 100,
            changeDirection: diff >= 0 ? 'up' : 'down',
            changePercent: oldLine !== 0 ? Math.round((diff / Math.abs(oldLine)) * 10000) / 100 : 0,
            detectedAt,
          });
        }
        // Handicap odds
        const fields: Array<{ key: string; team: string }> = [
          { key: 'home', team: 'home' },
          { key: 'away', team: 'away' },
        ];
        for (const f of fields) {
          const oldVal = Number(prev[f.key]);
          const newVal = Number(curr[f.key]);
          if (oldVal > 0 && newVal > 0) {
            const diff = newVal - oldVal;
            if (Math.abs(diff) >= ABS_THRESHOLD) {
              const changePct = oldVal > 0 ? (diff / oldVal) * 100 : 0;
              items.push({
                id: `${row.match_id}-handicap-${f.team}-${createdAtDate.getTime()}`,
                matchId: row.match_id,
                matchNo: row.match_no,
                league: row.league,
                homeTeam: row.home_team,
                awayTeam: row.away_team,
                kickoffTime: typeof row.kickoff_time === 'string' ? row.kickoff_time : new Date(row.kickoff_time as Date).toISOString(),
                alertType: 'handicap',
                team: f.team,
                initialValue: Math.round(oldVal * 100) / 100,
                currentValue: Math.round(newVal * 100) / 100,
                changeAmount: Math.round(diff * 100) / 100,
                changeDirection: diff >= 0 ? 'up' : 'down',
                changePercent: Math.round(changePct * 100) / 100,
                detectedAt,
              });
            }
          }
        }
      } else if (oddsType === 'total') {
        // Total line change
        const oldLine = Number(prev['line']);
        const newLine = Number(curr['line']);
        if (!Number.isNaN(oldLine) && !Number.isNaN(newLine) && Math.abs(newLine - oldLine) > 1e-9) {
          const diff = newLine - oldLine;
          items.push({
            id: `${row.match_id}-total-line-${createdAtDate.getTime()}`,
            matchId: row.match_id,
            matchNo: row.match_no,
            league: row.league,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            kickoffTime: typeof row.kickoff_time === 'string' ? row.kickoff_time : new Date(row.kickoff_time as Date).toISOString(),
            alertType: 'total',
            team: 'line',
            initialValue: Math.round(oldLine * 100) / 100,
            currentValue: Math.round(newLine * 100) / 100,
            changeAmount: Math.round(diff * 100) / 100,
            changeDirection: diff >= 0 ? 'up' : 'down',
            changePercent: oldLine !== 0 ? Math.round((diff / Math.abs(oldLine)) * 10000) / 100 : 0,
            detectedAt,
          });
        }
        // Total odds (over/under)
        const fields: Array<{ key: string; team: string }> = [
          { key: 'over', team: 'over' },
          { key: 'under', team: 'under' },
        ];
        for (const f of fields) {
          const oldVal = Number(prev[f.key]);
          const newVal = Number(curr[f.key]);
          if (oldVal > 0 && newVal > 0) {
            const diff = newVal - oldVal;
            if (Math.abs(diff) >= ABS_THRESHOLD) {
              const changePct = oldVal > 0 ? (diff / oldVal) * 100 : 0;
              items.push({
                id: `${row.match_id}-total-${f.team}-${createdAtDate.getTime()}`,
                matchId: row.match_id,
                matchNo: row.match_no,
                league: row.league,
                homeTeam: row.home_team,
                awayTeam: row.away_team,
                kickoffTime: typeof row.kickoff_time === 'string' ? row.kickoff_time : new Date(row.kickoff_time as Date).toISOString(),
                alertType: 'total',
                team: f.team,
                initialValue: Math.round(oldVal * 100) / 100,
                currentValue: Math.round(newVal * 100) / 100,
                changeAmount: Math.round(diff * 100) / 100,
                changeDirection: diff >= 0 ? 'up' : 'down',
                changePercent: Math.round(changePct * 100) / 100,
                detectedAt,
              });
            }
          }
        }
      }
    }

    // Enrich with prediction direction from basketball_matches
    const uniqueMatchIdsArr = Array.from(new Set(items.map((i) => i.matchId)));
    if (uniqueMatchIdsArr.length > 0) {
      const matchInfos = await this.db
        .select({
          id: basketballMatches.id,
          predictionDirection: basketballMatches.predictionDirection,
          handicapPick: basketballMatches.handicapPick,
          totalPick: basketballMatches.totalPick,
        })
        .from(basketballMatches)
        .where(inArray(basketballMatches.id, uniqueMatchIdsArr));
      const matchInfoMap = new Map(matchInfos.map((m) => [m.id, m]));

      for (const item of items) {
        const info = matchInfoMap.get(item.matchId);
        if (info) {
          const alignment = this.computeBasketballDirectionAlignment(
            item.alertType,
            item.team,
            item.changeDirection,
            info.predictionDirection ?? null,
            info.handicapPick ?? null,
            info.totalPick ?? null,
          );
          item.predictionDirection = alignment.direction;
          item.predictionType = alignment.type;
          item.directionAlign = alignment.align;
        }
      }
    }

    // Sort by detected time descending (newest first)
    items.sort((a: BasketballOddsAlertItem, b: BasketballOddsAlertItem) =>
      new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );

    const matchSet = new Set(items.map((i) => i.matchId));

    return {
      items,
      total: items.length,
      monitoredCount,
      matchCount: matchSet.size,
    };
  }

  /**
   * 计算篮球异动方向与预测方向的一致性
   */
  private computeBasketballDirectionAlignment(
    alertType: 'h2h' | 'handicap' | 'total',
    team: string,
    changeDirection: 'up' | 'down',
    predictionDirection: string | null,
    handicapPick: string | null,
    totalPick: string | null,
  ): {
    direction: string | undefined;
    type: ('wdw' | 'handicap' | 'overunder') | undefined;
    align: 'consistent' | 'opposite' | 'unknown';
  } {
    const isUp = changeDirection === 'up';

    if (alertType === 'h2h') {
      if (!predictionDirection) {
        return { direction: undefined, type: undefined, align: 'unknown' };
      }
      const movingSide: 'home' | 'away' = team === 'home' ? 'home' : 'away';
      const predIsHome = predictionDirection.includes('主') || predictionDirection === 'home';
      const predIsAway = predictionDirection.includes('客') || predictionDirection === 'away';
      let predSide: 'home' | 'away' | null = null;
      if (predIsHome) predSide = 'home';
      else if (predIsAway) predSide = 'away';

      if (!predSide) {
        return {
          direction: predictionDirection,
          type: 'wdw',
          align: 'unknown',
        };
      }

      // 指数上涨 = 该方不被看好 = 若预测指向该方则相悖
      const sameSide = movingSide === predSide;
      const align: 'consistent' | 'opposite' = sameSide
        ? (isUp ? 'opposite' : 'consistent')
        : (isUp ? 'consistent' : 'opposite');

      return {
        direction: predictionDirection,
        type: 'wdw',
        align,
      };
    }

    if (alertType === 'handicap') {
      if (!handicapPick) {
        return { direction: undefined, type: undefined, align: 'unknown' };
      }

      const isLineChange = team === 'line';
      if (isLineChange) {
        // 让分指数线变化：line up（主队让分更深/数值更大）= 看好主队赢指数
        // handicap_pick 常见值：主胜/客胜/主让胜/主让负 等
        const predFavorsHome =
          handicapPick.includes('主胜') ||
          handicapPick.includes('让主') ||
          handicapPick.includes('主让胜');
        const predFavorsAway =
          handicapPick.includes('客胜') ||
          handicapPick.includes('让客') ||
          handicapPick.includes('主让负');
        // line up = 主队让更深 = 看好主队赢指数
        const moveFavorsHome = isUp;
        let align: 'consistent' | 'opposite' | 'unknown' = 'unknown';
        if (predFavorsHome) {
          align = moveFavorsHome ? 'consistent' : 'opposite';
        } else if (predFavorsAway) {
          align = moveFavorsHome ? 'opposite' : 'consistent';
        }
        return {
          direction: handicapPick,
          type: 'handicap',
          align,
        };
      }

      // 让分指数变化
      const movingSide: 'home' | 'away' = team === 'home' ? 'home' : 'away';
      const predFavorsHome =
        handicapPick.includes('主胜') ||
        handicapPick.includes('让主') ||
        handicapPick.includes('主让胜');
      const predFavorsAway =
        handicapPick.includes('客胜') ||
        handicapPick.includes('让客') ||
        handicapPick.includes('主让负');
      let predSide: 'home' | 'away' | null = null;
      if (predFavorsHome) predSide = 'home';
      else if (predFavorsAway) predSide = 'away';

      if (!predSide) {
        return {
          direction: handicapPick,
          type: 'handicap',
          align: 'unknown',
        };
      }

      const sameSide = movingSide === predSide;
      const align: 'consistent' | 'opposite' = sameSide
        ? (isUp ? 'opposite' : 'consistent')
        : (isUp ? 'consistent' : 'opposite');

      return {
        direction: handicapPick,
        type: 'handicap',
        align,
      };
    }

    if (alertType === 'total') {
      if (!totalPick) {
        return { direction: undefined, type: undefined, align: 'unknown' };
      }

      const isLineChange = team === 'line';
      const predIsOver = totalPick.includes('大') || totalPick.toLowerCase().includes('over');

      if (isLineChange) {
        // 总分指数线上升 = 看好大分
        const moveFavorsOver = isUp;
        const align: 'consistent' | 'opposite' = predIsOver
          ? (moveFavorsOver ? 'consistent' : 'opposite')
          : (moveFavorsOver ? 'opposite' : 'consistent');
        return {
          direction: totalPick,
          type: 'overunder',
          align,
        };
      }

      // 大小分指数变化
      const movingOver = team === 'over';
      const movingUnder = team === 'under';
      if (!movingOver && !movingUnder) {
        return {
          direction: totalPick,
          type: 'overunder',
          align: 'unknown',
        };
      }

      const sameSide = (predIsOver && movingOver) || (!predIsOver && movingUnder);
      const align: 'consistent' | 'opposite' = sameSide
        ? (isUp ? 'opposite' : 'consistent')
        : (isUp ? 'consistent' : 'opposite');

      return {
        direction: totalPick,
        type: 'overunder',
        align,
      };
    }

    return { direction: undefined, type: undefined, align: 'unknown' };
  }

  private getNextDate(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  private getBeijingDateStr(date: Date): string {
    const utcMs = date.getTime();
    const beijingMs = utcMs + 8 * 3600 * 1000;
    const d = new Date(beijingMs);
    return d.toISOString().slice(0, 10);
  }

  private buildBasketballInsertValues(
    dto: CreateBasketballMatchRequest,
    userId: string,
  ): typeof basketballMatches.$inferInsert {
    const now = new Date();
    const kickoffDate = new Date(dto.kickoffTime);
    const notStarted = kickoffDate.getTime() > now.getTime();
    const hasScoreOrHit =
      dto.homeScore !== undefined ||
      dto.awayScore !== undefined ||
      dto.homeHalfScore !== undefined ||
      dto.awayHalfScore !== undefined ||
      dto.hitWdw !== undefined ||
      dto.hitHandicap !== undefined ||
      dto.hitOverunder !== undefined ||
      dto.matchStatus === 'finished';

    const scoreBlocked = notStarted && hasScoreOrHit && !dto.verifiedTwoSources;
    if (scoreBlocked) {
      this.logger.warn(
        `篮球写入保护(新建): 比赛 ${dto.matchNo} 开赛时间 ${kickoffDate.toISOString()} 在当前时间之后，忽略比分/命中字段`,
      );
    }
    return {
      matchNo: dto.matchNo,
      league: dto.league,
      homeTeam: dto.homeTeam,
      awayTeam: dto.awayTeam,
      kickoffTime: new Date(dto.kickoffTime),
      matchDate: dto.matchDate,
      businessDate: dto.businessDate ?? dto.matchDate,
      venue: dto.venue ?? '主场',
      homeWinProb: dto.homeWinProb ?? 0,
      awayWinProb: dto.awayWinProb ?? 0,
      predictionDirection: dto.predictionDirection ?? '',
      handicap: dto.handicap ?? '0',
      handicapCoverProb: dto.handicapCoverProb ?? 50,
      handicapRecommendation: dto.handicapRecommendation ?? '',
      handicapPick: dto.handicapPick,
      handicapPickProb: dto.handicapPickProb ?? 50,
      totalLine: dto.totalLine ?? '',
      overProb: dto.overProb ?? 50,
      underProb: dto.underProb ?? 50,
      totalDirection: dto.totalDirection ?? '',
      totalPick: dto.totalPick,
      totalPickProb: dto.totalPickProb ?? 50,
      predictedHomeScore: dto.predictedHomeScore ?? 0,
      predictedAwayScore: dto.predictedAwayScore ?? 0,
      confidence: dto.confidence ?? 0,
      intel: dto.intel ?? '',
      riskWarning: dto.riskWarning ?? '',
      matchStatus: scoreBlocked ? 'upcoming' : (dto.matchStatus ?? 'upcoming'),
      homeScore: scoreBlocked ? null : (dto.homeScore ?? null),
      awayScore: scoreBlocked ? null : (dto.awayScore ?? null),
      hitWdw: scoreBlocked ? null : (dto.hitWdw ?? null),
      hitHandicap: scoreBlocked ? null : (dto.hitHandicap ?? null),
      hitOverunder: scoreBlocked ? null : (dto.hitOverunder ?? null),
      isNeutral: dto.isNeutral ?? false,
      category: dto.category ?? 'official',
      handicapOddsHome: dto.handicapOddsHome != null ? String(dto.handicapOddsHome) : null,
      handicapOddsAway: dto.handicapOddsAway != null ? String(dto.handicapOddsAway) : null,
      totalOddsOver: dto.totalOddsOver != null ? String(dto.totalOddsOver) : null,
      totalOddsUnder: dto.totalOddsUnder != null ? String(dto.totalOddsUnder) : null,
      homeWinOdds: dto.homeWinOdds != null ? String(dto.homeWinOdds) : null,
      awayWinOdds: dto.awayWinOdds != null ? String(dto.awayWinOdds) : null,
      spreadProb15: dto.spreadProb1_5 ?? 20,
      spreadProb610: dto.spreadProb6_10 ?? 20,
      spreadProb1115: dto.spreadProb11_15 ?? 20,
      spreadProb1620: dto.spreadProb16_20 ?? 20,
      spreadProb21Plus: dto.spreadProb21Plus ?? 20,
      spreadTopRange: dto.spreadTopRange,
      modelRules: dto.modelRules ?? [],
      handicapLineNum: dto.handicapLineNum != null ? String(dto.handicapLineNum) : null,
      totalLineNum: dto.totalLineNum != null ? String(dto.totalLineNum) : null,
      predHtHome: dto.predHtHome ?? 0,
      predHtAway: dto.predHtAway ?? 0,
      intelSummary: dto.intelSummary ?? '',
      upsetWarning: dto.upsetWarning ?? '',
      homeHalfScore: dto.homeHalfScore ?? null,
      awayHalfScore: dto.awayHalfScore ?? null,
      predictedTotal: dto.predictedTotal != null ? String(dto.predictedTotal) : null,
      ouConfidence: dto.ouConfidence,
      ouDiffVsLine: dto.ouDiffVsLine != null ? String(dto.ouDiffVsLine) : null,
      rulesTriggered: dto.rulesTriggered ? JSON.parse(JSON.stringify(dto.rulesTriggered)) : [],
      handicapConfidence: dto.handicapConfidence,
      teamNews: dto.teamNews ?? '',
      injuries: dto.injuries ? this.sanitizeInjuries(dto.injuries, dto.homeTeam ?? '', dto.awayTeam ?? '', dto.matchNo ?? '') : '',
      mediaConsensus: dto.mediaConsensus ?? '',
      expertPicks: dto.expertPicks ?? '',
      keyPlayers: dto.keyPlayers ?? '',
      intelUpdatedAt: now,
      dataUpdatedAt: now,
      updatedAt: now,
      liveScoreSource: '',
    };
  }

  private buildBasketballIncrementalPatch(
    dto: CreateBasketballMatchRequest,
  ): Partial<typeof basketballMatches.$inferInsert> {
    const patch: Partial<typeof basketballMatches.$inferInsert> = {};
    if (dto.matchNo !== undefined) patch.matchNo = dto.matchNo;
    if (dto.league !== undefined) patch.league = dto.league;
    if (dto.homeTeam !== undefined) patch.homeTeam = dto.homeTeam;
    if (dto.awayTeam !== undefined) patch.awayTeam = dto.awayTeam;
    if (dto.kickoffTime !== undefined) patch.kickoffTime = new Date(dto.kickoffTime);
    if (dto.matchDate !== undefined) patch.matchDate = dto.matchDate;
    if (dto.businessDate !== undefined) patch.businessDate = dto.businessDate;
    if (dto.venue !== undefined) patch.venue = dto.venue;
    if (dto.homeWinProb !== undefined) patch.homeWinProb = dto.homeWinProb;
    if (dto.awayWinProb !== undefined) patch.awayWinProb = dto.awayWinProb;
    if (dto.predictionDirection !== undefined) patch.predictionDirection = dto.predictionDirection;
    if (dto.handicap !== undefined) patch.handicap = dto.handicap;
    if (dto.handicapCoverProb !== undefined) patch.handicapCoverProb = dto.handicapCoverProb;
    if (dto.handicapRecommendation !== undefined) patch.handicapRecommendation = dto.handicapRecommendation;
    if (dto.handicapPick !== undefined) patch.handicapPick = dto.handicapPick;
    if (dto.handicapPickProb !== undefined) patch.handicapPickProb = dto.handicapPickProb;
    if (dto.totalLine !== undefined) patch.totalLine = dto.totalLine;
    if (dto.overProb !== undefined) patch.overProb = dto.overProb;
    if (dto.underProb !== undefined) patch.underProb = dto.underProb;
    if (dto.totalDirection !== undefined) patch.totalDirection = dto.totalDirection;
    if (dto.totalPick !== undefined) patch.totalPick = dto.totalPick;
    if (dto.totalPickProb !== undefined) patch.totalPickProb = dto.totalPickProb;
    if (dto.predictedHomeScore !== undefined) patch.predictedHomeScore = dto.predictedHomeScore;
    if (dto.predictedAwayScore !== undefined) patch.predictedAwayScore = dto.predictedAwayScore;
    if (dto.confidence !== undefined) patch.confidence = dto.confidence;
    if (dto.intel !== undefined) patch.intel = dto.intel;
    if (dto.riskWarning !== undefined) patch.riskWarning = dto.riskWarning;
    if (dto.matchStatus !== undefined) patch.matchStatus = dto.matchStatus;
    if (dto.homeScore !== undefined) patch.homeScore = dto.homeScore;
    if (dto.awayScore !== undefined) patch.awayScore = dto.awayScore;
    if (dto.hitWdw !== undefined) patch.hitWdw = dto.hitWdw;
    if (dto.hitHandicap !== undefined) patch.hitHandicap = dto.hitHandicap;
    if (dto.hitOverunder !== undefined) patch.hitOverunder = dto.hitOverunder;
    if (dto.isNeutral !== undefined) patch.isNeutral = dto.isNeutral;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.handicapOddsHome !== undefined) {
      patch.handicapOddsHome = dto.handicapOddsHome != null ? String(dto.handicapOddsHome) : null;
    }
    if (dto.handicapOddsAway !== undefined) {
      patch.handicapOddsAway = dto.handicapOddsAway != null ? String(dto.handicapOddsAway) : null;
    }
    if (dto.totalOddsOver !== undefined) {
      patch.totalOddsOver = dto.totalOddsOver != null ? String(dto.totalOddsOver) : null;
    }
    if (dto.totalOddsUnder !== undefined) {
      patch.totalOddsUnder = dto.totalOddsUnder != null ? String(dto.totalOddsUnder) : null;
    }
    if (dto.homeWinOdds !== undefined) {
      patch.homeWinOdds = dto.homeWinOdds != null ? String(dto.homeWinOdds) : null;
    }
    if (dto.awayWinOdds !== undefined) {
      patch.awayWinOdds = dto.awayWinOdds != null ? String(dto.awayWinOdds) : null;
    }
    if (dto.spreadProb1_5 !== undefined) patch.spreadProb15 = dto.spreadProb1_5;
    if (dto.spreadProb6_10 !== undefined) patch.spreadProb610 = dto.spreadProb6_10;
    if (dto.spreadProb11_15 !== undefined) patch.spreadProb1115 = dto.spreadProb11_15;
    if (dto.spreadProb16_20 !== undefined) patch.spreadProb1620 = dto.spreadProb16_20;
    if (dto.spreadProb21Plus !== undefined) patch.spreadProb21Plus = dto.spreadProb21Plus;
    if (dto.spreadTopRange !== undefined) patch.spreadTopRange = dto.spreadTopRange;
    if (dto.modelRules !== undefined) patch.modelRules = dto.modelRules;
    if (dto.handicapLineNum !== undefined && dto.handicapLineNum != null) {
      const hNum = Number(dto.handicapLineNum);
      if (hNum !== 0 && !Number.isNaN(hNum)) {
        patch.handicapLineNum = String(hNum);
      }
    }
    if (dto.totalLineNum !== undefined && dto.totalLineNum != null) {
      const tNum = Number(dto.totalLineNum);
      if (tNum !== 0 && !Number.isNaN(tNum)) {
        patch.totalLineNum = String(tNum);
      }
    }
    if (dto.predHtHome !== undefined) patch.predHtHome = dto.predHtHome;
    if (dto.predHtAway !== undefined) patch.predHtAway = dto.predHtAway;
    if (dto.intelSummary !== undefined) patch.intelSummary = dto.intelSummary;
    if (dto.upsetWarning !== undefined) patch.upsetWarning = dto.upsetWarning;
    if (dto.homeHalfScore !== undefined) patch.homeHalfScore = dto.homeHalfScore;
    if (dto.awayHalfScore !== undefined) patch.awayHalfScore = dto.awayHalfScore;
    if (dto.predictedTotal !== undefined) {
      patch.predictedTotal = dto.predictedTotal != null ? String(dto.predictedTotal) : null;
    }
    if (dto.ouConfidence !== undefined) patch.ouConfidence = dto.ouConfidence;
    if (dto.ouDiffVsLine !== undefined) {
      patch.ouDiffVsLine = dto.ouDiffVsLine != null ? String(dto.ouDiffVsLine) : null;
    }
    if (dto.rulesTriggered !== undefined) {
      patch.rulesTriggered = JSON.parse(JSON.stringify(dto.rulesTriggered));
    }
    if (dto.handicapConfidence !== undefined) patch.handicapConfidence = dto.handicapConfidence;
    if (dto.teamNews !== undefined) patch.teamNews = dto.teamNews;
    if (dto.injuries !== undefined) {
      patch.injuries = dto.injuries
        ? this.sanitizeInjuries(dto.injuries, dto.homeTeam ?? '', dto.awayTeam ?? '', dto.matchNo ?? '')
        : dto.injuries;
    }
    if (dto.mediaConsensus !== undefined) patch.mediaConsensus = dto.mediaConsensus;
    if (dto.expertPicks !== undefined) patch.expertPicks = dto.expertPicks;
    if (dto.keyPlayers !== undefined) patch.keyPlayers = dto.keyPlayers;
    if (dto.teamNews !== undefined || dto.injuries !== undefined || dto.mediaConsensus !== undefined || dto.expertPicks !== undefined || dto.keyPlayers !== undefined) {
      patch.intelUpdatedAt = new Date();
    }

    const kickoffDate = new Date(dto.kickoffTime);
    const now = new Date();
    const notStarted = kickoffDate.getTime() > now.getTime();
    const scoreOrHitIncoming =
      dto.homeScore !== undefined ||
      dto.awayScore !== undefined ||
      dto.homeHalfScore !== undefined ||
      dto.awayHalfScore !== undefined ||
      dto.hitWdw !== undefined ||
      dto.hitHandicap !== undefined ||
      dto.hitOverunder !== undefined ||
      dto.matchStatus === 'finished';

    if (notStarted && scoreOrHitIncoming && !dto.verifiedTwoSources) {
      this.logger.warn(
        `篮球写入保护: 比赛 ${dto.matchNo} (${dto.homeTeam}vs${dto.awayTeam}) 开赛时间 ${kickoffDate.toISOString()} 在当前时间之后，拒绝写入比分/命中/finished状态`,
      );
      delete patch.homeScore;
      delete patch.awayScore;
      delete patch.homeHalfScore;
      delete patch.awayHalfScore;
      delete patch.hitWdw;
      delete patch.hitHandicap;
      delete patch.hitOverunder;
      if (patch.matchStatus === 'finished') {
        patch.matchStatus = 'upcoming';
      }
    }

    return patch;
  }

  private async writeInitialBasketballOddsSnapshots(
    tx: PostgresJsDatabase,
    matchId: string,
    dto: CreateBasketballMatchRequest,
    source: string = 'batch-upsert',
  ): Promise<void> {
    const hLine = dto.handicapLineNum != null ? Number(dto.handicapLineNum) : NaN;
    const hOddsHome = dto.handicapOddsHome != null ? Number(dto.handicapOddsHome) : NaN;
    const hOddsAway = dto.handicapOddsAway != null ? Number(dto.handicapOddsAway) : NaN;
    if (!Number.isNaN(hLine) && !Number.isNaN(hOddsHome) && !Number.isNaN(hOddsAway)) {
      const hcData: BasketballOddsSnapshotHandicap = {
        home: hOddsHome,
        away: hOddsAway,
        line: hLine,
      };
      await insertBasketballOddsSnapshotIfChanged(tx, matchId, 'handicap', hcData, source);
    }
    const tLine = dto.totalLineNum != null ? Number(dto.totalLineNum) : NaN;
    const tOddsOver = dto.totalOddsOver != null ? Number(dto.totalOddsOver) : NaN;
    const tOddsUnder = dto.totalOddsUnder != null ? Number(dto.totalOddsUnder) : NaN;
    if (!Number.isNaN(tLine) && !Number.isNaN(tOddsOver) && !Number.isNaN(tOddsUnder)) {
      const tData: BasketballOddsSnapshotTotal = {
        over: tOddsOver,
        under: tOddsUnder,
        line: tLine,
      };
      await insertBasketballOddsSnapshotIfChanged(tx, matchId, 'total', tData, source);
    }
  }

  async batchUpsert(
    items: CreateBasketballMatchRequest[],
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

        for (const item of items) {
          const existing = await tx
            .select()
            .from(basketballMatches)
            .where(
              and(
                eq(basketballMatches.matchNo, item.matchNo),
                eq(basketballMatches.matchDate, item.matchDate),
              ),
            )
            .limit(1);

          if (existing.length === 0) {
             let values = this.buildBasketballInsertValues(item, userId);
             // 状态哨兵：新建时校验 match_status 与 kickoff_time 的时间关系
             const targetStatus = values.matchStatus || 'upcoming';
             if (values.kickoffTime && targetStatus !== 'upcoming') {
               const kickoffDate = values.kickoffTime instanceof Date
                 ? values.kickoffTime
                 : new Date(String(values.kickoffTime));
               const guard = await this.guardStatusTransition({
                 matchNo: values.matchNo,
                 source: values.source ?? undefined,
                 kickoffTime: kickoffDate,
                 targetStatus,
                 payload: { method: 'batchUpsert-insert' },
               });
               if (!guard.allowed) {
                 values = { ...values, matchStatus: 'upcoming' };
               }
             }
             const [insertedRow] = await tx.insert(basketballMatches).values(values).returning({ id: basketballMatches.id });
             if (insertedRow) {
               await this.writeInitialBasketballOddsSnapshots(tx, insertedRow.id, item);
             }
             inserted += 1;
           } else {
             const patch = this.buildBasketballIncrementalPatch(item);
             if (Object.keys(patch).length > 0) {
               // data-driven 预测守卫：batchUpsert 调用方来源混杂，默认视为非 data-driven
               if (shouldSkipPredictionWrite(
                 existing[0].predEngineVersion,
                 existing[0].matchStatus,
                 'batch-upsert',
               )) {
                 stripPredictionFieldsFromPatch(
                   patch as Record<string, unknown>,
                 );
               }
                // 状态哨兵：状态流转时间守护
                if (patch.matchStatus && existing[0].kickoffTime) {
                  const kickoffDate = existing[0].kickoffTime instanceof Date
                    ? existing[0].kickoffTime
                    : new Date(String(existing[0].kickoffTime));
                  const guard = await this.guardStatusTransition({
                    matchId: existing[0].id,
                    matchNo: existing[0].matchNo,
                    source: existing[0].source ?? undefined,
                    kickoffTime: kickoffDate,
                    targetStatus: patch.matchStatus,
                    currentStatus: existing[0].matchStatus,
                    payload: { method: 'batchUpsert', itemMatchNo: item.matchNo },
                  });
                  if (!guard.allowed) {
                    delete patch.matchStatus;
                    if (patch.homeScore !== undefined) patch.homeScore = existing[0].homeScore;
                    if (patch.awayScore !== undefined) patch.awayScore = existing[0].awayScore;
                  }
                }

                // 状态哨兵：让分符号一致性校验（主客翻转场景）
                if (patch.handicapLineNum !== undefined && patch.handicapLineNum !== null
                    && (patch.homeTeam !== undefined || patch.awayTeam !== undefined)) {
                  const newHome = (patch.homeTeam ?? existing[0].homeTeam) || '';
                  const newAway = (patch.awayTeam ?? existing[0].awayTeam) || '';
                  const prevLine = existing[0].handicapLineNum != null
                    ? Number(existing[0].handicapLineNum)
                    : undefined;
                  const newLine = Number(patch.handicapLineNum);
                  const signGuard = await this.validateHandicapSign({
                    matchId: existing[0].id,
                    matchNo: existing[0].matchNo,
                    homeTeam: newHome,
                    awayTeam: newAway,
                    handicapLineNum: newLine,
                    evidenceSource: existing[0].source ?? 'batch-upsert-unknown',
                    prevHomeTeam: existing[0].homeTeam ?? undefined,
                    prevAwayTeam: existing[0].awayTeam ?? undefined,
                    prevHandicapLine: prevLine,
                  });
                  if (!signGuard.allowed) {
                    delete patch.handicapLineNum;
                    if (patch.handicap !== undefined) delete patch.handicap;
                  }
                }

                if (Object.keys(patch).length > 0) {
                  patch.dataUpdatedAt = now;
                  patch.updatedAt = now;
                  this.sportteryService.appendBasketballPredictionHistory(patch, 'admin_manual_update');
                  await tx
                    .update(basketballMatches)
                    .set(patch)
                    .where(eq(basketballMatches.id, existing[0].id));
                  updated += 1;
                }
              }
            }
          }

          return { inserted, updated, total: inserted + updated };
        });

        this.logger.log(
          `篮球批量upsert完成: inserted=${result.inserted}, updated=${result.updated}, total=${result.total}`,
        );
        return result;
      } catch (error) {
        this.logger.error('篮球批量upsert失败', JSON.stringify(error));
        throw error;
      }
    }

  async batchUpsertWithValidation(
    items: CreateBasketballMatchRequest[],
    userId: string,
  ): Promise<BatchUpsertResponse> {
    if (!items || items.length === 0) {
      return { inserted: 0, updated: 0, total: 0 };
    }
    const tableName = 'basketball_matches';
    try {
      const result = await this.db.transaction(async (tx) => {
        const preStats = await this.computeBasketballDataCheckInTx(tx);

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

        for (const item of items) {
          const existing = await tx
            .select()
            .from(basketballMatches)
            .where(
              and(
                eq(basketballMatches.matchNo, item.matchNo),
                eq(basketballMatches.matchDate, item.matchDate),
              ),
            )
            .limit(1);

          if (existing.length === 0) {
            let values = this.buildBasketballInsertValues(item, userId);
            // 状态哨兵：新建时校验 match_status 与 kickoff_time 的时间关系
            const targetStatus = values.matchStatus || 'upcoming';
            if (values.kickoffTime && targetStatus !== 'upcoming') {
              const kickoffDate = values.kickoffTime instanceof Date
                ? values.kickoffTime
                : new Date(String(values.kickoffTime));
              const guard = await this.guardStatusTransition({
                matchNo: values.matchNo,
                source: values.source ?? undefined,
                kickoffTime: kickoffDate,
                targetStatus,
                payload: { method: 'batchUpsertWithValidation-insert' },
              });
              if (!guard.allowed) {
                values = { ...values, matchStatus: 'upcoming' };
              }
            }
            const [insertedRow] = await tx.insert(basketballMatches).values(values).returning({ id: basketballMatches.id });
            if (insertedRow) {
              await this.writeInitialBasketballOddsSnapshots(tx, insertedRow.id, item);
            }
            inserted += 1;
          } else {
            const patch = this.buildBasketballIncrementalPatch(item);
            if (Object.keys(patch).length > 0) {
              // data-driven 预测守卫：batchUpsert 调用方来源混杂，默认视为非 data-driven
              if (shouldSkipPredictionWrite(
                existing[0].predEngineVersion,
                existing[0].matchStatus,
                'batch-upsert',
              )) {
                stripPredictionFieldsFromPatch(
                  patch as Record<string, unknown>,
                );
              }
              // 状态哨兵：状态流转时间守护
              if (patch.matchStatus && existing[0].kickoffTime) {
                const kickoffDate = existing[0].kickoffTime instanceof Date
                  ? existing[0].kickoffTime
                  : new Date(String(existing[0].kickoffTime));
                const guard = await this.guardStatusTransition({
                  matchId: existing[0].id,
                  matchNo: existing[0].matchNo,
                  source: existing[0].source ?? undefined,
                  kickoffTime: kickoffDate,
                  targetStatus: patch.matchStatus,
                  currentStatus: existing[0].matchStatus,
                  payload: { method: 'batchUpsertWithValidation', itemMatchNo: item.matchNo },
                });
                if (!guard.allowed) {
                  delete patch.matchStatus;
                  if (patch.homeScore !== undefined) patch.homeScore = existing[0].homeScore;
                  if (patch.awayScore !== undefined) patch.awayScore = existing[0].awayScore;
                }
              }

              // 状态哨兵：让分符号一致性校验（主客翻转场景）
              if (patch.handicapLineNum !== undefined && patch.handicapLineNum !== null
                  && (patch.homeTeam !== undefined || patch.awayTeam !== undefined)) {
                const newHome = (patch.homeTeam ?? existing[0].homeTeam) || '';
                const newAway = (patch.awayTeam ?? existing[0].awayTeam) || '';
                const prevLine = existing[0].handicapLineNum != null
                  ? Number(existing[0].handicapLineNum)
                  : undefined;
                const newLine = Number(patch.handicapLineNum);
                const signGuard = await this.validateHandicapSign({
                  matchId: existing[0].id,
                  matchNo: existing[0].matchNo,
                  homeTeam: newHome,
                  awayTeam: newAway,
                  handicapLineNum: newLine,
                  evidenceSource: existing[0].source ?? 'batch-upsert-unknown',
                  prevHomeTeam: existing[0].homeTeam ?? undefined,
                  prevAwayTeam: existing[0].awayTeam ?? undefined,
                  prevHandicapLine: prevLine,
                });
                if (!signGuard.allowed) {
                  delete patch.handicapLineNum;
                  if (patch.handicap !== undefined) delete patch.handicap;
                }
              }

              if (Object.keys(patch).length > 0) {
                patch.dataUpdatedAt = now;
                patch.updatedAt = now;
                this.sportteryService.appendBasketballPredictionHistory(patch, 'admin_upsert_update');
                await tx
                  .update(basketballMatches)
                  .set(patch)
                  .where(eq(basketballMatches.id, existing[0].id));
                updated += 1;
              }
            }
          }
        }

        const postStats = await this.computeBasketballDataCheckInTx(tx);

        const issues: string[] = [];
        if (postStats.total < preStats.total) {
          issues.push(`总比赛数减少: ${preStats.total} -> ${postStats.total}`);
        }
        if (postStats.predictedCount < preStats.predictedCount) {
          issues.push(
            `有预测比赛数减少: ${preStats.predictedCount} -> ${postStats.predictedCount}`,
          );
        }
        if (preStats.emptyFieldsCount > 0) {
          const increaseRatio =
            (postStats.emptyFieldsCount - preStats.emptyFieldsCount) /
            preStats.emptyFieldsCount;
          if (increaseRatio > 0.2) {
            issues.push(
              `空字段数增幅超过20%: ${preStats.emptyFieldsCount} -> ${postStats.emptyFieldsCount}`,
            );
          }
        }

        if (issues.length > 0) {
          throw new BadRequestException(`数据校验失败: ${issues.join('; ')}`);
        }

        return { inserted, updated, total: inserted + updated };
      });

      this.logger.log(
        `篮球批量upsert+校验完成: inserted=${result.inserted}, updated=${result.updated}, total=${result.total}`,
      );

      void this.cleanupOldSnapshots(tableName).catch((err) => {
        this.logger.warn(`篮球清理旧快照失败: ${JSON.stringify(err)}`);
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('篮球批量upsert+校验失败', JSON.stringify(error));
      throw error;
    }
  }

  private async computeBasketballDataCheckInTx(
    tx: PostgresJsDatabase,
  ): Promise<{
    total: number;
    predictedCount: number;
    intelCount: number;
    emptyFieldsCount: number;
  }> {
    const table = basketballMatches;
    const summary = await tx
      .select({
        total: sql<number>`count(*)`,
        predictedCount: sql<number>`count(*) filter (where ${table.predictionDirection} is not null and ${table.predictionDirection} != '')`,
        intelCount: sql<number>`count(*) filter (where ${table.intel} is not null and ${table.intel} != '')`,
        emptyFieldsCount: sql<number>`count(*) filter (where (
          ${table.predictionDirection} is null or ${table.predictionDirection} = ''
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
      await this.db
        .delete(dataSnapshots)
        .where(
          sql`${dataSnapshots.id} = ANY(ARRAY[${sql.join(
            idsToDelete.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`,
        );
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
        await this.db
          .delete(dataSnapshots)
          .where(
            sql`${dataSnapshots.id} = ANY(ARRAY[${sql.join(
              idsToDelete.map((id) => sql`${id}`),
              sql`, `,
            )}]::uuid[])`,
          );
      }

      this.logger.log(
        `篮球创建快照 table=${tableName} snapshot=${snapshotName} total=${stats.total}`,
      );
      return stats;
    } catch (error) {
      this.logger.error(`篮球创建快照失败 table=${tableName}`, JSON.stringify(error));
      throw error;
    }
  }

  async runDataCheck(tableName: string): Promise<DataCheckResponse> {
    try {
      const table = basketballMatches;

      const summary = await this.db
        .select({
          total: sql<number>`count(*)`,
          predictedCount: sql<number>`count(*) filter (where ${table.predictionDirection} is not null and ${table.predictionDirection} != '')`,
          intelCount: sql<number>`count(*) filter (where ${table.intel} is not null and ${table.intel} != '')`,
          emptyFieldsCount: sql<number>`count(*) filter (where (
            ${table.predictionDirection} is null or ${table.predictionDirection} = ''
            or ${table.handicap} is null or ${table.handicap} = ''
            or ${table.confidence} is null or ${table.confidence} = 0
          ))`,
          finishedCount: sql<number>`count(*) filter (where ${table.matchStatus} = 'finished')`,
          upcomingCount: sql<number>`count(*) filter (where ${table.matchStatus} = 'upcoming')`,
          canceledCount: sql<number>`count(*) filter (where ${table.matchStatus} = 'canceled')`,
        })
        .from(table);

      const byDateRows = await this.db
        .select({
          matchDate: table.matchDate,
          total: sql<number>`count(*)`,
          predictedCount: sql<number>`count(*) filter (where ${table.predictionDirection} is not null and ${table.predictionDirection} != '')`,
          intelCount: sql<number>`count(*) filter (where ${table.intel} is not null and ${table.intel} != '')`,
          emptyFieldsCount: sql<number>`count(*) filter (where (
            ${table.predictionDirection} is null or ${table.predictionDirection} = ''
            or ${table.handicap} is null or ${table.handicap} = ''
            or ${table.confidence} is null or ${table.confidence} = 0
          ))`,
        })
        .from(table)
        .groupBy(table.matchDate)
        .orderBy(desc(table.matchDate));

      const byDate: DataCheckByDateItem[] = byDateRows.map((row) => ({
        date: String(row.matchDate),
        total: Number(row.total),
        predictedCount: Number(row.predictedCount),
        intelCount: Number(row.intelCount),
        emptyFieldsCount: Number(row.emptyFieldsCount),
      }));

      const row = summary[0];
      return {
        total: Number(row.total),
        predictedCount: Number(row.predictedCount),
        intelCount: Number(row.intelCount),
        emptyFieldsCount: Number(row.emptyFieldsCount),
        byDate,
        finishedCount: Number(row.finishedCount),
        upcomingCount: Number(row.upcomingCount),
        canceledCount: Number(row.canceledCount),
        integrity: [],
      };
    } catch (error) {
      this.logger.error(`篮球数据自检失败 table=${tableName}`, JSON.stringify(error));
      throw error;
    }
  }

  async cleanInvalidLines(): Promise<{
    total: number;
    totalInvalid: number;
    invalidSpread: Array<{ matchNo: string; league: string; line: number }>;
    invalidTotal: Array<{ matchNo: string; league: string; line: number }>;
  }> {
    const allRows = await this.db.select({
      id: basketballMatches.id,
      matchNo: basketballMatches.matchNo,
      league: basketballMatches.league,
      handicapLineNum: basketballMatches.handicapLineNum,
      totalLineNum: basketballMatches.totalLineNum,
      handicap: basketballMatches.handicap,
      totalLine: basketballMatches.totalLine,
      handicapRecommendation: basketballMatches.handicapRecommendation,
      totalDirection: basketballMatches.totalDirection,
      handicapCoverProb: basketballMatches.handicapCoverProb,
      overProb: basketballMatches.overProb,
      underProb: basketballMatches.underProb,
      handicapPick: basketballMatches.handicapPick,
      totalPick: basketballMatches.totalPick,
      handicapPickProb: basketballMatches.handicapPickProb,
      totalPickProb: basketballMatches.totalPickProb,
       handicapConfidence: basketballMatches.handicapConfidence,
       ouConfidence: basketballMatches.ouConfidence,
       ouDiffVsLine: basketballMatches.ouDiffVsLine,
       matchStatus: basketballMatches.matchStatus,
       predEngineVersion: basketballMatches.predEngineVersion,
     }).from(basketballMatches);

    let totalInvalid = 0;
    const invalidSpread: Array<{ matchNo: string; league: string; line: number }> = [];
    const invalidTotal: Array<{ matchNo: string; league: string; line: number }> = [];

    for (const row of allRows) {
      const league = row.league || 'default';
      const hcNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
      const totalNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
      const spreadValid = hcNum !== 0 && this.sportteryService.isBasketballLineValid(league, 'spread', hcNum);
      const totalValid = totalNum > 0 && this.sportteryService.isBasketballLineValid(league, 'total', totalNum);

      if (hcNum !== 0 && !spreadValid) {
        invalidSpread.push({ matchNo: row.matchNo, league, line: hcNum });
        totalInvalid += 1;
      }
      if (totalNum > 0 && !totalValid) {
        invalidTotal.push({ matchNo: row.matchNo, league, line: totalNum });
        totalInvalid += 1;
      }

       if (spreadValid && totalValid) continue;

       // data-driven 预测守卫：盘口清洗只重置线值，不重置预测方向/概率
       const skipPrediction = shouldSkipPredictionWrite(
         row.predEngineVersion,
         row.matchStatus,
         'clean-invalid-lines',
       );

       const patch: Record<string, unknown> = {};
       if (!spreadValid) {
         patch.handicap = null;
         patch.handicapLineNum = null;
         patch.handicapOddsHome = null;
         patch.handicapOddsAway = null;
         // data-driven 场次：只清空线值，不动预测字段（保留方向/概率）
         if (!skipPrediction) {
           patch.handicapRecommendation = '观望';
           patch.handicapPick = '观望';
           patch.handicapCoverProb = 50;
           patch.handicapPickProb = 50;
           patch.handicapConfidence = '低';
         }
       }
       if (!totalValid) {
         patch.totalLine = null;
         patch.totalLineNum = null;
         patch.totalOddsOver = null;
         patch.totalOddsUnder = null;
         // data-driven 场次：只清空线值，不动预测字段
         if (!skipPrediction) {
           patch.totalDirection = '观望';
           patch.totalPick = '观望';
           patch.overProb = 50;
           patch.underProb = 50;
           patch.totalPickProb = 50;
           patch.ouConfidence = '低';
           patch.ouDiffVsLine = '0';
         }
       }
       patch.updatedAt = sql`CURRENT_TIMESTAMP`;
       this.sportteryService.appendBasketballPredictionHistory(patch, 'clean_invalid_lines');
       await this.db.update(basketballMatches).set(patch).where(eq(basketballMatches.id, row.id));
    }

    return {
      total: allRows.length,
      totalInvalid,
      invalidSpread,
      invalidTotal,
    };
  }

  /**
   * 伤停球员归属校验：检查 injuries 中的球员名是否明显不属于主客两队。
   * 采用启发式：将球队名与伤停文本做简单的关键词匹配，
   * 若伤停条目前缀了明确的其他队名（如「水星Griner」出现在太阳vs天猫的比赛），则标记并丢弃。
   * 仅做防御性拦截，不做完备性校验（自由文本无法100%准确）。
   */
  private sanitizeInjuries(
    rawInjuries: string,
    homeTeam: string,
    awayTeam: string,
    matchNo: string,
  ): string {
    if (!rawInjuries) return rawInjuries;
    let cleaned: string = rawInjuries;
    let dropped: number = 0;
    const otherTeamPatterns: RegExp[] = [];
    const homeTokens = this.extractTeamTokens(homeTeam);
    const awayTokens = this.extractTeamTokens(awayTeam);
    for (const token of homeTokens) {
      otherTeamPatterns.push(new RegExp(`${token}[：:]?\s*[^
，,；;]+`, 'g'));
    }
    for (const token of awayTokens) {
      otherTeamPatterns.push(new RegExp(`${token}[：:]?\s*[^
，,；;]+`, 'g'));
    }
    const suspectPatterns = [
      /(水星|菲尼克斯水星|Mercury|凤凰城水星)[：:]?\s*[^\n，,；;]+/g,
      /(火花|洛杉矶火花|Sparks)[：:]?\s*[^\n，,；;]+/g,
      /(王牌|拉斯维加斯王牌|Aces)[：:]?\s*[^\n，,；;]+/g,
      /(风暴|西雅图风暴|Storm)[：:]?\s*[^\n，,；;]+/g,
      /(自由|纽约自由|Liberty)[：:]?\s*[^\n，,；;]+/g,
      /(天猫|明尼苏达天猫|Lynx)[：:]?\s*[^\n，,；;]+/g,
      /(梦想|亚特兰大梦想|Dream)[：:]?\s*[^\n，,；;]+/g,
      /(飞马|达拉斯飞马|Wings)[：:]?\s*[^\n，,；;]+/g,
      /(狂热|印第安纳狂热|Fever)[：:]?\s*[^\n，,；;]+/g,
      /(太阳|康涅狄格太阳|Sun)[：:]?\s*[^\n，,；;]+/g,
      /(天空|芝加哥天空|Sky)[：:]?\s*[^\n，,；;]+/g,
      /(神秘人|华盛顿神秘人|Mystics)[：:]?\s*[^\n，,；;]+/g,
    ];
    for (const pattern of suspectPatterns) {
      const matches = cleaned.match(pattern);
      if (!matches) continue;
      for (const m of matches) {
        const lowerM = m.toLowerCase();
        const homeLower = homeTeam.toLowerCase();
        const awayLower = awayTeam.toLowerCase();
        const belongsToHome = homeTokens.some((t: string) => lowerM.includes(t.toLowerCase()));
        const belongsToAway = awayTokens.some((t: string) => lowerM.includes(t.toLowerCase()));
        if (!belongsToHome && !belongsToAway) {
          cleaned = cleaned.replace(m, '');
          dropped += 1;
        }
      }
    }
    if (dropped > 0) {
      this.logger.warn(`[球员归属校验] ${matchNo} ${homeTeam}vs${awayTeam}: 丢弃 ${dropped} 条串队伤停`);
    }
    return cleaned;
  }

  private extractTeamTokens(teamName: string): string[] {
    const full = teamName.trim();
    const tokens: string[] = [full];
    const m = full.match(/[\u4e00-\u9fa5]{2,}$/);
    if (m) tokens.push(m[0]);
    const m2 = full.match(/^[\u4e00-\u9fa5]{2,4}(?=[\u4e00-\u9fa5]{2,}$)/);
    if (m2) tokens.push(m2[0]);
    return [...new Set(tokens.filter((t: string) => t.length >= 2))];
  }

  async backfillInjuryReportsFromEspn(): Promise<{ processed: number; inserted: number; skipped: number }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        injuries: basketballMatches.injuries,
        source: basketballMatches.source,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.source, 'espn'),
          isNotNull(basketballMatches.injuries),
          ne(basketballMatches.matchStatus, 'finished'),
          ne(basketballMatches.matchStatus, 'cancelled'),
        ),
      );

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!row.injuries) {
        skipped += 1;
        continue;
      }

      let parsed: unknown = row.injuries;
      if (typeof row.injuries === 'string') {
        try {
          parsed = JSON.parse(row.injuries);
        } catch {
          skipped += 1;
          continue;
        }
      }

      const obj = parsed as Record<string, unknown> | null;
      if (!obj || typeof obj !== 'object') {
        skipped += 1;
        continue;
      }

      const processSide = async (side: 'home' | 'away', arr: unknown) => {
        if (!Array.isArray(arr)) return;
        const teamName = side === 'home' ? row.homeTeam : row.awayTeam;
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          const p = item as Record<string, unknown>;
          const name = typeof p.playerName === 'string' ? p.playerName : (typeof p.name === 'string' ? p.name : '');
          if (!name) continue;
          const detail = typeof p.shortComment === 'string' ? p.shortComment : (typeof p.detail === 'string' ? p.detail : '');
          const status = typeof p.status === 'string' ? p.status : 'out';
          const position = typeof p.position === 'string' ? p.position : undefined;
          const rawImpact = typeof p.impact === 'string' ? p.impact : (typeof p.injuryType === 'string' ? p.injuryType : '');
          let impactRating: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
          const statusLower = status.toLowerCase();
          const rawImpactLower = rawImpact.toLowerCase();
          if (
            rawImpactLower.includes('high') ||
            statusLower.includes('out') ||
            statusLower.includes('赛季报销') ||
            statusLower.includes('报销') ||
            statusLower.includes('indefinitely') ||
            statusLower.includes('无限期')
          ) {
            impactRating = 'high';
          } else if (
            rawImpactLower.includes('medium') ||
            statusLower.includes('day-to-day') ||
            statusLower.includes('每日观察') ||
            statusLower.includes('questionable') ||
            statusLower.includes('出战成疑') ||
            statusLower.includes('doubtful') ||
            statusLower.includes('缺阵') ||
            statusLower.includes('缺席')
          ) {
            impactRating = 'medium';
          } else if (
            rawImpactLower.includes('low') ||
            statusLower.includes('probable') ||
            statusLower.includes('available') ||
            statusLower.includes('可以出战')
          ) {
            impactRating = 'low';
          }
          const expectedReturn = typeof p.expectedReturn === 'string' ? p.expectedReturn : undefined;
          const injuryType = typeof p.type === 'string' ? p.type : undefined;

          const existing = await this.db
            .select({ id: injuryReports.id })
            .from(injuryReports)
            .where(
              and(
                eq(injuryReports.matchId, row.id),
                eq(injuryReports.teamSide, side),
                eq(injuryReports.playerName, name),
                eq(injuryReports.sport, 'basketball'),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            await this.db
              .update(injuryReports)
              .set({
                status,
                shortComment: detail || null,
                impactRating,
                position: position || null,
                expectedReturn: expectedReturn || null,
                injuryType: injuryType || null,
                updatedAt: new Date(),
              })
              .where(eq(injuryReports.id, existing[0].id));
            processed += 1;
          } else {
            await this.db.insert(injuryReports).values({
              matchId: row.id,
              sport: 'basketball',
              teamSide: side,
              teamName: teamName || '',
              playerName: name,
              status,
              shortComment: detail || null,
              impactRating,
              position: position || null,
              expectedReturn: expectedReturn || null,
              injuryType: injuryType || null,
              dataSource: 'espn',
              source: 'espn_scoreboard',
            });
            inserted += 1;
            processed += 1;
          }
        }
      };

      await processSide('home', obj.home);
      await processSide('away', obj.away);
    }

    return { processed, inserted, skipped };
  }

  async computeLeagueHistoricalBaselines(): Promise<Map<string, { avgTotal: number; avgHome: number; avgAway: number; sampleSize: number; stdTotal: number }>> {
    const rows = await this.db
      .select({
        league: basketballMatches.league,
        sampleSize: count(),
        avgTotal: sql<number>`ROUND(AVG(${basketballMatches.homeScore} + ${basketballMatches.awayScore}), 2)`,
        avgHome: sql<number>`ROUND(AVG(${basketballMatches.homeScore}), 2)`,
        avgAway: sql<number>`ROUND(AVG(${basketballMatches.awayScore}), 2)`,
        stdTotal: sql<number>`ROUND(STDDEV(${basketballMatches.homeScore} + ${basketballMatches.awayScore}), 2)`,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'finished'),
          isNotNull(basketballMatches.homeScore),
          isNotNull(basketballMatches.awayScore),
        ),
      )
      .groupBy(basketballMatches.league);

    const map = new Map<string, { avgTotal: number; avgHome: number; avgAway: number; sampleSize: number; stdTotal: number }>();
    for (const r of rows) {
      if (!r.league) continue;
      const avgTotal = Number(r.avgTotal);
      const avgHome = Number(r.avgHome);
      const avgAway = Number(r.avgAway);
      const sampleSize = Number(r.sampleSize);
      const stdTotal = Number(r.stdTotal);
      if (Number.isFinite(avgTotal) && avgTotal > 0 && sampleSize > 0) {
        map.set(r.league, { avgTotal, avgHome, avgAway, sampleSize, stdTotal });
      }
    }
    return map;
  }

  // ---- V11 特征批量计算 ----

  /**
   * 批量计算多支球队的近期攻防数据（近10场/近20场均值）。
   * 单条SQL查出所有涉及球队的完赛记录，内存中按队聚合，避免N+1。
   */
  async computeTeamRecentStats(
    teamNames: string[],
    beforeKickoffTime?: Date,
    options?: { excludeLeagues?: string[]; enableFuzzy?: boolean },
  ): Promise<Map<string, TeamRecentStats>> {
    const validTeams = teamNames.filter((t) => t && t.length > 0);
    const uniqueTeams = Array.from(new Set(validTeams));
    const result = new Map<string, TeamRecentStats>();
    if (uniqueTeams.length === 0) return result;

    const excludeLeagues = options?.excludeLeagues ?? ['篮球季前赛', '篮球季前赛吉安赛区', '篮球季前赛宜宾赛区', '篮球中国赛', '篮球云南昆明站day2', '篮球决赛'];
    const enableFuzzy = options?.enableFuzzy ?? false;

    const conditions = [
      eq(basketballMatches.matchStatus, 'finished'),
      isNotNull(basketballMatches.homeScore),
      isNotNull(basketballMatches.awayScore),
      or(
        inArray(basketballMatches.homeTeam, uniqueTeams),
        inArray(basketballMatches.awayTeam, uniqueTeams),
      ),
    ];
    if (excludeLeagues.length > 0) {
      conditions.push(not(inArray(basketballMatches.league, excludeLeagues)));
    }
    if (beforeKickoffTime) {
      conditions.push(lt(basketballMatches.kickoffTime, beforeKickoffTime));
    }

    const rows = await this.db
      .select({
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(and(...conditions))
      .orderBy(desc(basketballMatches.kickoffTime));

    // 精确匹配命中的球队
    const matchedExact = new Set<string>();
    for (const row of rows) {
      if (row.homeTeam && uniqueTeams.includes(row.homeTeam)) matchedExact.add(row.homeTeam);
      if (row.awayTeam && uniqueTeams.includes(row.awayTeam)) matchedExact.add(row.awayTeam);
    }

    // 未命中的球队尝试归一化模糊匹配（仅启用时）
    const missingTeams = uniqueTeams.filter((t) => !matchedExact.has(t));
    let fuzzyRows: Array<{ homeTeam: string | null; awayTeam: string | null; homeScore: number | null; awayScore: number | null; kickoffTime: Date }> = [];
    if (enableFuzzy && missingTeams.length > 0) {
      const normTargets = new Map<string, string>();
      const keywords: string[] = [];
      for (const t of missingTeams) {
        const norm = normalizeBasketballTeamName(t);
        if (norm && norm.length >= 2) {
          normTargets.set(norm, t);
          const kw = norm.length <= 4 ? norm : norm.slice(-2);
          if (kw.length >= 2 && !keywords.includes(kw)) keywords.push(kw);
        }
      }
      if (keywords.length > 0) {
        const fuzzyConditions = [
          eq(basketballMatches.matchStatus, 'finished'),
          isNotNull(basketballMatches.homeScore),
          isNotNull(basketballMatches.awayScore),
          sql`${basketballMatches.homeScore} > 0`,
        ];
        if (beforeKickoffTime) {
          fuzzyConditions.push(lt(basketballMatches.kickoffTime, beforeKickoffTime));
        }
        const keywordOr = sql.join(
          keywords.map((kw) => sql`lower(${basketballMatches.homeTeam}) LIKE ${'%' + kw.toLowerCase() + '%'} OR lower(${basketballMatches.awayTeam}) LIKE ${'%' + kw.toLowerCase() + '%'}`),
          sql` OR `,
        );
        fuzzyConditions.push(keywordOr);
        fuzzyRows = await this.db
          .select({
            homeTeam: basketballMatches.homeTeam,
            awayTeam: basketballMatches.awayTeam,
            homeScore: basketballMatches.homeScore,
            awayScore: basketballMatches.awayScore,
            kickoffTime: basketballMatches.kickoffTime,
          })
          .from(basketballMatches)
          .where(and(...fuzzyConditions))
          .orderBy(desc(basketballMatches.kickoffTime))
          .limit(300);
      }
    }

    // 按队名分组：每场拆为主队视角+客队视角两条记录
    const byTeam = new Map<string, Array<{ ppg: number; oppg: number; pd: number; kickoffTime: Date }>>();
    const pushGame = (teamKey: string, ppg: number, oppg: number, pd: number, kt: Date) => {
      const arr = byTeam.get(teamKey) ?? [];
      arr.push({ ppg, oppg, pd, kickoffTime: kt });
      byTeam.set(teamKey, arr);
    };

    for (const row of rows) {
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      const kt = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime));
      if (row.homeTeam) pushGame(row.homeTeam, hs, as, hs - as, kt);
      if (row.awayTeam) pushGame(row.awayTeam, as, hs, as - hs, kt);
    }

    // 模糊匹配结果：用归一化名映射回原始竞彩队名
    const seenKeys = new Set<string>();
    for (const row of fuzzyRows) {
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      if (hs <= 0 && as <= 0) continue;
      const kt = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime));
      const hNorm = row.homeTeam ? normalizeBasketballTeamName(row.homeTeam) : '';
      const aNorm = row.awayTeam ? normalizeBasketballTeamName(row.awayTeam) : '';
      for (const origTeam of missingTeams) {
        const targetNorm = normalizeBasketballTeamName(origTeam);
        if (!targetNorm) continue;
        const isHomeMatch = hNorm === targetNorm;
        const isAwayMatch = aNorm === targetNorm;
        if (!isHomeMatch && !isAwayMatch) continue;
        const key = `${origTeam}_${row.homeTeam}_${row.awayTeam}_${kt.getTime()}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (isHomeMatch) {
          pushGame(origTeam, hs, as, hs - as, kt);
        }
        if (isAwayMatch) {
          pushGame(origTeam, as, hs, as - hs, kt);
        }
      }
    }

    // 每队按时间倒序取最近20场（已在SQL层整体倒序，这里直接取前20即可）
    for (const team of uniqueTeams) {
      const games = byTeam.get(team);
      if (!games || games.length === 0) continue;
      // 同一支球队的比赛可能来自主场或客场，混在一起按时间倒序取前20
      const sorted = games.sort(
        (a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime(),
      );
      const recent20 = sorted.slice(0, 20);
      const recent10 = sorted.slice(0, 10);
      const sampleCount = sorted.length;

      const avg = (arr: typeof recent20, field: 'ppg' | 'oppg' | 'pd'): number => {
        if (arr.length === 0) return 0;
        const sum = arr.reduce((s, g) => s + g[field], 0);
        return sum / arr.length;
      };

      result.set(team, {
        recent10Ppg: avg(recent10, 'ppg'),
        recent10Oppg: avg(recent10, 'oppg'),
        recent10Pd: avg(recent10, 'pd'),
        recent20Ppg: avg(recent20, 'ppg'),
        recent20Oppg: avg(recent20, 'oppg'),
        recent20Pd: avg(recent20, 'pd'),
        sampleCount,
      });
    }

    // NBA 球队本赛季常规赛样本不足时，用上赛季（2024-25）team_season_stats 作攻防基线兜底
    // 解决赛季初近期战绩为0导致大小分全部贴线的问题
    // 竞彩源队名是缩写（如"凯尔特人"），需用归一化+模糊匹配找到全名基线
    const nbaLowSampleTeams: string[] = [];
    for (const team of uniqueTeams) {
      const stats = result.get(team);
      if (!stats || stats.sampleCount < 5) {
        nbaLowSampleTeams.push(team);
      }
    }
    if (nbaLowSampleTeams.length > 0) {
      const allBaselines = await this.db
        .select({
          teamName: teamSeasonStats.teamName,
          ppg: teamSeasonStats.ppg,
          oppg: teamSeasonStats.oppg,
          gamesPlayed: teamSeasonStats.gamesPlayed,
          dataSource: teamSeasonStats.dataSource,
        })
        .from(teamSeasonStats)
        .where(
          and(
            eq(teamSeasonStats.league, 'NBA'),
            eq(teamSeasonStats.season, '2024-25'),
            eq(teamSeasonStats.sport, 'basketball'),
          ),
        );

      // 建立归一化名→基线的映射，便于匹配缩写
      const baselineByNorm = new Map<string, typeof allBaselines[0]>();
      const baselineByFull = new Map<string, typeof allBaselines[0]>();
      for (const b of allBaselines) {
        baselineByFull.set(b.teamName, b);
        const norm = normalizeBasketballTeamName(b.teamName);
        if (norm) baselineByNorm.set(norm, b);
        // 提取队名核心词（去掉城市），如"波士顿凯尔特人"→"凯尔特人"
        const lastTwo = b.teamName.slice(-3);
        if (lastTwo.length >= 2) baselineByNorm.set(lastTwo, b);
      }

      // 逐队匹配基线
      const matchedBaselines = new Map<string, typeof allBaselines[0]>();
      for (const team of nbaLowSampleTeams) {
        // 1. 精确匹配全名
        if (baselineByFull.has(team)) {
          matchedBaselines.set(team, baselineByFull.get(team)!);
          continue;
        }
        // 2. 归一化匹配
        const norm = normalizeBasketballTeamName(team);
        if (norm && baselineByNorm.has(norm)) {
          matchedBaselines.set(team, baselineByNorm.get(norm)!);
          continue;
        }
        // 3. 关键词包含匹配（竞彩缩写如"凯尔特人"匹配"波士顿凯尔特人"）
        let found = false;
        for (const b of allBaselines) {
          if (b.teamName.includes(team) || team.includes(b.teamName.slice(-3))) {
            matchedBaselines.set(team, b);
            found = true;
            break;
          }
        }
        if (found) continue;
      }

      for (const [team, row] of matchedBaselines) {
        const baselinePpg = Number(row.ppg) || 0;
        const baselineOppg = Number(row.oppg) || 0;
        const gamesPlayed = Number(row.gamesPlayed) || 0;
        if (baselinePpg <= 0 || baselineOppg <= 0 || gamesPlayed <= 0) continue;

        const existing = result.get(team);
        const currentSample = existing?.sampleCount ?? 0;

        // 上赛季82场作为recent20基线（模拟一整赛季的"长样本"，取15场样本权重）
        // 本赛季已有样本与上赛季基线融合：本赛季样本<5场时权重主要靠上赛季
        const effectiveSample = Math.max(currentSample, 15);
        const baselinePd = baselinePpg - baselineOppg;

        if (!existing || currentSample === 0) {
          result.set(team, {
            recent10Ppg: 0,
            recent10Oppg: 0,
            recent10Pd: 0,
            recent20Ppg: baselinePpg,
            recent20Oppg: baselineOppg,
            recent20Pd: baselinePd,
            sampleCount: effectiveSample,
          });
        } else {
          // 有少量本赛季样本：recent20 按本赛季样本 + 上赛季补全到20场的比例混合
          const seasonRatio = Math.min(currentSample / 20, 1);
          const baselineRatio = 1 - seasonRatio;
          const fused20Ppg = existing.recent20Ppg * seasonRatio + baselinePpg * baselineRatio;
          const fused20Oppg = existing.recent20Oppg * seasonRatio + baselineOppg * baselineRatio;
          const fused20Pd = existing.recent20Pd * seasonRatio + baselinePd * baselineRatio;
          result.set(team, {
            ...existing,
            recent20Ppg: fused20Ppg,
            recent20Oppg: fused20Oppg,
            recent20Pd: fused20Pd,
            sampleCount: effectiveSample,
          });
        }
      }
    }

    return result;
  }

  /**
   * 计算两队历史交锋数据（净胜分=主队视角）。
   * recent = 最近5场，historical = 全部历史；样本不足时返回 null。
   */
  async computeH2HStats(
    homeTeam: string,
    awayTeam: string,
    beforeKickoffTime?: Date,
  ): Promise<H2HStats> {
    if (!homeTeam || !awayTeam) {
      return { recentPd: null, recentCount: 0, historicalPd: null, historicalCount: 0 };
    }
    const conditions = [
      eq(basketballMatches.matchStatus, 'finished'),
      isNotNull(basketballMatches.homeScore),
      isNotNull(basketballMatches.awayScore),
      or(
        and(eq(basketballMatches.homeTeam, homeTeam), eq(basketballMatches.awayTeam, awayTeam)),
        and(eq(basketballMatches.homeTeam, awayTeam), eq(basketballMatches.awayTeam, homeTeam)),
      ),
    ];
    if (beforeKickoffTime) {
      conditions.push(lt(basketballMatches.kickoffTime, beforeKickoffTime));
    }

    const rows = await this.db
      .select({
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(and(...conditions))
      .orderBy(desc(basketballMatches.kickoffTime));

    // 所有净胜分以 homeTeam 视角计算（主队得分-客队得分，互换场次取反）
    const allPd: number[] = [];
    for (const row of rows) {
      const hs = Number(row.homeScore) || 0;
      const as = Number(row.awayScore) || 0;
      if (row.homeTeam === homeTeam) {
        allPd.push(hs - as);
      } else {
        allPd.push(as - hs); // 客队主场时，取反为主队视角
      }
    }

    const historicalCount = allPd.length;
    let historicalPd: number | null = null;
    if (historicalCount >= 5) {
      const sum = allPd.reduce((s, v) => s + v, 0);
      historicalPd = sum / historicalCount;
    }

    const recent = allPd.slice(0, 5);
    const recentCount = recent.length;
    let recentPd: number | null = null;
    if (recentCount >= 2) {
      const sum = recent.reduce((s, v) => s + v, 0);
      recentPd = sum / recentCount;
    }

    return { recentPd, recentCount, historicalPd, historicalCount };
  }

  private buildPlayoffSeriesGames(
    h2hHistory: unknown,
    homeTeam: string | null,
    awayTeam: string | null,
  ): Array<{ totalScore: number; totalLine: number; gameNumber: number }> {
    if (!Array.isArray(h2hHistory) || !homeTeam || !awayTeam) return [];
    const allTeams = new Set<string>();
    for (const g of h2hHistory) {
      const item = g as Record<string, unknown>;
      const gh = String(item.homeTeam || '');
      const ga = String(item.awayTeam || '');
      if (gh) allTeams.add(gh);
      if (ga) allTeams.add(ga);
    }
    const isPurePair = allTeams.size <= 2;
    const games: Array<{ totalScore: number; totalLine: number; gameNumber: number; kickoffTime: Date | null }> = [];
    const seenKeys = new Set<string>();
    for (const g of h2hHistory) {
      const item = g as Record<string, unknown>;
      const gHome = String(item.homeTeam || '');
      const gAway = String(item.awayTeam || '');
      const isSamePair = isPurePair ||
        (gHome === homeTeam && gAway === awayTeam) ||
        (gHome === awayTeam && gAway === homeTeam);
      if (!isSamePair) continue;
      const hs = Number(item.homeScore);
      const as = Number(item.awayScore);
      if (!hs || !as || hs < 20 || as < 20) continue;
      const totalScore = hs + as;
      const totalLine = Number(item.totalLine) || 0;
      let kickoffTime: Date | null = null;
      const dateVal = item.date ?? item.kickoffTime;
      if (dateVal) {
        const t = new Date(dateVal as string);
        if (!isNaN(t.getTime())) kickoffTime = t;
      }
      const dedupKey = kickoffTime
        ? `${kickoffTime.toISOString().slice(0, 10)}|${gHome}|${gAway}|${hs}|${as}`
        : `${gHome}|${gAway}|${hs}|${as}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);
      games.push({ totalScore, totalLine, gameNumber: 0, kickoffTime });
    }
    if (games.length < 2) return [];
    games.sort((a, b) => {
      if (a.kickoffTime && b.kickoffTime) return a.kickoffTime.getTime() - b.kickoffTime.getTime();
      return 0;
    });
    return games.map((g, idx) => ({ totalScore: g.totalScore, totalLine: g.totalLine, gameNumber: idx + 1 }));
  }

  /**
   * 批量构建比赛特征 Map（近期战绩 + H2H），供 predict 调用使用。
   */
  async buildMatchFeatures(
    matches: Array<{ id: string; homeTeam?: string | null; awayTeam?: string | null; kickoffTime?: Date | string | null }>,
    _historicalBaselines?: Map<string, unknown>,
  ): Promise<Map<string, MatchFeatures>> {
    const result = new Map<string, MatchFeatures>();
    if (matches.length === 0) return result;

    // 收集所有球队名，一次性批量查询
    const teamSet = new Set<string>();
    for (const m of matches) {
      if (m.homeTeam) teamSet.add(m.homeTeam);
      if (m.awayTeam) teamSet.add(m.awayTeam);
    }
    const teamNames = Array.from(teamSet);
    const recentStats = await this.computeTeamRecentStats(teamNames, undefined, { enableFuzzy: false });

    // 每场比赛单独算H2H
    for (const m of matches) {
      const features: MatchFeatures = {};
      const ht = m.homeTeam || '';
      const at = m.awayTeam || '';

      const homeStats = ht ? recentStats.get(ht) : undefined;
      const awayStats = at ? recentStats.get(at) : undefined;

      if (homeStats) {
        features.recent10HomePpg = homeStats.recent10Ppg;
        features.recent10HomeOppg = homeStats.recent10Oppg;
        features.recent20HomePpg = homeStats.recent20Ppg;
        features.recent20HomeOppg = homeStats.recent20Oppg;
      }
      if (awayStats) {
        features.recent10AwayPpg = awayStats.recent10Ppg;
        features.recent10AwayOppg = awayStats.recent10Oppg;
        features.recent20AwayPpg = awayStats.recent20Ppg;
        features.recent20AwayOppg = awayStats.recent20Oppg;
      }
      if (homeStats && awayStats) {
        features.recentSampleCount = Math.min(homeStats.sampleCount, awayStats.sampleCount);
      } else if (homeStats) {
        features.recentSampleCount = homeStats.sampleCount;
      } else if (awayStats) {
        features.recentSampleCount = awayStats.sampleCount;
      }

      result.set(m.id, features);
    }

    // H2H 逐场查（场次不多，直接串行；后续可优化为批量）
    for (const m of matches) {
      const ht = m.homeTeam || '';
      const at = m.awayTeam || '';
      if (!ht || !at) continue;
      const beforeTime = m.kickoffTime
        ? (m.kickoffTime instanceof Date ? m.kickoffTime : new Date(String(m.kickoffTime)))
        : undefined;
      const h2h = await this.computeH2HStats(ht, at, beforeTime);
      const features = result.get(m.id) ?? {};
      features.h2hRecent = h2h.recentPd ?? undefined;
      features.h2hHistorical = h2h.historicalPd ?? undefined;
      features.h2hRecentCount = h2h.recentCount;
      features.h2hHistoricalCount = h2h.historicalCount;
      result.set(m.id, features);
    }

    return result;
  }

  async debugV113ForMatch(matchNo: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select()
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.matchNo, matchNo),
        eq(basketballMatches.source, 'sporttery'),
      ))
      .limit(1);
    if (rows.length === 0) return { error: 'Match not found' };
    const row = rows[0];

    let freshWeightedInjuriesHome = 0;
    let freshWeightedInjuriesAway = 0;
    let freshCoreInjuriesHome = 0;
    let freshCoreInjuriesAway = 0;
    const parseTrace: string[] = [];

    if (row.injuries && typeof row.injuries === 'object' && !Array.isArray(row.injuries)) {
      const injObj = row.injuries as Record<string, unknown>;
      const LONG_TERM_DAYS = 10;
      const kickoffMs = row.kickoffTime ? new Date(row.kickoffTime).getTime() : Date.now();
      const parseFreshWeighted = (list: unknown, side: string): { weighted: number; core: number } => {
        if (!Array.isArray(list)) { parseTrace.push(`${side}: not array, type=${typeof list}`); return { weighted: 0, core: 0 }; }
        let w = 0;
        let c = 0;
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const o = item as Record<string, unknown>;
          const name = String(o.playerName || o.name || 'unknown');
          const status = String(o.status || '').toLowerCase();
          const comment = String(o.shortComment || o.comment || '').toLowerCase();
          const dateStr = String(o.injuryDate || o.date || '');
          let weight = 0.3;
          let isCore = false;
          if (status.includes('out') || status.includes('赛季报销') || status.includes('报销')
            || status.includes('indefinitely') || /核心|主力|star|starter/.test(comment)) {
            weight = 1.0;
            isCore = true;
          } else if (status.includes('questionable') || status.includes('doubtful')
            || status.includes('出战成疑') || status.includes('day-to-day') || status.includes('缺阵')) {
            weight = 0.5;
            isCore = false;
          } else if (status.includes('probable') || status.includes('available')) {
            weight = 0.2;
            isCore = false;
          }
          const injDate = dateStr ? new Date(dateStr).getTime() : null;
          const daysSince = injDate && !Number.isNaN(injDate) ? (kickoffMs - injDate) / (24 * 60 * 60 * 1000) : 0;
          const isSeasonOut = /赛季报销|season[\s-]*ending|out[\s-]*for[\s-]*the[\s-]*season|out[\s-]*indefinitely|indefinitely|out.*season(?!\s*opener|\s*debut)|miss.*(the\s+)?season|for\s+the\s+rest\s+of\s+the\s+season|achilles\s+(surgery|repair|rupture)|torn\s+(acl|achilles|meniscus|ligament|rotator\s+cuff)|acl\s+(surgery|tear|torn|reconstruction)|rupture|fracture|broken\s+(bone|leg|arm|foot|hand|wrist)|out\s+(6|8|10|12|16)\s*weeks|out\s+\d+\s*months|year(s)?\s+out/.test(comment);
          const isLongTerm = isSeasonOut || (daysSince > LONG_TERM_DAYS && /out|长期|无限期/.test(status));
          parseTrace.push(`${side}-${name}: status=${status}, weight=${weight}, core=${isCore}, daysSince=${daysSince.toFixed(1)}, longTerm=${isLongTerm}`);
          if (!isLongTerm) {
            w += weight;
            if (isCore) c += 1;
          }
        }
        return { weighted: Math.round(w * 10) / 10, core: c };
      };
      const hFresh = parseFreshWeighted(injObj.home, 'home');
      const aFresh = parseFreshWeighted(injObj.away, 'away');
      freshWeightedInjuriesHome = hFresh.weighted;
      freshWeightedInjuriesAway = aFresh.weighted;
      freshCoreInjuriesHome = hFresh.core;
      freshCoreInjuriesAway = aFresh.core;
    } else {
      parseTrace.push(`injuries invalid: type=${typeof row.injuries}, isArray=${Array.isArray(row.injuries)}`);
    }

    const handicapLineNumVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
    const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;

    const result = this.anchorPrediction.predict({
      handicapLineNum: handicapLineNumVal || null,
      totalLineNum: totalLineNum > 0 ? totalLineNum : null,
      league: row.league || 'default',
      kickoffMonth: row.kickoffTime ? (new Date(row.kickoffTime)).getMonth() + 1 : 10,
      homePpg: 85,
      awayPpg: 80,
      homeOppg: 82,
      awayOppg: 84,
      leagueAvgPpg: 165,
      stage: '',
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      coreInjuriesHome: freshCoreInjuriesHome,
      coreInjuriesAway: freshCoreInjuriesAway,
      weightedInjuriesHome: freshCoreInjuriesHome,
      weightedInjuriesAway: freshCoreInjuriesAway,
      freshCoreInjuriesHome,
      freshCoreInjuriesAway,
      freshWeightedInjuriesHome,
      freshWeightedInjuriesAway,
      favoriteTeamSide: handicapLineNumVal < 0 ? 'home' : 'away',
      favoriteCoreInjuries: handicapLineNumVal < 0 ? freshCoreInjuriesHome : freshCoreInjuriesAway,
    });

    return {
      matchNo: row.matchNo,
      league: row.league,
      handicapLineNum: handicapLineNumVal,
      totalLineNum,
      freshWeightedHome: freshWeightedInjuriesHome,
      freshWeightedAway: freshWeightedInjuriesAway,
      freshCoreHome: freshCoreInjuriesHome,
      freshCoreAway: freshCoreInjuriesAway,
      predEngineVersion: result.predEngineVersion,
      injuryAdjustApplied: result.injuryAdjustApplied,
      predictionDirection: result.predictionDirection,
      totalDirection: result.totalDirection,
      trace: parseTrace,
    };
  }

  debugV113Prediction(input: {
    handicapLineNum: number;
    totalLineNum: number;
    league: string;
    freshWeightedHome: number;
    freshWeightedAway: number;
    coreHome: number;
    coreAway: number;
  }): Record<string, unknown> {
    const result = this.anchorPrediction.predict({
      handicapLineNum: input.handicapLineNum,
      totalLineNum: input.totalLineNum,
      league: input.league,
      kickoffMonth: 10,
      homePpg: 85,
      awayPpg: 80,
      homeOppg: 82,
      awayOppg: 84,
      leagueAvgPpg: 165,
      stage: '',
      homeTeam: 'Home Team',
      awayTeam: 'Away Team',
      coreInjuriesHome: input.coreHome,
      coreInjuriesAway: input.coreAway,
      weightedInjuriesHome: input.coreHome,
      weightedInjuriesAway: input.coreAway,
      freshCoreInjuriesHome: input.coreHome,
      freshCoreInjuriesAway: input.coreAway,
      freshWeightedInjuriesHome: input.freshWeightedHome,
      freshWeightedInjuriesAway: input.freshWeightedAway,
      favoriteTeamSide: input.handicapLineNum < 0 ? 'home' : 'away',
      favoriteCoreInjuries: input.handicapLineNum < 0 ? input.coreHome : input.coreAway,
    });
    return {
      predEngineVersion: result.predEngineVersion,
      injuryAdjustApplied: result.injuryAdjustApplied,
      predictionDirection: result.predictionDirection,
      handicapRecommendation: result.handicapRecommendation,
      totalDirection: result.totalDirection,
      homeWinProb: result.homeWinProb,
      awayWinProb: result.awayWinProb,
      modelRules: result.modelRules.slice(-10),
    };
  }

  async recalcUpcomingPredictions(): Promise<{ recalculated: number; skipped: number; errors: number }> {
    this.logger.error('[RECALC-START] recalcUpcomingPredictions called');
    const rows = await this.db.select()
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
          eq(basketballMatches.isPredictionFrozen, false),
          gt(basketballMatches.kickoffTime, sql`NOW() + INTERVAL '10 minutes'`),
        ),
      );

    const srcCounts: Record<string, number> = {};
    for (const r of rows) {
      const s = r.source ?? 'null';
      srcCounts[s] = (srcCounts[s] ?? 0) + 1;
    }
    this.logger.log(`[ROWS-DEBUG] total=${rows.length}, sources: ${JSON.stringify(srcCounts)}`);

    const historicalBaselines = await this.computeLeagueHistoricalBaselines();

    const eloTeams: Array<{ teamName: string }> = [];
    for (const r of rows) {
      if (r.homeTeam) eloTeams.push({ teamName: r.homeTeam });
      if (r.awayTeam) eloTeams.push({ teamName: r.awayTeam });
    }
    const eloMap = await this.eloHistoryService.getTeamRatings('basketball', eloTeams);

    const matchIds = rows.map((r) => r.id).filter(Boolean);
    const injuryRows = matchIds.length > 0
      ? await this.db
          .select({
            matchId: injuryReports.matchId,
            teamSide: injuryReports.teamSide,
            impactRating: injuryReports.impactRating,
            injuryDate: injuryReports.injuryDate,
          })
          .from(injuryReports)
          .where(inArray(injuryReports.matchId, matchIds))
      : [];
     type InjuryRowWithDate = { matchId: string | null; teamSide: string; impactRating: string; injuryDate: Date | null };
     type InjuryAgg = { homeHigh: number; homeMed: number; homeLow: number; awayHigh: number; awayMed: number; awayLow: number };
     const injuryMap = new Map<string, InjuryAgg>();
     const freshCutoffMs = 21 * 24 * 60 * 60 * 1000;
     for (const ir of injuryRows) {
       if (!ir.matchId) continue;
       const injDate = (ir as InjuryRowWithDate).injuryDate;
       const kickoffTime = rows.find((r: typeof rows[number]) => r.id === ir.matchId)?.kickoffTime;
const isFresh = !injDate
          ? true
          : kickoffTime
            ? kickoffTime.getTime() - new Date(injDate).getTime() <= freshCutoffMs
            : true;
       if (!isFresh) continue;
       const agg = injuryMap.get(ir.matchId) ?? { homeHigh: 0, homeMed: 0, homeLow: 0, awayHigh: 0, awayMed: 0, awayLow: 0 };
       const isHigh = ir.impactRating === 'high';
       const isMed = ir.impactRating === 'medium';
       if (ir.teamSide === 'home') {
         if (isHigh) agg.homeHigh += 1;
         else if (isMed) agg.homeMed += 1;
         else agg.homeLow += 1;
       } else if (ir.teamSide === 'away') {
         if (isHigh) agg.awayHigh += 1;
         else if (isMed) agg.awayMed += 1;
         else agg.awayLow += 1;
       }
       injuryMap.set(ir.matchId, agg);
     }

     // V11 批量近期战绩特征（一次性查出所有球队近期数据，避免N+1）
     const v11TeamNames: string[] = [];
     for (const r of rows) {
       if (r.homeTeam && !v11TeamNames.includes(r.homeTeam)) v11TeamNames.push(r.homeTeam);
       if (r.awayTeam && !v11TeamNames.includes(r.awayTeam)) v11TeamNames.push(r.awayTeam);
     }
      const recentStatsMap = v11TeamNames.length > 0
        ? await this.computeTeamRecentStats(v11TeamNames, undefined, { enableFuzzy: false })
        : new Map<string, TeamRecentStats>();

      const bbHistTeams: Array<{ teamName: string; league: string }> = [];
      for (const r of rows) {
        const rowLeague = r.league || 'default';
        if (r.homeTeam && !this.sportteryService.bbHasTeamStats(r.teamStats, 'home')) {
          bbHistTeams.push({ teamName: r.homeTeam, league: rowLeague });
        } else if (r.homeTeam && !this.sportteryService.bbHasTeamOppgStats(r.teamStats, 'home')) {
          bbHistTeams.push({ teamName: r.homeTeam, league: rowLeague });
        }
        if (r.awayTeam && !this.sportteryService.bbHasTeamStats(r.teamStats, 'away')) {
          bbHistTeams.push({ teamName: r.awayTeam, league: rowLeague });
        } else if (r.awayTeam && !this.sportteryService.bbHasTeamOppgStats(r.teamStats, 'away')) {
          bbHistTeams.push({ teamName: r.awayTeam, league: rowLeague });
        }
      }
      const bbHistStatsMap = await this.sportteryService.bbComputeHistoricalTeamStats(bbHistTeams);

     let recalculated = 0;
    let skipped = 0;
    let errors = 0;

    const dataDrivenSources = ['qiumibao', 'espn'];
    for (const src of dataDrivenSources) {
      const srcCount = rows.filter((r) => r.source === src).length;
      if (srcCount === 0) continue;
      const preds = await this.dataDrivenService.predictAllUpcomingBySource(src);
      const applyResult = await this.dataDrivenService.applyPredictions(preds, { force: true });
      recalculated += applyResult.updated;
      skipped += applyResult.skippedLocked;
      errors += applyResult.errors;
      const livePreds = await this.dataDrivenService.predictLiveBySource(src);
      if (livePreds.length > 0) {
        const liveApplyResult = await this.dataDrivenService.applyPredictions(livePreds, { force: true });
        recalculated += liveApplyResult.updated;
        skipped += liveApplyResult.skippedLocked;
        errors += liveApplyResult.errors;
      }
    }

      for (const row of rows) {
        try {
          if (row.matchNo && row.matchNo.includes('周四')) {
            this.logger.error(`[LOOP-DEBUG] matchNo=${row.matchNo}, source=${row.source}, hasInj=${!!row.injuries}, injType=${typeof row.injuries}`);
          }
          if (row.matchNo && (row.matchNo === '周二302' || row.matchNo === '周三301')) {
            this.logger.error(`[ROW-DEBUG] matchNo=${row.matchNo}, source=(${typeof row.source}) "${row.source}", inDD=${dataDrivenSources.includes(row.source)}`);
          }
          if (dataDrivenSources.includes(row.source)
              && row.predEngineVersion
              && row.predEngineVersion.startsWith('data-driven')) {
            continue;
          }
          const rowRules = row.modelRules as unknown as string[] | null | undefined;
          const isOfficialLocked = Array.isArray(rowRules) && rowRules.some((r: string) => r.includes('官方数据锁定'));
        let hwOdds = Number(row.homeWinOdds) || 0;
        let awOdds = Number(row.awayWinOdds) || 0;
        const hOddsH = Number(row.handicapOddsHome) || 0;
        const hOddsA = Number(row.handicapOddsAway) || 0;
        const handicapVal = Number(row.handicapLineNum) || 0;

        const hasLine = Math.abs(handicapVal) > 0 && hOddsH > 0 && hOddsA > 0;
        if (hwOdds <= 0 || awOdds <= 0) {
          if (hasLine) {
            const invH = 1 / hOddsH;
            const invA = 1 / hOddsA;
            const totalInv = invH + invA;
            const homeCoverProb = invH / totalInv;
            const impliedHomeWinRate = 0.5 + (homeCoverProb - 0.5) * 0.7;
            const clampedWin = Math.max(0.1, Math.min(0.9, impliedHomeWinRate));
            const margin = 10 * Math.log(clampedWin / (1 - clampedWin)) - handicapVal;
            const winRateFromMargin = 1 / (1 + Math.exp(-margin / 10));
            const vig = 0.06;
            hwOdds = 1 / (winRateFromMargin * (1 + vig));
            awOdds = 1 / ((1 - winRateFromMargin) * (1 + vig));
          }
        }

        const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
        const rowLeague = row.league || 'default';
        const histBaseline = historicalBaselines.get(rowLeague);
        const totalValid = this.sportteryService.isBasketballLineValid(rowLeague, 'total', totalLineNum);
        const totalLineForPred = totalValid ? String(totalLineNum)
          : (row.totalLine && row.totalLine.trim() && this.sportteryService.isBasketballLineValid(rowLeague, 'total', Number(row.totalLine)) ? row.totalLine.trim() : undefined);
        const handicapLineNumVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
        const handicapValid = this.sportteryService.isBasketballLineValid(rowLeague, 'spread', handicapLineNumVal);
        const handicapStrForPred = handicapValid ? String(handicapLineNumVal)
          : (row.handicap && row.handicap.trim() && this.sportteryService.isBasketballLineValid(rowLeague, 'spread', Number(row.handicap)) ? row.handicap.trim() : '');

        let homePpg: number | undefined;
        let awayPpg: number | undefined;
        let homeOppg: number | undefined;
        let awayOppg: number | undefined;
        let leagueAvgPpg: number | undefined;
        if (row.teamStats && typeof row.teamStats === 'object') {
          const ts = row.teamStats as Record<string, unknown>;
          const hs = ts.home as Record<string, unknown> | null;
          const as = ts.away as Record<string, unknown> | null;
          if (hs) {
            const rawVal = hs.pointsPerGame != null && hs.pointsPerGame !== '' ? hs.pointsPerGame : hs.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) homePpg = n;
            const oppgVal = hs.oppg != null && hs.oppg !== '' ? hs.oppg : hs.pointsAllowedPerGame;
            const on = Number(oppgVal);
            if (!Number.isNaN(on) && on > 0) homeOppg = on;
            const lAvgVal = hs.leaguePpg != null && hs.leaguePpg !== '' ? hs.leaguePpg : hs.league_ppg;
            const ln = Number(lAvgVal);
            if (!Number.isNaN(ln) && ln > 0) leagueAvgPpg = ln < 120 ? ln * 2 : ln;
          }
          if (as) {
            const rawVal = as.pointsPerGame != null && as.pointsPerGame !== '' ? as.pointsPerGame : as.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) awayPpg = n;
            const oppgVal = as.oppg != null && as.oppg !== '' ? as.oppg : as.pointsAllowedPerGame;
            const on = Number(oppgVal);
            if (!Number.isNaN(on) && on > 0) awayOppg = on;
          }
        }

        const histStats = this.sportteryService.bbFillHistoricalStats(
          { homeTeam: row.homeTeam, awayTeam: row.awayTeam, teamStats: row.teamStats },
          bbHistStatsMap,
        );
        if (row.matchNo === '周三305') {
          this.logger.warn(`[305-OPPG] before: homePpg=${homePpg}, awayPpg=${awayPpg}, homeOppg=${homeOppg}, awayOppg=${awayOppg}`);
          this.logger.warn(`[305-OPPG] histStats: ${JSON.stringify(histStats)}`);
        }
        if (!homePpg && histStats.homePpg) homePpg = histStats.homePpg;
        if (!awayPpg && histStats.awayPpg) awayPpg = histStats.awayPpg;
        if (!homeOppg && histStats.homeOppg) homeOppg = histStats.homeOppg;
        if (!awayOppg && histStats.awayOppg) awayOppg = histStats.awayOppg;
        if (row.matchNo === '周三305') {
          this.logger.warn(`[305-OPPG] after: homePpg=${homePpg}, awayPpg=${awayPpg}, homeOppg=${homeOppg}, awayOppg=${awayOppg}`);
        }

         const injuryAgg = injuryMap.get(row.id) ?? { homeHigh: 0, homeMed: 0, homeLow: 0, awayHigh: 0, awayMed: 0, awayLow: 0 };
         let coreInjuriesHome = injuryAgg.homeHigh + Math.floor(injuryAgg.homeMed / 2);
         let coreInjuriesAway = injuryAgg.awayHigh + Math.floor(injuryAgg.awayMed / 2);
         let weightedInjuriesHome = injuryAgg.homeHigh * 1.0 + injuryAgg.homeMed * 0.5 + injuryAgg.homeLow * 0.2;
         let weightedInjuriesAway = injuryAgg.awayHigh * 1.0 + injuryAgg.awayMed * 0.5 + injuryAgg.awayLow * 0.2;
          const injuryInfo = this.extractCoreInjuryCountFromRow(row);
          let freshWeightedInjuriesHome = 0;
          let freshWeightedInjuriesAway = 0;
          let freshCoreInjuriesHome = 0;
          let freshCoreInjuriesAway = 0;

          if (row.injuries && typeof row.injuries === 'object' && !Array.isArray(row.injuries)) {
            const injObj = row.injuries as Record<string, unknown>;
            const LONG_TERM_DAYS = 10;
            const kickoffMs = row.kickoffTime ? new Date(row.kickoffTime).getTime() : Date.now();
            const parseFreshWeighted = (list: unknown): { weighted: number; core: number } => {
              if (!Array.isArray(list)) return { weighted: 0, core: 0 };
              let w = 0;
              let c = 0;
              for (const item of list) {
                if (!item || typeof item !== 'object') continue;
                const o = item as Record<string, unknown>;
                const status = String(o.status || '').toLowerCase();
                const comment = String(o.shortComment || o.comment || '').toLowerCase();
                const dateStr = String(o.injuryDate || o.date || '');
                let weight = 0.3;
                let isCore = false;
                if (status.includes('out') || status.includes('赛季报销') || status.includes('报销')
                  || status.includes('indefinitely') || /核心|主力|star|starter/.test(comment)) {
                  weight = 1.0;
                  isCore = true;
                } else if (status.includes('questionable') || status.includes('doubtful')
                  || status.includes('出战成疑') || status.includes('day-to-day') || status.includes('缺阵')) {
                  weight = 0.5;
                  isCore = false;
                } else if (status.includes('probable') || status.includes('available')) {
                  weight = 0.2;
                  isCore = false;
                }
                const injDate = dateStr ? new Date(dateStr).getTime() : null;
                const daysSince = injDate && !Number.isNaN(injDate) ? (kickoffMs - injDate) / (24 * 60 * 60 * 1000) : 0;
                const isSeasonOut = /赛季报销|season[\s-]*ending|out[\s-]*for[\s-]*the[\s-]*season|out[\s-]*indefinitely|indefinitely|out.*season(?!\s*opener|\s*debut)|miss.*(the\s+)?season|for\s+the\s+rest\s+of\s+the\s+season|achilles\s+(surgery|repair|rupture)|torn\s+(acl|achilles|meniscus|ligament|rotator\s+cuff)|acl\s+(surgery|tear|torn|reconstruction)|rupture|fracture|broken\s+(bone|leg|arm|foot|hand|wrist)|out\s+(6|8|10|12|16)\s*weeks|out\s+\d+\s*months|year(s)?\s+out/.test(comment);
                const isLongTerm = isSeasonOut || (daysSince > LONG_TERM_DAYS && /out|长期|无限期/.test(status));
                if (!isLongTerm) {
                  w += weight;
                  if (isCore) c += 1;
                }
              }
              return { weighted: Math.round(w * 10) / 10, core: c };
            };
            const hFresh = parseFreshWeighted(injObj.home);
            const aFresh = parseFreshWeighted(injObj.away);
            freshWeightedInjuriesHome = hFresh.weighted;
            freshWeightedInjuriesAway = aFresh.weighted;
            freshCoreInjuriesHome = hFresh.core;
            freshCoreInjuriesAway = aFresh.core;
            if (row.matchNo && row.matchNo.includes('301')) {
              this.logger.error(`[V113-DEBUG] ${row.matchNo}: freshHome=${freshWeightedInjuriesHome}, freshAway=${freshWeightedInjuriesAway}, coreHome=${freshCoreInjuriesHome}, coreAway=${freshCoreInjuriesAway}, hwOdds=${hwOdds}, awOdds=${awOdds}, handicap=${handicapLineNumVal}`);
            }
          }

           if (injuryInfo.homeCore > 0 || injuryInfo.awayCore > 0) {
             coreInjuriesHome = injuryInfo.homeCore;
             coreInjuriesAway = injuryInfo.awayCore;
             weightedInjuriesHome = injuryInfo.homeCore;
             weightedInjuriesAway = injuryInfo.awayCore;
           }
         const handicapLineForFavorite = handicapValid ? handicapLineNumVal : 0;
         const isHomeFavorite = handicapLineForFavorite < 0;
         const favoriteTeamSide: 'home' | 'away' | null = handicapValid ? (isHomeFavorite ? 'home' : 'away') : null;
         const favoriteCoreInjuries = favoriteTeamSide === 'home'
           ? coreInjuriesHome
           : favoriteTeamSide === 'away' ? coreInjuriesAway : 0;

        let kickoffMonth: number | undefined;
        if (row.kickoffTime) {
          const kt = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(row.kickoffTime);
          if (!Number.isNaN(kt.getTime())) {
            kickoffMonth = kt.getMonth() + 1;
          }
        }

        const prediction = this.sportteryService.generateBasketballPrediction(
          hwOdds,
          awOdds,
          handicapStrForPred,
          totalLineForPred,
          rowLeague,
          '',
           {
              homePpg,
              awayPpg,
              homeOppg,
              awayOppg,
              leagueAvgPpg,
              kickoffMonth,
              coreInjuriesHome,
              coreInjuriesAway,
              freshWeightedInjuriesHome,
              freshWeightedInjuriesAway,
              favoriteTeamSide,
              favoriteCoreInjuries,
              teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
             intelData: parseIntelFromRow({
               h2hHistory: row.h2hHistory,
               injuries: row.injuries,
               recentForm: row.recentForm,
               keyPlayers: row.keyPlayers,
               teamNews: row.intelSummary ?? (row.intel as string | null),
               homeTeam: row.homeTeam,
               awayTeam: row.awayTeam,
             }),
              eloHome: row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined,
              eloAway: row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined,
              playoffSeriesGames: this.buildPlayoffSeriesGames(row.h2hHistory, row.homeTeam, row.awayTeam),
              openTotalLineNum: row.oddsOpenTotalLine ? Number(row.oddsOpenTotalLine) : undefined,
            },
         );
        if (!prediction) {
          skipped += 1;
          continue;
        }

        const anchorPred = this.anchorPrediction.predict({
          handicapLineNum: handicapValid ? handicapLineNumVal : null,
          totalLineNum: totalLineNum > 0 ? totalLineNum : null,
          league: rowLeague,
          kickoffMonth,
          homePpg,
          awayPpg,
          homeOppg,
          awayOppg,
          leagueAvgPpg,
          homeWinOdds: hwOdds > 0 ? hwOdds : undefined,
          awayWinOdds: awOdds > 0 ? awOdds : undefined,
          stage: '',
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
          eloHome: row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined,
          eloAway: row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined,
          eloGap: row.homeTeam && row.awayTeam && eloMap.get(row.homeTeam) && eloMap.get(row.awayTeam)
            ? eloMap.get(row.homeTeam)!.rating - eloMap.get(row.awayTeam)!.rating
            : undefined,
          historicalBaselineTotal: histBaseline?.avgTotal,
          historicalSampleSize: histBaseline?.sampleSize ?? 0,
           coreInjuriesHome,
           coreInjuriesAway,
           weightedInjuriesHome,
           weightedInjuriesAway,
           freshCoreInjuriesHome,
           freshCoreInjuriesAway,
           freshWeightedInjuriesHome,
           freshWeightedInjuriesAway,
           favoriteTeamSide,
          favoriteCoreInjuries,
          recent10HomePpg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent10Ppg : undefined,
          recent10AwayPpg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent10Ppg : undefined,
          recent10HomeOppg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent10Oppg : undefined,
          recent10AwayOppg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent10Oppg : undefined,
          recent20HomePpg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent20Ppg : undefined,
          recent20AwayPpg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent20Ppg : undefined,
          recent20HomeOppg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent20Oppg : undefined,
          recent20AwayOppg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent20Oppg : undefined,
           recentSampleCount:
             row.homeTeam && row.awayTeam && recentStatsMap.get(row.homeTeam) && recentStatsMap.get(row.awayTeam)
               ? Math.min(recentStatsMap.get(row.homeTeam)!.sampleCount, recentStatsMap.get(row.awayTeam)!.sampleCount)
               : row.homeTeam && recentStatsMap.get(row.homeTeam)
               ? recentStatsMap.get(row.homeTeam)!.sampleCount
               : row.awayTeam && recentStatsMap.get(row.awayTeam)
               ? recentStatsMap.get(row.awayTeam)!.sampleCount
               : 0,
           playoffSeriesGames: this.buildPlayoffSeriesGames(row.h2hHistory, row.homeTeam, row.awayTeam),
           openTotalLineNum: row.oddsOpenTotalLine ? Number(row.oddsOpenTotalLine) : undefined,
         });

         const patch: Record<string, unknown> = {
           homeWinProb: prediction.homeWinProb,
          awayWinProb: prediction.awayWinProb,
          predictionDirection: prediction.predictionDirection,
          confidence: prediction.confidence,
          handicapRecommendation: prediction.handicapRecommendation,
          handicapPick: prediction.handicapRecommendation,
          handicapCoverProb: prediction.handicapCoverProb,
          handicapPickProb: prediction.handicapPickProb,
          totalDirection: prediction.totalDirection,
          overProb: prediction.overProb,
          underProb: prediction.underProb,
          totalPick: prediction.totalDirection,
          totalPickProb: prediction.totalPickProb,
          modelRules: await this.filterDisabledRules(prediction.modelRules),
          predictedHomeScore: prediction.predictedHomeScore,
          predictedAwayScore: prediction.predictedAwayScore,
          predictedTotal: String(prediction.predictedTotal),
          handicapConfidence: prediction.handicapConfidence,
          ouConfidence: prediction.ouConfidence,
          ouDiffVsLine: String(prediction.ouDiffVsLine),
          predEngineVersion: anchorPred?.predEngineVersion ?? 'v7.x',
          predictionAnchor: anchorPred?.anchor === 'spread_anchored' ? 'spread_anchored' : anchorPred?.anchor === 'model_reference' ? 'model_reference' : null,
          subModels: anchorPred?.subModels,
          injuryAdjustApplied: String(anchorPred?.injuryAdjustApplied ?? 0),
          injuryAdjustPct: anchorPred?.injuryAdjustPct ?? 0,
          advancedDataReady: anchorPred?.advancedDataReady ?? false,
          advancedDataNotice: anchorPred?.advancedDataNotice,
          eloHome: row.homeTeam && eloMap.get(row.homeTeam) ? eloMap.get(row.homeTeam)!.rating.toFixed(2) : null,
          eloAway: row.awayTeam && eloMap.get(row.awayTeam) ? eloMap.get(row.awayTeam)!.rating.toFixed(2) : null,
          eloGap: row.homeTeam && row.awayTeam && eloMap.get(row.homeTeam) && eloMap.get(row.awayTeam)
            ? (eloMap.get(row.homeTeam)!.rating - eloMap.get(row.awayTeam)!.rating).toFixed(2)
            : null,
          rulesTriggered: [
            { rule: 'v10_intel', impact: JSON.stringify(prediction.adjustBreakdown), direction: prediction.predictionDirection },
          ],
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };
        if (!isOfficialLocked) {
          patch.handicap = String(handicapLineNumVal);
          patch.handicapLineNum = handicapLineNumVal;
          patch.totalLine = String(totalLineNum);
          patch.totalLineNum = totalLineNum;
        }
        this.logger.log(`[TPP-DEBUG] ${row.matchNo} before finalize: totalPickProb=${patch.totalPickProb}, overProb=${patch.overProb}, underProb=${patch.underProb}, totalDir=${patch.totalDirection}`);
        this.sportteryService.finalizeBasketballPick(patch, null, null, rowLeague);
        this.sportteryService.appendBasketballPredictionHistory(patch, 'bb_service_recalc_upcoming');
        this.logger.log(`[TPP-DEBUG] ${row.matchNo} after finalize: totalPickProb=${patch.totalPickProb}, overProb=${patch.overProb}, underProb=${patch.underProb}`);
        await this.db.update(basketballMatches)
          .set(patch)
          .where(eq(basketballMatches.id, row.id));
        recalculated += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(`recalc-upcoming failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }
    return { recalculated, skipped, errors };
  }

  async recalcFlashscoreHistorical(): Promise<{
    total: number;
    recalculated: number;
    errors: number;
    hitRecalc: { wdw: number; hc: number; ou: number };
  }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.source, 'flashscore'),
          eq(basketballMatches.matchStatus, 'finished'),
          eq(basketballMatches.isPredictionFrozen, false),
        ),
      );

    this.logger.log(`Flashscore历史重算: 找到${rows.length}场finished比赛`);

    const ids = rows.map((r) => r.id);
    const preds = await this.dataDrivenService.predictByIds(ids);
    const applyResult = await this.dataDrivenService.applyPredictions(preds, { force: true });

    this.logger.log(
      `Flashscore历史预测重算完成: 重算${applyResult.updated}/${preds.length}场, 跳过${applyResult.skippedLocked}, 错误${applyResult.errors}`,
    );

    await this.recalculateHandicapHits();

    const finishedRows = await this.db
      .select({
        id: basketballMatches.id,
        hitWdw: basketballMatches.hitWdw,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.source, 'flashscore'),
          eq(basketballMatches.matchStatus, 'finished'),
        ),
      );

    const wdwCount = finishedRows.filter((r) => r.hitWdw !== null).length;
    const hcCount = finishedRows.filter((r) => r.hitHandicap !== null).length;
    const ouCount = finishedRows.filter((r) => r.hitOverunder !== null).length;

    return {
      total: rows.length,
      recalculated: applyResult.updated,
      errors: applyResult.errors,
      hitRecalc: { wdw: wdwCount, hc: hcCount, ou: ouCount },
    };
  }

  async recalcPredictionsByDateRange(
    startDate?: string,
    endDate?: string,
    includeFinished = false,
  ): Promise<{ recalculated: number; skipped: number; errors: number }> {
    if (!startDate || !endDate) {
      return { recalculated: 0, skipped: 0, errors: 0 };
    }
    const rows = await this.db.select()
      .from(basketballMatches)
      .where(
        and(
          gte(basketballMatches.businessDate, sql`${startDate}::date`),
          lte(basketballMatches.businessDate, sql`${endDate}::date`),
          eq(basketballMatches.isPredictionFrozen, false),
          eq(basketballMatches.matchStatus, 'upcoming'),
          gt(basketballMatches.kickoffTime, sql`NOW() + INTERVAL '10 minutes'`),
        ),
      )
      .orderBy(asc(basketballMatches.businessDate), asc(basketballMatches.matchNo));

    const eloTeams: Array<{ teamName: string }> = [];
    for (const r of rows) {
      if (r.homeTeam) eloTeams.push({ teamName: r.homeTeam });
      if (r.awayTeam) eloTeams.push({ teamName: r.awayTeam });
    }
    const eloMap = await this.eloHistoryService.getTeamRatings('basketball', eloTeams);

    const historicalBaselines = await this.computeLeagueHistoricalBaselines();

    const bbHistTeams: Array<{ teamName: string; league: string }> = [];
    for (const r of rows) {
      const rowLeague = r.league || 'default';
      if (r.homeTeam && !this.sportteryService.bbHasTeamStats(r.teamStats, 'home')) {
        bbHistTeams.push({ teamName: r.homeTeam, league: rowLeague });
      } else if (r.homeTeam && !this.sportteryService.bbHasTeamOppgStats(r.teamStats, 'home')) {
        bbHistTeams.push({ teamName: r.homeTeam, league: rowLeague });
      }
      if (r.awayTeam && !this.sportteryService.bbHasTeamStats(r.teamStats, 'away')) {
        bbHistTeams.push({ teamName: r.awayTeam, league: rowLeague });
      } else if (r.awayTeam && !this.sportteryService.bbHasTeamOppgStats(r.teamStats, 'away')) {
        bbHistTeams.push({ teamName: r.awayTeam, league: rowLeague });
      }
    }
    const bbHistStatsMap = await this.sportteryService.bbComputeHistoricalTeamStats(bbHistTeams);

    let recalculated = 0;
     let skipped = 0;
     let errors = 0;

      for (const row of rows) {
       try {
          if (row.matchStatus === 'finished' && !includeFinished) {
            skipped += 1;
            continue;
          }
         // V11 统一引擎：旧引擎版本均允许升级重算为 V11
         // 仅当已是最新 V11 版本且为完赛场时跳过（上面已统一守卫，此处保留作为版本识别参考）
         const isLatestV11 = row.predEngineVersion === 'v11.0-unified' ||
           row.predEngineVersion === 'v11.1-unified' ||
           (typeof row.predEngineVersion === 'string' && row.predEngineVersion.startsWith('v11.'));
         const rowRules = row.modelRules as unknown as string[] | null | undefined;
         const isOfficialLocked = Array.isArray(rowRules) && rowRules.some((r: string) => r.includes('官方数据锁定'));
         if (isOfficialLocked) {
           skipped += 1;
           continue;
         }
         let hwOdds = Number(row.homeWinOdds) || 0;
         let awOdds = Number(row.awayWinOdds) || 0;
         const hOddsH = Number(row.handicapOddsHome) || 0;
         const hOddsA = Number(row.handicapOddsAway) || 0;
         const handicapVal = Number(row.handicapLineNum) || 0;

        const hasLine = Math.abs(handicapVal) > 0 && hOddsH > 0 && hOddsA > 0;
        if (hwOdds <= 0 || awOdds <= 0) {
          if (hasLine) {
            const invH = 1 / hOddsH;
            const invA = 1 / hOddsA;
            const totalInv = invH + invA;
            const homeCoverProb = invH / totalInv;
            const impliedHomeWinRate = 0.5 + (homeCoverProb - 0.5) * 0.7;
            const clampedWin = Math.max(0.1, Math.min(0.9, impliedHomeWinRate));
            const margin = 10 * Math.log(clampedWin / (1 - clampedWin)) - handicapVal;
            const winRateFromMargin = 1 / (1 + Math.exp(-margin / 10));
            const vig = 0.06;
            hwOdds = 1 / (winRateFromMargin * (1 + vig));
            awOdds = 1 / ((1 - winRateFromMargin) * (1 + vig));
          }
        }

        const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
        const rowLeague = row.league || 'default';
        const histBaseline = historicalBaselines.get(rowLeague);
        const totalValid = this.sportteryService.isBasketballLineValid(rowLeague, 'total', totalLineNum);
        const totalLineForPred = totalValid ? String(totalLineNum)
          : (row.totalLine && row.totalLine.trim() && this.sportteryService.isBasketballLineValid(rowLeague, 'total', Number(row.totalLine)) ? row.totalLine.trim() : undefined);
        const handicapLineNumVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
        const handicapValid = this.sportteryService.isBasketballLineValid(rowLeague, 'spread', handicapLineNumVal);
        const handicapStrForPred = handicapValid ? String(handicapLineNumVal)
           : (row.handicap && row.handicap.trim() && this.sportteryService.isBasketballLineValid(rowLeague, 'spread', Number(row.handicap)) ? row.handicap.trim() : '');

          let coreInjuriesHome = 0;
          let coreInjuriesAway = 0;
          const kickoffDate = row.kickoffTime instanceof Date
            ? row.kickoffTime
            : new Date(String(row.kickoffTime));
          try {
             const injRaw = row.injuries;
             let injObj: Record<string, unknown> | null = null;
             if (injRaw && typeof injRaw === 'object') {
               injObj = injRaw as Record<string, unknown>;
             } else if (typeof injRaw === 'string' && injRaw.trim()) {
               injObj = JSON.parse(injRaw) as Record<string, unknown>;
             }
            const freshCutoffMs = 21 * 24 * 60 * 60 * 1000;
            const countFreshInjuries = (arr: unknown[]): number => {
              let count = 0;
              for (const p of arr) {
                const st = (p as Record<string, unknown>)?.status as string | undefined;
                const dateStr = (p as Record<string, unknown>)?.date as string | undefined;
                let weight = 0;
                if (st === 'Out' || st === 'OUT') weight = 1;
                else if (st === 'Questionable' || st === 'Doubtful') weight = 0.5;
                if (weight === 0) continue;
                if (dateStr) {
                  const injDate = new Date(dateStr);
                  if (kickoffDate.getTime() - injDate.getTime() > freshCutoffMs) continue;
                }
                count += weight;
              }
              return Math.floor(count * 2) / 2;
            };
            if (injObj && Array.isArray(injObj.home)) coreInjuriesHome = countFreshInjuries(injObj.home);
             if (injObj && Array.isArray(injObj.away)) coreInjuriesAway = countFreshInjuries(injObj.away);
           } catch {
            // 解析失败忽略
          }

          let freshWeightedInjuriesHome = 0;
          let freshWeightedInjuriesAway = 0;
          try {
            const injRaw2 = row.injuries;
            let injObj2: Record<string, unknown> | null = null;
            if (injRaw2 && typeof injRaw2 === 'object') {
              injObj2 = injRaw2 as Record<string, unknown>;
            } else if (typeof injRaw2 === 'string' && injRaw2.trim()) {
              injObj2 = JSON.parse(injRaw2) as Record<string, unknown>;
            }
            if (injObj2) {
              const kickoffMs = kickoffDate.getTime();
              const LONG_TERM_DAYS = 10;
              const parseFreshWeighted = (list: unknown): number => {
                if (!Array.isArray(list)) return 0;
                let w = 0;
                for (const item of list) {
                  if (!item || typeof item !== 'object') continue;
                  const o = item as Record<string, unknown>;
                  const status = String(o.status || '').toLowerCase();
                  const comment = String(o.shortComment || o.comment || '').toLowerCase();
                  const dateStr = String(o.injuryDate || o.date || '');
                  let weight = 0.3;
                  if (status.includes('out') || status.includes('赛季报销') || status.includes('报销')
                    || status.includes('indefinitely') || /核心|主力|star|starter/.test(comment)) {
                    weight = 1.0;
                  } else if (status.includes('questionable') || status.includes('doubtful')
                    || status.includes('出战成疑') || status.includes('day-to-day') || status.includes('缺阵')) {
                    weight = 0.5;
                  } else if (status.includes('probable') || status.includes('available')) {
                    weight = 0.2;
                  }
                  const injDate = dateStr ? new Date(dateStr).getTime() : null;
                  const daysSince = injDate && !Number.isNaN(injDate) ? (kickoffMs - injDate) / (24 * 60 * 60 * 1000) : 0;
                  const isSeasonOut = /赛季报销|season[\s-]*ending|out[\s-]*for[\s-]*the[\s-]*season|out[\s-]*indefinitely|indefinitely|out.*season(?!\s*opener|\s*debut)|miss.*(the\s+)?season|for\s+the\s+rest\s+of\s+the\s+season|achilles\s+(surgery|repair|rupture)|torn\s+(acl|achilles|meniscus|ligament|rotator\s+cuff)|acl\s+(surgery|tear|torn|reconstruction)|rupture|fracture|broken\s+(bone|leg|arm|foot|hand|wrist)|out\s+(6|8|10|12|16)\s*weeks|out\s+\d+\s*months|year(s)?\s+out/.test(comment);
                  const isLongTerm = isSeasonOut || (daysSince > LONG_TERM_DAYS && /out|长期|无限期/.test(status));
                  if (!isLongTerm) w += weight;
                }
                return Math.round(w * 10) / 10;
              };
              freshWeightedInjuriesHome = parseFreshWeighted(injObj2.home);
              freshWeightedInjuriesAway = parseFreshWeighted(injObj2.away);
            }
          } catch {
            // 解析失败忽略
          }

          const isHomeFavorite = handicapValid ? handicapLineNumVal < 0 : false;
         const favoriteTeamSide: 'home' | 'away' | null = handicapValid ? (isHomeFavorite ? 'home' : 'away') : null;
         const favoriteCoreInjuries = favoriteTeamSide === 'home'
           ? coreInjuriesHome
           : favoriteTeamSide === 'away' ? coreInjuriesAway : 0;

         let homePpg: number | undefined;
         let awayPpg: number | undefined;
         let homeOppg: number | undefined;
         let awayOppg: number | undefined;
         if (row.teamStats && typeof row.teamStats === 'object') {
           const ts = row.teamStats as Record<string, unknown>;
           const hs = ts.home as Record<string, unknown> | null;
           const as = ts.away as Record<string, unknown> | null;
           if (hs) {
             const rawVal = hs.pointsPerGame != null && hs.pointsPerGame !== '' ? hs.pointsPerGame : hs.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) homePpg = n;
            const oppgRaw = hs.opponentsPointsPerGame != null && hs.opponentsPointsPerGame !== '' ? hs.opponentsPointsPerGame : hs.oppg;
             const on = Number(oppgRaw);
             if (!Number.isNaN(on) && on > 0) homeOppg = on;
          }
          if (as) {
            const rawVal = as.pointsPerGame != null && as.pointsPerGame !== '' ? as.pointsPerGame : as.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) awayPpg = n;
            const oppgRaw = as.opponentsPointsPerGame != null && as.opponentsPointsPerGame !== '' ? as.opponentsPointsPerGame : as.oppg;
             const on = Number(oppgRaw);
             if (!Number.isNaN(on) && on > 0) awayOppg = on;
           }
         }
         const histStats = this.sportteryService.bbFillHistoricalStats(
           { homeTeam: row.homeTeam, awayTeam: row.awayTeam, teamStats: row.teamStats },
           bbHistStatsMap,
         );
         if (!homePpg && histStats.homePpg) homePpg = histStats.homePpg;
         if (!awayPpg && histStats.awayPpg) awayPpg = histStats.awayPpg;
         if (!homeOppg && histStats.homeOppg) homeOppg = histStats.homeOppg;
         if (!awayOppg && histStats.awayOppg) awayOppg = histStats.awayOppg;

        const prediction = this.sportteryService.generateBasketballPrediction(
          hwOdds,
          awOdds,
          handicapStrForPred,
          totalLineForPred,
          rowLeague,
          '',
           {
             homePpg,
             awayPpg,
             homeOppg,
             awayOppg,
             leagueAvgPpg: histBaseline?.avgTotal,
             recent10HomePpg: histStats.recent10HomePpg,
             recent10AwayPpg: histStats.recent10AwayPpg,
             recent10HomeOppg: histStats.recent10HomeOppg,
             recent10AwayOppg: histStats.recent10AwayOppg,
             recent20HomePpg: histStats.recent20HomePpg,
             recent20AwayPpg: histStats.recent20AwayPpg,
             recent20HomeOppg: histStats.recent20HomeOppg,
             recent20AwayOppg: histStats.recent20AwayOppg,
             recentSampleCount: histStats.recentSampleCount,
             intelData: parseIntelFromRow({
               h2hHistory: row.h2hHistory,
               injuries: row.injuries,
               recentForm: row.recentForm,
               keyPlayers: row.keyPlayers,
               teamNews: row.intelSummary ?? (row.intel as string | null),
               homeTeam: row.homeTeam,
               awayTeam: row.awayTeam,
             }),
              eloHome: row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined,
              eloAway: row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined,
              eloGap:
                row.homeTeam && row.awayTeam && eloMap.get(row.homeTeam) && eloMap.get(row.awayTeam)
                  ? eloMap.get(row.homeTeam)!.rating - eloMap.get(row.awayTeam)!.rating
                  : undefined,
              teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
               coreInjuriesHome,
               coreInjuriesAway,
               freshWeightedInjuriesHome,
               freshWeightedInjuriesAway,
             favoriteTeamSide,
             favoriteCoreInjuries,
             playoffSeriesGames: this.buildPlayoffSeriesGames(
               row.h2hHistory,
               row.homeTeam ?? '',
               row.awayTeam ?? '',
             ),
           },
           );
          if (!prediction) {
            skipped += 1;
            continue;
          }

          const patch2: Record<string, unknown> = {
           homeWinProb: prediction.homeWinProb,
           awayWinProb: prediction.awayWinProb,
           predictionDirection: prediction.predictionDirection,
           confidence: prediction.confidence,
           handicap: String(handicapLineNumVal),
           handicapLineNum: handicapLineNumVal,
           handicapRecommendation: prediction.handicapRecommendation,
           handicapPick: prediction.handicapRecommendation,
           handicapCoverProb: prediction.handicapCoverProb,
           handicapPickProb: prediction.handicapPickProb,
           totalLine: String(totalLineNum),
           totalLineNum: totalLineNum,
           totalDirection: prediction.totalDirection,
           overProb: prediction.overProb,
           underProb: prediction.underProb,
           totalPick: prediction.totalDirection,
           totalPickProb: prediction.totalPickProb,
           modelRules: await this.filterDisabledRules(prediction.modelRules),
           predictedHomeScore: prediction.predictedHomeScore,
           predictedAwayScore: prediction.predictedAwayScore,
           predictedTotal: String(prediction.predictedTotal),
           handicapConfidence: prediction.handicapConfidence,
           ouConfidence: prediction.ouConfidence,
           ouDiffVsLine: String(prediction.ouDiffVsLine),
            predEngineVersion: prediction.predEngineVersion,
            injuryAdjustApplied: String('injuryAdjustApplied' in prediction ? (prediction as { injuryAdjustApplied?: number }).injuryAdjustApplied ?? 0 : 0),
           updatedAt: sql`CURRENT_TIMESTAMP`,
         };
         this.sportteryService.finalizeBasketballPick(patch2, null, null, rowLeague);
        this.sportteryService.appendBasketballPredictionHistory(patch2, 'bb_service_recalc_by_date');
        await this.db.update(basketballMatches)
          .set(patch2)
          .where(eq(basketballMatches.id, row.id));

        recalculated += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(`recalc-by-date failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }
    return { recalculated, skipped, errors };
  }

  async backfillV8StructuralFields(): Promise<{ updated: number; total: number; errors: number }> {
    const rows = await this.db.select()
      .from(basketballMatches)
      .orderBy(asc(basketballMatches.kickoffTime));

    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
        const handicapLineNum =
          row.handicapLineNum != null && Number(row.handicapLineNum) !== 0
            ? Number(row.handicapLineNum)
            : null;

        let homePpg: number | undefined;
        let awayPpg: number | undefined;
        if (row.teamStats && typeof row.teamStats === 'object') {
          const ts = row.teamStats as Record<string, unknown>;
          const hs = ts.home as Record<string, unknown> | null;
          const as = ts.away as Record<string, unknown> | null;
          if (hs) {
            const rawVal = hs.pointsPerGame != null && hs.pointsPerGame !== '' ? hs.pointsPerGame : hs.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) homePpg = n;
          }
          if (as) {
            const rawVal = as.pointsPerGame != null && as.pointsPerGame !== '' ? as.pointsPerGame : as.ppg;
            const n = Number(rawVal);
            if (!Number.isNaN(n) && n > 0) awayPpg = n;
          }
        }

        const structural = this.anchorPrediction.generateStructuralFields({
          handicapLineNum,
          totalLineNum: totalLineNum > 0 ? totalLineNum : null,
          league: row.league || 'default',
          kickoffMonth: 0,
          homePpg,
          awayPpg,
          coreInjuriesHome: 0,
          coreInjuriesAway: 0,
          favoriteTeamSide: null,
          favoriteCoreInjuries: 0,
          homeWinOdds: undefined,
          awayWinOdds: undefined,
          stage: '',
          homeTeam: row.homeTeam || '',
          awayTeam: row.awayTeam || '',
        });

        await this.db.update(basketballMatches)
          .set({
            predEngineVersion: structural.predEngineVersion,
            predictionAnchor: structural.predictionAnchor,
            subModels: structural.subModels,
          })
          .where(eq(basketballMatches.id, row.id));
        updated += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(`backfill v8 failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }
    return { updated, total: rows.length, errors };
  }

  async recalcInjuryAdjustments(): Promise<{
    processed: number;
    updated: number;
    frozenUpdated: number;
    noInjury: number;
    errors: number;
    results: Array<{
      matchNo: string;
      homeTeam: string;
      awayTeam: string;
      isFrozen: boolean;
      before: { wdw: string; handicap: string; total: string; totalLine: number };
      after: { wdw: string; handicap: string; total: string; totalLine: number };
      changes: string[];
      injurySummary: string;
    }>;
  }> {
    const allRows = await this.db.select()
      .from(basketballMatches)
      .where(
        and(
          isNotNull(basketballMatches.injuries),
          eq(basketballMatches.isPredictionFrozen, false),
          eq(basketballMatches.matchStatus, 'upcoming'),
          gt(basketballMatches.kickoffTime, sql`NOW() + INTERVAL '10 minutes'`),
        ),
      );

    const rows = allRows.filter((r) => {
      const inj = r.injuries as unknown;
      if (!inj) return false;
      if (typeof inj === 'string') {
        try {
          const parsed = JSON.parse(inj);
          return this.hasMeaningfulInjury(parsed);
        } catch {
          return false;
        }
      }
      if (typeof inj === 'object') {
        return this.hasMeaningfulInjury(inj as Record<string, unknown>);
      }
      return false;
    });

    const results: Array<{
      matchNo: string;
      homeTeam: string;
      awayTeam: string;
      isFrozen: boolean;
      before: { wdw: string; handicap: string; total: string; totalLine: number };
      after: { wdw: string; handicap: string; total: string; totalLine: number };
      changes: string[];
      injurySummary: string;
    }> = [];

    let updated = 0;
    let frozenUpdated = 0;
    let skipped = 0;
    let errors = 0;

    const historicalBaselines = await this.computeLeagueHistoricalBaselines();

    // V11 批量近期战绩特征
    const v11TeamNames: string[] = [];
    for (const r of rows) {
      if (r.homeTeam && !v11TeamNames.includes(r.homeTeam)) v11TeamNames.push(r.homeTeam);
      if (r.awayTeam && !v11TeamNames.includes(r.awayTeam)) v11TeamNames.push(r.awayTeam);
    }
    const recentStatsMap = v11TeamNames.length > 0
      ? await this.computeTeamRecentStats(v11TeamNames, undefined, { enableFuzzy: false })
      : new Map<string, TeamRecentStats>();

    // 从 injury_reports 表按 impact_rating 加权（伤停重算优先用结构化加权数据）
    const matchIds = rows.map((r) => r.id).filter(Boolean);
    const injuryRows = matchIds.length > 0
      ? await this.db
          .select({
            matchId: injuryReports.matchId,
            teamSide: injuryReports.teamSide,
            impactRating: injuryReports.impactRating,
            injuryDate: injuryReports.injuryDate,
          })
          .from(injuryReports)
          .where(inArray(injuryReports.matchId, matchIds))
      : [];
    type InjuryWeightAgg = { weightedHome: number; weightedAway: number; coreHome: number; coreAway: number };
    const injuryWeightMap = new Map<string, InjuryWeightAgg>();
    const freshCutoffMs = 21 * 24 * 60 * 60 * 1000;
    for (const ir of injuryRows) {
      if (!ir.matchId) continue;
      const injDate = ir.injuryDate;
      const kickoffTime = rows.find((r: typeof rows[number]) => r.id === ir.matchId)?.kickoffTime;
const isFresh = !injDate
          ? true
          : kickoffTime
            ? kickoffTime.getTime() - new Date(injDate).getTime() <= freshCutoffMs
            : true;
      if (!isFresh) continue;
      const agg = injuryWeightMap.get(ir.matchId) ?? { weightedHome: 0, weightedAway: 0, coreHome: 0, coreAway: 0 };
      const isHigh = ir.impactRating === 'high';
      const isMed = ir.impactRating === 'medium';
      const weight = isHigh ? 1.0 : isMed ? 0.5 : 0.2;
      if (ir.teamSide === 'home') {
        agg.weightedHome += weight;
        if (isHigh || isMed) agg.coreHome += 1;
      } else if (ir.teamSide === 'away') {
        agg.weightedAway += weight;
        if (isHigh || isMed) agg.coreAway += 1;
      }
      injuryWeightMap.set(ir.matchId, agg);
    }

     for (const row of rows) {
       try {
         const rowRules = row.modelRules as unknown as string[] | null | undefined;
         const isOfficialLocked = !!row.isOfficialLocked
           || (Array.isArray(rowRules) && rowRules.some((r: string) => r.includes('官方数据锁定')));

         // data-driven 预测守卫：伤停重算（旧引擎版）不覆盖 data-driven 场次
         const skipPrediction = shouldSkipPredictionWrite(
           row.predEngineVersion,
           row.matchStatus,
           'recalc-injury-adjustments',
         );

         const injuryInfo = this.extractCoreInjuryCountFromRow(row);
         const injuryWeight = injuryWeightMap.get(row.id);
         const weightedInjuriesHome = injuryWeight?.weightedHome ?? 0;
         const weightedInjuriesAway = injuryWeight?.weightedAway ?? 0;
         // 结构化加权数据 > 旧 injures json 解析
         const coreHome = injuryWeight ? injuryWeight.coreHome : injuryInfo.homeCore;
         const coreAway = injuryWeight ? injuryWeight.coreAway : injuryInfo.awayCore;
        if (coreHome === 0 && coreAway === 0 && weightedInjuriesHome === 0 && weightedInjuriesAway === 0) {
          continue;
        }

        const handicapLineNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
        const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
        const isHomeFavorite = handicapLineNum < 0;
        const favoriteTeamSide: 'home' | 'away' | null = Math.abs(handicapLineNum) > 0
          ? (isHomeFavorite ? 'home' : 'away')
          : null;
        const favoriteCoreInjuries = favoriteTeamSide === 'home'
          ? coreHome
          : favoriteTeamSide === 'away' ? coreAway : 0;

        const before = {
          wdw: `${row.predictionDirection} ${Math.max(row.homeWinProb, row.awayWinProb)}%`,
          handicap: `${row.handicapRecommendation} (线${handicapLineNum})`,
          total: `${row.totalDirection} ${row.underProb}/${row.overProb} (线${totalLineNum})`,
          totalLine: totalLineNum,
        };

         const anchorPred = this.anchorPrediction.predict({
           handicapLineNum: Math.abs(handicapLineNum) > 0 ? handicapLineNum : null,
           totalLineNum: totalLineNum > 0 ? totalLineNum : null,
           league: row.league || 'default',
           homePpg: undefined,
           awayPpg: undefined,
           homeOppg: undefined,
           awayOppg: undefined,
           leagueAvgPpg: undefined,
           coreInjuriesHome: coreHome,
           coreInjuriesAway: coreAway,
           weightedInjuriesHome,
           weightedInjuriesAway,
           favoriteTeamSide,
           favoriteCoreInjuries,
           homeWinOdds: row.homeWinOdds ? Number(row.homeWinOdds) : undefined,
           awayWinOdds: row.awayWinOdds ? Number(row.awayWinOdds) : undefined,
           stage: '',
           homeTeam: row.homeTeam,
           awayTeam: row.awayTeam,
           teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
           historicalBaselineTotal: historicalBaselines.get(row.league || 'default')?.avgTotal,
           historicalSampleSize: historicalBaselines.get(row.league || 'default')?.sampleSize ?? 0,
           recent10HomePpg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent10Ppg : undefined,
           recent10AwayPpg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent10Ppg : undefined,
           recent10HomeOppg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent10Oppg : undefined,
           recent10AwayOppg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent10Oppg : undefined,
           recent20HomePpg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent20Ppg : undefined,
           recent20AwayPpg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent20Ppg : undefined,
           recent20HomeOppg: row.homeTeam ? recentStatsMap.get(row.homeTeam)?.recent20Oppg : undefined,
           recent20AwayOppg: row.awayTeam ? recentStatsMap.get(row.awayTeam)?.recent20Oppg : undefined,
           recentSampleCount:
             row.homeTeam && row.awayTeam && recentStatsMap.get(row.homeTeam) && recentStatsMap.get(row.awayTeam)
               ? Math.min(recentStatsMap.get(row.homeTeam)!.sampleCount, recentStatsMap.get(row.awayTeam)!.sampleCount)
               : row.homeTeam && recentStatsMap.get(row.homeTeam)
               ? recentStatsMap.get(row.homeTeam)!.sampleCount
               : row.awayTeam && recentStatsMap.get(row.awayTeam)
               ? recentStatsMap.get(row.awayTeam)!.sampleCount
               : 0,
           playoffSeriesGames: this.buildPlayoffSeriesGames(row.h2hHistory, row.homeTeam, row.awayTeam),
           openTotalLineNum: row.oddsOpenTotalLine ? Number(row.oddsOpenTotalLine) : undefined,
         });

        if (!anchorPred) {
          errors += 1;
          continue;
        }

        const after = {
          wdw: `${anchorPred.predictionDirection} ${Math.max(anchorPred.homeWinProb, anchorPred.awayWinProb)}%`,
          handicap: `${anchorPred.handicapRecommendation} (线${handicapLineNum})`,
          total: `${anchorPred.totalDirection} ${anchorPred.underProb}/${anchorPred.overProb} (线${totalLineNum})`,
          totalLine: totalLineNum,
        };

        const changes: string[] = [];
        if (before.wdw !== after.wdw) changes.push(`胜负: ${before.wdw} → ${after.wdw}`);
        if (before.handicap !== after.handicap) changes.push(`让分: ${before.handicap} → ${after.handicap}`);
        if (before.total !== after.total) changes.push(`大小分: ${before.total} → ${after.total}`);
        if (anchorPred.injuryAdjustApplied !== 0) {
          changes.push(`伤停调整: +${anchorPred.injuryAdjustApplied}分`);
        }

         if (!isOfficialLocked) {
           const patch: Record<string, unknown> = {
             homeWinProb: anchorPred.homeWinProb,
             awayWinProb: anchorPred.awayWinProb,
             predictionDirection: anchorPred.predictionDirection,
             confidence: anchorPred.confidence,
             handicapRecommendation: anchorPred.handicapRecommendation,
             handicapPick: anchorPred.handicapPick,
             handicapCoverProb: anchorPred.handicapCoverProb,
             handicapPickProb: anchorPred.handicapPickProb,
             totalDirection: anchorPred.totalDirection,
             overProb: anchorPred.overProb,
             underProb: anchorPred.underProb,
             totalPick: anchorPred.totalDirection,
             totalPickProb: anchorPred.totalPickProb,
             predictedHomeScore: anchorPred.predictedHomeScore,
             predictedAwayScore: anchorPred.predictedAwayScore,
             predictedTotal: String(anchorPred.predictedTotal),
             handicapConfidence: anchorPred.handicapConfidence,
             ouConfidence: anchorPred.ouConfidence,
             ouDiffVsLine: String(anchorPred.ouDiffVsLine),
             injuryAdjustApplied: String(anchorPred.injuryAdjustApplied),
             injuryAdjustPct: anchorPred.injuryAdjustPct,
             modelRules: await this.filterDisabledRules(anchorPred.modelRules),
             subModels: anchorPred.subModels,
             predEngineVersion: `v10.0-injury-r${anchorPred.injuryAdjustApplied}`,
             predictionAnchor: anchorPred.anchor === 'spread_anchored' ? 'spread_anchored' : null,
             updatedAt: sql`CURRENT_TIMESTAMP`,
           };
           // data-driven 场次：仍然写入伤停调整元信息，但不覆盖预测方向/概率等核心预测字段
           if (skipPrediction) {
             stripPredictionFieldsFromPatch(patch);
             // 保留伤停调整元信息（这些不属于核心预测方向字段）
             patch.injuryAdjustApplied = String(anchorPred.injuryAdjustApplied);
             patch.injuryAdjustPct = anchorPred.injuryAdjustPct;
           }
            if (Object.keys(patch).length > 0) {
              if (!skipPrediction) {
                this.sportteryService.finalizeBasketballPick(patch, null, null, row.league || 'default');
                this.sportteryService.appendBasketballPredictionHistory(patch, 'injury_recalc');
              }
              await this.db.update(basketballMatches)
                .set(patch)
                .where(eq(basketballMatches.id, row.id));
             updated += 1;
           } else {
             skipped += 1;
           }
        } else {
          const injuryRules = anchorPred.modelRules.filter(
            (r: string) =>
              r.includes('INJURY') ||
              r.includes('伤停压小') ||
              r.includes('伤停转向') ||
              r.includes('核心缺阵'),
          );
          const existingIntel = (row.intelAdjustments as unknown as Record<string, unknown> | null) ?? {};
          const existingR80 = (existingIntel.r80Injury as Record<string, unknown> | null) ?? {};
          await this.db.update(basketballMatches)
            .set({
              injuryAdjustApplied: String(anchorPred.injuryAdjustApplied),
              injuryAdjustPct: anchorPred.injuryAdjustPct,
              intelAdjustments: {
                ...existingIntel,
                r80Injury: {
                  ...existingR80,
                  spread: anchorPred.injuryAdjustApplied,
                  total: 0,
                  homeCoreMissing: injuryInfo.homeCore,
                  awayCoreMissing: injuryInfo.awayCore,
                  detail: injuryInfo.summary,
                  injuryRules,
                  ruleVersion: 'R-INJURY-V10',
                },
                applied: anchorPred.injuryAdjustApplied !== 0,
              },
              updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(basketballMatches.id, row.id));
          frozenUpdated += 1;
        }

        results.push({
          matchNo: row.matchNo || '',
          homeTeam: row.homeTeam || '',
          awayTeam: row.awayTeam || '',
          isFrozen: isOfficialLocked,
          before,
          after,
          changes,
          injurySummary: injuryInfo.summary,
        });
      } catch (err) {
        errors += 1;
        this.logger.warn(`recalcInjuryAdjustments failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }

    return {
      processed: rows.length,
      updated,
      frozenUpdated,
      noInjury: allRows.length - rows.length,
      errors,
      results,
    };
  }

  // ==================== 状态哨兵 / State Sentinel ====================

  /**
   * 写一条 score_sentinel_logs 记录。
   * 失败仅打 warn 日志，不阻断主流程。
   */
  private async logSentinelEvent(params: {
    matchId?: string;
    matchNo?: string;
    source?: string;
    errorType: string;
    errorDetail?: string;
    attemptedStatus?: string;
    kickoffTime?: Date;
    payload?: Record<string, unknown>;
    prevHomeScore?: number | null;
    prevAwayScore?: number | null;
    wrongHomeScore?: number | null;
    wrongAwayScore?: number | null;
    correctHomeScore?: number | null;
    correctAwayScore?: number | null;
    reason?: string;
  }): Promise<void> {
    try {
      await this.db.insert(scoreSentinelLogs).values({
        matchId: params.matchId ?? undefined,
        matchNo: params.matchNo ?? undefined,
        source: params.source ?? undefined,
        errorType: params.errorType,
        errorDetail: params.errorDetail ?? undefined,
        attemptedStatus: params.attemptedStatus ?? undefined,
        kickoffTime: params.kickoffTime ?? undefined,
        payload: params.payload ?? undefined,
        prevHomeScore: params.prevHomeScore ?? null,
        prevAwayScore: params.prevAwayScore ?? null,
        wrongHomeScore: params.wrongHomeScore ?? null,
        wrongAwayScore: params.wrongAwayScore ?? null,
        correctHomeScore: params.correctHomeScore ?? null,
        correctAwayScore: params.correctAwayScore ?? null,
        reason: params.reason ?? undefined,
      });
    } catch (logErr) {
      this.logger.warn(`[SENTINEL] log insert failed: ${(logErr as Error).message}`);
    }
  }

  /**
   * 状态流转守护：
   * - 写入 finished / finished_pending / result_pending 前，校验当前时间 >= kickoff_time
   * - 写入 live 前，校验当前时间 >= kickoff_time - 15min（开赛15分钟内才允许转live）
   * - 校验失败则：拒绝写入 + 插入 score_sentinel_logs（error_type=state_time_guard）
   * - 返回 { allowed: boolean, reason?: string }
   */
  async guardStatusTransition(params: {
    matchId?: string;
    matchNo?: string;
    source?: string;
    kickoffTime: Date;
    targetStatus: string;
    currentStatus?: string;
    payload?: Record<string, unknown>;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { matchId, matchNo, source, kickoffTime, targetStatus, currentStatus, payload } = params;
    const now = new Date();
    const kickoffMs = kickoffTime.getTime();
    const nowMs = now.getTime();

    // 状态未变化直接放行
    if (currentStatus && currentStatus === targetStatus) {
      return { allowed: true };
    }

    const terminalStatuses = ['finished', 'finished_pending', 'result_pending'];
    if (terminalStatuses.includes(targetStatus)) {
      if (nowMs < kickoffMs) {
        const reason = `目标状态 ${targetStatus} 早于开赛时间 ${kickoffTime.toISOString()}，当前 ${now.toISOString()}`;
        this.logger.warn(`[STATE-GUARD] ${matchNo ?? matchId ?? 'unknown'}: ${reason}`);
        await this.logSentinelEvent({
          matchId,
          matchNo,
          source,
          errorType: 'state_time_guard',
          errorDetail: reason,
          attemptedStatus: targetStatus,
          kickoffTime,
          payload,
        });
        return { allowed: false, reason };
      }
      return { allowed: true };
    }

    if (targetStatus === 'live') {
      const liveWindowStartMs = kickoffMs - 15 * 60 * 1000;
      if (nowMs < liveWindowStartMs) {
        const reason = `目标状态 live 早于开赛-15min窗口（窗口开始 ${new Date(liveWindowStartMs).toISOString()}），当前 ${now.toISOString()}`;
        this.logger.warn(`[STATE-GUARD] ${matchNo ?? matchId ?? 'unknown'}: ${reason}`);
        await this.logSentinelEvent({
          matchId,
          matchNo,
          source,
          errorType: 'state_time_guard',
          errorDetail: reason,
          attemptedStatus: targetStatus,
          kickoffTime,
          payload,
        });
        return { allowed: false, reason };
      }
      return { allowed: true };
    }

    // upcoming / 其他状态无条件放行（往回退或未知状态由调用方自行判断）
    return { allowed: true };
  }

  /**
   * 反向守护（告警不拦截）：扫描 kickoff_time 已过超过 3 小时但状态仍为 upcoming 的记录，
   * 写入 sentinel 日志（error_type=stale_upcoming），不自动改状态。
   */
  async scanStaleUpcomingMatches(): Promise<{
    scanned: number;
    staleCount: number;
    logged: number;
  }> {
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const threeHoursAgoIso = threeHoursAgo.toISOString();

    const staleRows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        source: basketballMatches.source,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
          lt(basketballMatches.kickoffTime, sql`${threeHoursAgoIso}::timestamptz`),
        ),
      );

    let logged = 0;
    for (const row of staleRows) {
      const kickoffIso = row.kickoffTime instanceof Date
        ? row.kickoffTime.toISOString()
        : String(row.kickoffTime);
      await this.logSentinelEvent({
        matchId: row.id,
        matchNo: row.matchNo,
        source: row.source ?? undefined,
        errorType: 'stale_upcoming',
        errorDetail: `开赛已超过3小时仍为upcoming，kickoff=${kickoffIso}，当前=${now.toISOString()}`,
        attemptedStatus: 'upcoming',
        kickoffTime: row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime)),
        payload: {
          league: row.league,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
        },
      });
      logged += 1;
    }

    return {
      scanned: staleRows.length,
      staleCount: staleRows.length,
      logged,
    };
  }

  /**
   * 让分符号一致性校验：
   * - 翻转主客队后，让分方不变时符号不应翻转（同一场双方换位，让分方仍是那支队）
   * - 写入 handicap_line_num 必须带 evidenceSource（sporttery官方/FOX/ESPN/手动-已核）
   * - 无依据禁止写入（返回 allowed: false）
   * - 校验失败写入 sentinel 日志（error_type=handicap_sign_mismatch）
   */
  async validateHandicapSign(params: {
    matchId?: string;
    matchNo?: string;
    homeTeam: string;
    awayTeam: string;
    handicapLineNum: number;
    evidenceSource: string;
    prevHomeTeam?: string;
    prevAwayTeam?: string;
    prevHandicapLine?: number;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const {
      matchId, matchNo,
      homeTeam, awayTeam,
      handicapLineNum,
      evidenceSource,
      prevHomeTeam, prevAwayTeam, prevHandicapLine,
    } = params;

    // evidenceSource 必须是非空字符串
    if (!evidenceSource || typeof evidenceSource !== 'string' || evidenceSource.trim().length === 0) {
      const reason = '缺少 evidenceSource，禁止写入 handicap_line_num';
      this.logger.warn(`[HANDICAP-SIGN] ${matchNo ?? matchId ?? 'unknown'}: ${reason}`);
      await this.logSentinelEvent({
        matchId,
        matchNo,
        errorType: 'handicap_sign_mismatch',
        errorDetail: reason,
        payload: {
          homeTeam, awayTeam,
          handicapLineNum,
          prevHomeTeam, prevAwayTeam, prevHandicapLine,
        },
      });
      return { allowed: false, reason };
    }

    // 没有翻转前数据，无法判断翻转关系，按来源可信直接放行（但 evidenceSource 已校验）
    if (!prevHomeTeam || !prevAwayTeam || prevHandicapLine === undefined || prevHandicapLine === null) {
      return { allowed: true };
    }

    // 判断主客队是否翻转
    const isFlipped = prevHomeTeam === awayTeam && prevAwayTeam === homeTeam;
    if (!isFlipped) {
      return { allowed: true };
    }

    // 主客翻转了，检查符号是否也翻转了
    const prevSign = Math.sign(prevHandicapLine);
    const newSign = Math.sign(handicapLineNum);

    // 若翻转主客但让分方未变，符号不得翻转（新符号应与旧符号相同）
    if (prevSign !== 0 && newSign !== 0 && prevSign !== newSign) {
      const reason = `主客翻转后让分符号也翻转了：prev=${prevHandicapLine}（prevHome=${prevHomeTeam}）-> new=${handicapLineNum}（newHome=${homeTeam}），翻转后主客换位但让分方不变，符号应保持一致`;
      this.logger.warn(`[HANDICAP-SIGN] ${matchNo ?? matchId ?? 'unknown'}: ${reason}`);
      await this.logSentinelEvent({
        matchId,
        matchNo,
        errorType: 'handicap_sign_mismatch',
        errorDetail: reason,
        payload: {
          homeTeam, awayTeam,
          handicapLineNum,
          prevHomeTeam, prevAwayTeam, prevHandicapLine,
          evidenceSource,
        },
      });
      return { allowed: false, reason };
    }

    return { allowed: true };
  }

  /**
   * 方向哨兵基准升级：多层校验
   * 层级1：队名方向 → 主客队名非空且不相同
   * 层级2：比分合理 → 两队≥20分、总分60-300、分差≤80（仅finished/live）
   * 层级3：分差突变 → live比分较上次变化≤30分（一次请求）
   * 层级4：盘口对齐 → 让分符号与让分方一致（validateHandicapSign轻量版）
   * 层级5：状态时间 → finished必须过了开赛时间（guardStatusTransition）
   */
  async validateBasketballDirectionSentinel(params: {
    matchId?: string;
    matchNo?: string;
    homeTeam: string;
    awayTeam: string;
    homeScore?: number | null;
    awayScore?: number | null;
    prevHomeScore?: number | null;
    prevAwayScore?: number | null;
    handicapLineNum?: number | null;
    matchStatus: string;
    kickoffTime: Date;
    source?: string;
    evidenceSource?: string;
  }): Promise<{ passed: boolean; failures: string[] }> {
    const {
      matchId, matchNo,
      homeTeam, awayTeam,
      homeScore, awayScore,
      prevHomeScore, prevAwayScore,
      handicapLineNum,
      matchStatus, kickoffTime, source,
      evidenceSource,
    } = params;

    const failures: string[] = [];

    // 层级1：队名方向
    if (!homeTeam || !awayTeam || homeTeam.trim() === '' || awayTeam.trim() === '') {
      failures.push('层级1-队名方向: 主客队名不能为空');
    } else if (homeTeam === awayTeam) {
      failures.push('层级1-队名方向: 主客队名相同');
    }

    // 层级2：比分合理（仅 finished / live）
    if ((matchStatus === 'finished' || matchStatus === 'live')
        && homeScore != null && awayScore != null) {
      const total = homeScore + awayScore;
      const diff = Math.abs(homeScore - awayScore);
      if (homeScore < 20 || awayScore < 20) {
        failures.push('层级2-比分合理: 单队低于20分');
      }
      if (total < 60 || total > 300) {
        failures.push('层级2-比分合理: 总分不在60-300范围内');
      }
      if (diff > 80) {
        failures.push('层级2-比分合理: 分差超过80分');
      }
    }

    // 层级3：分差突变（仅 live，且有前后比分）
    if (matchStatus === 'live'
        && homeScore != null && awayScore != null
        && prevHomeScore != null && prevAwayScore != null) {
      const homeDiff = Math.abs(homeScore - prevHomeScore);
      const awayDiff = Math.abs(awayScore - prevAwayScore);
      if (homeDiff > 30 || awayDiff > 30) {
        failures.push(`层级3-分差突变: 单队得分变化>30分（主${prevHomeScore}→${homeScore}，客${prevAwayScore}→${awayScore}）`);
      }
    }

    // 层级4：盘口对齐（轻量版：让分符号是否与强队一致）
    if (handicapLineNum != null && !Number.isNaN(Number(handicapLineNum)) && homeTeam && awayTeam) {
      // 轻量校验：handicapLineNum 非0时应有明确方向（0是合理值但不校验对齐）
      const hNum = Number(handicapLineNum);
      if (hNum !== 0 && evidenceSource && evidenceSource.trim().length === 0) {
        failures.push('层级4-盘口对齐: 有让分线但缺少evidenceSource');
      }
    }

    // 层级5：状态时间（finished 必须过了开赛时间）
    if (matchStatus === 'finished') {
      const now = new Date();
      if (now.getTime() < kickoffTime.getTime()) {
        failures.push(`层级5-状态时间: finished状态早于开赛时间 ${kickoffTime.toISOString()}`);
      }
    }

    const passed = failures.length === 0;
    if (!passed && (matchId || matchNo)) {
      await this.logSentinelEvent({
        matchId,
        matchNo,
        source,
        errorType: 'direction_sentinel_multi',
        errorDetail: failures.join('; '),
        attemptedStatus: matchStatus,
        kickoffTime,
        payload: {
          homeTeam, awayTeam,
          homeScore, awayScore,
          prevHomeScore, prevAwayScore,
          handicapLineNum,
          failures,
        },
      });
    }

    return { passed, failures };
  }

  private hasMeaningfulInjury(obj: Record<string, unknown>): boolean {
    const sides = ['home', 'away'];
    for (const side of sides) {
      const val = obj[side];
      if (Array.isArray(val)) {
        if (val.length > 0) {
          const first = val[0];
          if (typeof first === 'object' && first !== null) return true;
          if (typeof first === 'string' && first.trim().length > 0) return true;
        }
      }
    }
    return false;
  }

  private extractCoreInjuryCountFromRow(row: { injuries: unknown; keyPlayers?: unknown }): {
    homeCore: number;
    awayCore: number;
    summary: string;
  } {
    const raw = row.injuries;
    let obj: Record<string, unknown> | null = null;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
      } catch {
        return { homeCore: 0, awayCore: 0, summary: '解析失败' };
      }
    } else if (raw && typeof raw === 'object') {
      obj = raw as Record<string, unknown>;
    }
    if (!obj) return { homeCore: 0, awayCore: 0, summary: '无数据' };

    const OUT_STATUSES = ['赛季报销', '报销', '缺阵', '缺席', '缺战', '休战', '伤缺', '无法出战', '未出战', '伤停', '无限期缺阵', 'Out', 'out'];
    const DOUBTFUL_STATUSES = ['出战成疑', '带伤出战', '预计出战', '带伤', '恢复中', '可能出战', '存疑', 'Questionable', 'Doubtful', 'Day-To-Day'];

    const kp = row.keyPlayers;
    const homeKeyNames: string[] = [];
    const awayKeyNames: string[] = [];
    if (kp && typeof kp === 'object') {
      const kpObj = kp as Record<string, unknown>;
      const extractNames = (side: string): string[] => {
        const arr = kpObj[side];
        if (!Array.isArray(arr)) return [];
        return arr
          .map((p: unknown) => {
            if (typeof p === 'string') return p;
            if (p && typeof p === 'object') return String((p as Record<string, unknown>).name || '');
            return '';
          })
          .filter((n: string) => n.length > 0);
      };
      homeKeyNames.push(...extractNames('home'));
      awayKeyNames.push(...extractNames('away'));
    }

    const calcSide = (sideVal: unknown, keyNames: string[]): { core: number; total: number; names: string[] } => {
      if (!Array.isArray(sideVal)) return { core: 0, total: 0, names: [] };
      let core = 0;
      let total = 0;
      const names: string[] = [];
      for (const item of sideVal) {
        let name = '';
        let status = '';
        if (typeof item === 'string') {
          name = item;
          status = '缺阵';
        } else if (item && typeof item === 'object') {
          const it = item as Record<string, unknown>;
          name = String(it.name || it.playerName || it.player || '');
          status = String(it.status || '');
        }
        if (!name) continue;
        const isOut = OUT_STATUSES.some((s) => status.includes(s));
        const isDoubtful = DOUBTFUL_STATUSES.some((s) => status.includes(s));
        if (!isOut && !isDoubtful && status) continue;
        total += 1;
        const isCore = keyNames.length > 0
          ? keyNames.some((kn) => name.includes(kn) || kn.includes(name))
          : total <= 2;
        if (isCore && isOut) {
          core += 1;
          names.push(name);
        } else if (isCore && isDoubtful) {
          core += 0.5;
          names.push(name + '(疑)');
        }
      }
      return { core: Math.round(core * 10) / 10, total, names };
    };

    const h = calcSide(obj.home, homeKeyNames);
    const a = calcSide(obj.away, awayKeyNames);

    const parts: string[] = [];
    if (h.core > 0) parts.push(`主队核心缺阵${h.core}人(${h.names.join(',')})`);
    if (a.core > 0) parts.push(`客队核心缺阵${a.core}人(${a.names.join(',')})`);
    if (parts.length === 0) parts.push(`角色球员缺阵(主${h.total}客${a.total})`);

    return {
      homeCore: h.core,
      awayCore: a.core,
      summary: parts.join(' / '),
    };
  }
}
