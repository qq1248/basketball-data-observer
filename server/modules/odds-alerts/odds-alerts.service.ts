import { Injectable, Logger, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches } from '@server/database/schema';
import { and, eq, ilike, sql, count, inArray } from 'drizzle-orm';
import type { OddsAlertItem, OddsAlertsResponse } from '@shared/api.interface';

@Injectable()
export class OddsAlertsService {
  private readonly logger = new Logger(OddsAlertsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getAlerts(threshold: number, league?: string, date?: string): Promise<OddsAlertsResponse> {
    try {
      // --- Monitored count: matches with odds data on the given date ---
      const baseConditions = [
        sql`(
          (${matches.oddsLiveHome} IS NOT NULL AND ${matches.oddsLiveHome}::numeric > 0)
          OR (${matches.oddsLiveDraw} IS NOT NULL AND ${matches.oddsLiveDraw}::numeric > 0)
          OR (${matches.oddsLiveAway} IS NOT NULL AND ${matches.oddsLiveAway}::numeric > 0)
          OR (${matches.handicapOddsHome} IS NOT NULL AND ${matches.handicapOddsHome}::numeric > 0)
          OR (${matches.handicapOddsAway} IS NOT NULL AND ${matches.handicapOddsAway}::numeric > 0)
          OR (${matches.totalOddsOver} IS NOT NULL AND ${matches.totalOddsOver}::numeric > 0)
          OR (${matches.totalOddsUnder} IS NOT NULL AND ${matches.totalOddsUnder}::numeric > 0)
        )`,
      ];
      if (date) {
        baseConditions.push(eq(matches.matchDate, date));
      }
      if (league) {
        baseConditions.push(ilike(matches.league, `%${league}%`));
      }

      const monitoredCountResult = await this.db
        .select({ count: count() })
        .from(matches)
        .where(and(...baseConditions));
      const monitoredCount = Number(monitoredCountResult[0]?.count ?? 0);

      // --- Real alerts from odds_snapshots: adjacent snapshot comparison ---
      // Build date filter for match kickoff time
      const dateCondition = date
        ? sql`AND m.match_date = ${date}::date`
        : sql``;
      const leagueCondition = league
        ? sql`AND m.league ILIKE ${`%${league}%`}`
        : sql``;

      // Use LAG() window function to get previous snapshot per match+type
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
          FROM odds_snapshots s
          JOIN matches m ON m.id = s.match_id
          WHERE 1=1
            ${dateCondition}
            ${leagueCondition}
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
        JOIN matches m ON m.id = r.match_id
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

      const items: OddsAlertItem[] = [];
      const ABS_THRESHOLD = threshold; // absolute difference threshold for odds values

      for (const row of rows) {
         const curr = row.odds_json as Record<string, unknown>;
         const prev = row.prev_json as Record<string, unknown>;
         const oddsType = row.odds_type as '1x2' | 'handicap' | 'total';
         const createdAtDate = new Date(row.created_at);
         const kickoffDate = new Date(row.kickoff_time);
         const detectedAt = createdAtDate.toISOString();
         const detectedAtMs = createdAtDate.getTime();
         const kickoffIso = kickoffDate.toISOString();

        if (oddsType === '1x2') {
          // Check home, draw, away
          const fields: Array<{ key: string; label: string }> = [
            { key: 'home', label: '主胜指数' },
            { key: 'draw', label: '平局指数' },
            { key: 'away', label: '客胜指数' },
          ];
          for (const f of fields) {
            const oldVal = Number(prev[f.key]);
            const newVal = Number(curr[f.key]);
            if (oldVal > 0 && newVal > 0) {
              const diff = newVal - oldVal;
              if (Math.abs(diff) >= ABS_THRESHOLD) {
                const changePct = oldVal > 0 ? (diff / oldVal) * 100 : 0;
                items.push({
                   id: `${row.match_id}-1x2-${f.key}-${detectedAtMs}`,
                  matchId: row.match_id,
                  matchNo: row.match_no,
                  league: row.league,
                  homeTeam: row.home_team,
                  awayTeam: row.away_team,
                   kickoffTime: kickoffIso,
                  oddsType: '1x2',
                  changedField: f.label,
                  initialValue: Math.round(oldVal * 100) / 100,
                  currentValue: Math.round(newVal * 100) / 100,
                  changeAmount: Math.round(diff * 100) / 100,
                  changePercent: Math.round(changePct * 100) / 100,
                  changeDirection: diff >= 0 ? 'up' : 'down',
                  detectedAt,
                });
              }
            }
          }
        } else if (oddsType === 'handicap') {
          // Check line change (handicap line movement)
          const oldLine = Number(prev['line']);
          const newLine = Number(curr['line']);
          if (!Number.isNaN(oldLine) && !Number.isNaN(newLine) && oldLine !== newLine) {
            const diff = newLine - oldLine;
            items.push({
              id: `${row.match_id}-handicap-line-${detectedAtMs}`,
               matchId: row.match_id,
               matchNo: row.match_no,
               league: row.league,
               homeTeam: row.home_team,
               awayTeam: row.away_team,
               kickoffTime: kickoffIso,
              oddsType: 'handicap',
              changedField: '让球指数线',
              initialValue: Math.round(oldLine * 100) / 100,
              currentValue: Math.round(newLine * 100) / 100,
              changeAmount: Math.round(diff * 100) / 100,
              changePercent: oldLine !== 0 ? Math.round((diff / Math.abs(oldLine)) * 10000) / 100 : 0,
              changeDirection: diff >= 0 ? 'up' : 'down',
              detectedAt,
            });
          }
          // Also check home/away handicap odds
          const fields: Array<{ key: string; label: string }> = [
            { key: 'home', label: '让球主胜指数' },
            { key: 'draw', label: '让球平局指数' },
            { key: 'away', label: '让球客胜指数' },
          ];
          for (const f of fields) {
            const oldVal = Number(prev[f.key]);
            const newVal = Number(curr[f.key]);
            if (oldVal > 0 && newVal > 0) {
              const diff = newVal - oldVal;
              if (Math.abs(diff) >= ABS_THRESHOLD) {
                const changePct = oldVal > 0 ? (diff / oldVal) * 100 : 0;
                items.push({
                   id: `${row.match_id}-handicap-${f.key}-${detectedAtMs}`,
                  matchId: row.match_id,
                  matchNo: row.match_no,
                  league: row.league,
                  homeTeam: row.home_team,
                  awayTeam: row.away_team,
                   kickoffTime: kickoffIso,
                  oddsType: 'handicap',
                  changedField: f.label,
                  initialValue: Math.round(oldVal * 100) / 100,
                  currentValue: Math.round(newVal * 100) / 100,
                  changeAmount: Math.round(diff * 100) / 100,
                  changePercent: Math.round(changePct * 100) / 100,
                  changeDirection: diff >= 0 ? 'up' : 'down',
                  detectedAt,
                });
              }
            }
          }
        } else if (oddsType === 'total') {
          // Check total line change
          const oldLine = Number(prev['line']);
          const newLine = Number(curr['line']);
          if (!Number.isNaN(oldLine) && !Number.isNaN(newLine) && oldLine !== newLine) {
            const diff = newLine - oldLine;
            items.push({
              id: `${row.match_id}-total-line-${detectedAtMs}`,
               matchId: row.match_id,
               matchNo: row.match_no,
               league: row.league,
               homeTeam: row.home_team,
               awayTeam: row.away_team,
               kickoffTime: kickoffIso,
              oddsType: 'total',
              changedField: '大小球指数线',
              initialValue: Math.round(oldLine * 100) / 100,
              currentValue: Math.round(newLine * 100) / 100,
              changeAmount: Math.round(diff * 100) / 100,
              changePercent: oldLine !== 0 ? Math.round((diff / Math.abs(oldLine)) * 10000) / 100 : 0,
              changeDirection: diff >= 0 ? 'up' : 'down',
              detectedAt,
            });
          }
          // Check over/under odds
          const fields: Array<{ key: string; label: string }> = [
            { key: 'over', label: '大球指数' },
            { key: 'under', label: '小球指数' },
          ];
          for (const f of fields) {
            const oldVal = Number(prev[f.key]);
            const newVal = Number(curr[f.key]);
            if (oldVal > 0 && newVal > 0) {
              const diff = newVal - oldVal;
              if (Math.abs(diff) >= ABS_THRESHOLD) {
                const changePct = oldVal > 0 ? (diff / oldVal) * 100 : 0;
                items.push({
                   id: `${row.match_id}-total-${f.key}-${detectedAtMs}`,
                  matchId: row.match_id,
                  matchNo: row.match_no,
                  league: row.league,
                  homeTeam: row.home_team,
                  awayTeam: row.away_team,
                   kickoffTime: kickoffIso,
                  oddsType: 'total',
                  changedField: f.label,
                  initialValue: Math.round(oldVal * 100) / 100,
                  currentValue: Math.round(newVal * 100) / 100,
                  changeAmount: Math.round(diff * 100) / 100,
                  changePercent: Math.round(changePct * 100) / 100,
                  changeDirection: diff >= 0 ? 'up' : 'down',
                  detectedAt,
                });
              }
            }
          }
        }
      }

      // Enrich with prediction direction & intel from matches
      const uniqueMatchIdsArr = Array.from(new Set(items.map((i) => i.matchId)));
      if (uniqueMatchIdsArr.length > 0) {
        const matchInfos = await this.db
          .select({
            id: matches.id,
            predictionDirection: matches.predictionDirection,
            handicapRecommendation: matches.handicapRecommendation,
            totalPick: matches.totalPick,
            intel: matches.intel,
          })
          .from(matches)
          .where(inArray(matches.id, uniqueMatchIdsArr));
        const matchInfoMap = new Map(matchInfos.map((m) => [m.id, m]));

        for (const item of items) {
          const info = matchInfoMap.get(item.matchId);
          if (info) {
            item.intel = info.intel ?? undefined;
            const alignment = this.computeDirectionAlignment(
              item.oddsType,
              item.changedField,
              item.changeDirection,
              info.predictionDirection ?? null,
              info.handicapRecommendation ?? null,
              info.totalPick ?? null,
            );
            item.predictionDirection = alignment.direction;
            item.predictionType = alignment.type;
            item.directionAlign = alignment.align;
          }
        }
      }

      // Sort by detected time descending (newest first)
      items.sort((a: OddsAlertItem, b: OddsAlertItem) =>
        new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
      );

      const uniqueMatchIds = new Set(items.map((i) => i.matchId));

      return {
        items,
        total: items.length,
        monitoredCount,
        matchCount: uniqueMatchIds.size,
      };
    } catch (error) {
      this.logger.error(`获取指数异动失败 threshold=${threshold}`, JSON.stringify(error));
      throw error;
    }
  }

  /**
   * 计算异动方向与预测方向的一致性
    * - 指数类：指数上涨 = 该结果概率降低 = 若预测指向该方则相悖
    * - 指数线类：线移动代表看好方向
   */
  private computeDirectionAlignment(
    oddsType: '1x2' | 'handicap' | 'total',
    changedField: string,
    changeDirection: 'up' | 'down',
    predictionDirection: string | null,
    handicapRecommendation: string | null,
    totalPick: string | null,
  ): {
    direction: string | undefined;
    type: ('wdw' | 'handicap' | 'overunder') | undefined;
    align: 'consistent' | 'opposite' | 'unknown';
  } {
    const isUp = changeDirection === 'up';

    if (oddsType === '1x2') {
      if (!predictionDirection) {
        return { direction: undefined, type: undefined, align: 'unknown' };
      }
      // 判断异动的是哪一方
      let movingSide: 'home' | 'draw' | 'away' | null = null;
      if (changedField.includes('主胜')) movingSide = 'home';
      else if (changedField.includes('平局')) movingSide = 'draw';
      else if (changedField.includes('客胜')) movingSide = 'away';

      if (!movingSide) {
        return {
          direction: predictionDirection,
          type: 'wdw',
          align: 'unknown',
        };
      }

      // 判断预测方向指向哪一方
      let predSide: 'home' | 'draw' | 'away' | null = null;
      if (predictionDirection.includes('主胜') || predictionDirection === '主胜') predSide = 'home';
      else if (predictionDirection.includes('客胜') || predictionDirection === '客胜') predSide = 'away';
      else if (predictionDirection.includes('平') || predictionDirection === '平') predSide = 'draw';

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

    if (oddsType === 'handicap') {
      if (!handicapRecommendation) {
        return { direction: undefined, type: undefined, align: 'unknown' };
      }

      const isLineChange = changedField.includes('指数线');

      if (isLineChange) {
        // 让球指数线变化：line up（主队让更多/让更深）= 看好主队赢指数
        // handicap_recommendation 常见值：让球主胜、让球客胜、让球平局等
        const predFavorsHome = handicapRecommendation.includes('主胜');
        const predFavorsAway = handicapRecommendation.includes('客胜');
        // line up = 主队让更深 = 看好主队赢指数
        const moveFavorsHome = isUp;
        let align: 'consistent' | 'opposite' | 'unknown' = 'unknown';
        if (predFavorsHome) {
          align = moveFavorsHome ? 'consistent' : 'opposite';
        } else if (predFavorsAway) {
          align = moveFavorsHome ? 'opposite' : 'consistent';
        }
        return {
          direction: handicapRecommendation,
          type: 'handicap',
          align,
        };
      }

      // 让球指数变化
      let movingSide: 'home' | 'away' | 'draw' | null = null;
      if (changedField.includes('主胜')) movingSide = 'home';
      else if (changedField.includes('客胜')) movingSide = 'away';
      else if (changedField.includes('平局')) movingSide = 'draw';

      let predSide: 'home' | 'away' | 'draw' | null = null;
      if (handicapRecommendation.includes('主胜')) predSide = 'home';
      else if (handicapRecommendation.includes('客胜')) predSide = 'away';
      else if (handicapRecommendation.includes('平')) predSide = 'draw';

      if (!movingSide || !predSide) {
        return {
          direction: handicapRecommendation,
          type: 'handicap',
          align: 'unknown',
        };
      }

      // 指数上涨 = 该让球结果不被看好 = 若预测指向该方则相悖
      const sameSide = movingSide === predSide;
      const align: 'consistent' | 'opposite' = sameSide
        ? (isUp ? 'opposite' : 'consistent')
        : (isUp ? 'consistent' : 'opposite');

      return {
        direction: handicapRecommendation,
        type: 'handicap',
        align,
      };
    }

    if (oddsType === 'total') {
      if (!totalPick) {
        return { direction: undefined, type: undefined, align: 'unknown' };
      }

      const isLineChange = changedField.includes('指数线');
      const predIsOver = totalPick.includes('大') || totalPick.includes('over');

      if (isLineChange) {
        // 大小球指数线上升 = 看好大球
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

      // 大球/小球指数变化
      const movingOver = changedField.includes('大球');
      const movingUnder = changedField.includes('小球');
      if (!movingOver && !movingUnder) {
        return {
          direction: totalPick,
          type: 'overunder',
          align: 'unknown',
        };
      }

      // 指数上涨 = 该结果概率降低
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
}
