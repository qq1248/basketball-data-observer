import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, modelRuleDetails } from '@server/database/schema';
import { sql, count, desc, eq } from 'drizzle-orm';
import type { MatchStatsResponse } from '@shared/api.interface';
import { FOOTBALL_MODEL_CONFIG, STATS_CONFIG } from '@server/common/model-config';

@Injectable()
export class StatisticsService {
  private readonly logger = new Logger(StatisticsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getOverview(): Promise<MatchStatsResponse> {
    try {
      // ===== Overview counts (all matches, finished, hit totals) =====
      const [countRow] = await this.db
        .select({
          total: sql<number>`count(*)`,
          finished: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished')`,
          wdwHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitWdw} = true)`,
          wdwTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitWdw} is not null)`,
          hcHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitHandicap} = true)`,
          hcTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitHandicap} is not null)`,
          ouHits: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitOverunder} = true)`,
          ouTotal: sql<number>`count(*) filter (where ${matches.matchStatus} = 'finished' and ${matches.hitOverunder} is not null)`,
        })
        .from(matches);

      const totalMatches = Number(countRow.total);
      const finishedMatches = Number(countRow.finished);
      const wdwHits = Number(countRow.wdwHits);
      const wdwTotal = Number(countRow.wdwTotal);
      const hcHits = Number(countRow.hcHits);
      const hcTotal = Number(countRow.hcTotal);
      const ouHits = Number(countRow.ouHits);
      const ouTotal = Number(countRow.ouTotal);

      const winDrawWinHitRate = wdwTotal > 0 ? Math.round((wdwHits / wdwTotal) * 1000) / 1000 : 0;
      const handicapHitRate = hcTotal > 0 ? Math.round((hcHits / hcTotal) * 1000) / 1000 : 0;
      const overUnderHitRate = ouTotal > 0 ? Math.round((ouHits / ouTotal) * 1000) / 1000 : 0;

      // ===== byLeague (finished matches, wdw hit rate) =====
      const leagueRows = await this.db
        .select({
          league: matches.league,
          total: sql<number>`count(*) filter (where ${matches.hitWdw} is not null)`,
          hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
        })
        .from(matches)
        .where(eq(matches.matchStatus, 'finished'))
        .groupBy(matches.league)
        .orderBy(desc(sql`count(*)`));

      const byLeague = leagueRows.map((row) => {
        const t = Number(row.total);
        return {
          league: row.league,
          count: t,
          hitRate: t > 0 ? Math.round((Number(row.hits) / t) * 1000) / 1000 : 0,
        };
      });

      // ===== byDate (last N days, finished matches, wdw hit rate) =====
      const byDate: { date: string; count: number; hitRate: number }[] = [];
      const now = new Date();
      const todayBeijing = new Date(now.getTime() + STATS_CONFIG.beijingOffsetHours * 60 * 60 * 1000);
      const dateList: string[] = [];
      for (let i = STATS_CONFIG.recentDays - 1; i >= 0; i -= 1) {
        const d = new Date(todayBeijing);
        d.setDate(d.getDate() - i);
        dateList.push(d.toISOString().slice(0, 10));
      }
      const startDate = dateList[0];
      const endDate = dateList[dateList.length - 1];
      const dateRows = await this.db
        .select({
          date: sql<string>`${matches.businessDate}::text`,
          total: sql<number>`count(*) filter (where ${matches.hitWdw} is not null)`,
          hits: sql<number>`count(*) filter (where ${matches.hitWdw} = true)`,
        })
        .from(matches)
        .where(sql`${matches.businessDate} between ${startDate}::date and ${endDate}::date and ${matches.matchStatus} = 'finished'`)
        .groupBy(matches.businessDate)
        .orderBy(matches.businessDate);
      const dateMap = new Map<string, { total: number; hits: number }>();
      for (const r of dateRows) {
        dateMap.set(r.date, { total: Number(r.total), hits: Number(r.hits) });
      }
      for (const dateStr of dateList) {
        const r = dateMap.get(dateStr) ?? { total: 0, hits: 0 };
        byDate.push({
          date: dateStr,
          count: r.total,
          hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 1000 : 0,
        });
      }

      // ===== byRule (from model_rule_details table) =====
      const ruleRows = await this.db
        .select({
          ruleCode: modelRuleDetails.ruleCode,
          ruleName: modelRuleDetails.ruleName,
          hitRate: modelRuleDetails.hitRate,
          sampleSize: modelRuleDetails.sampleSize,
        })
        .from(modelRuleDetails)
        .orderBy(modelRuleDetails.sortOrder);

      const byRule = ruleRows.map((row: { ruleCode: string; ruleName: string; hitRate: string | number; sampleSize: number | null }) => ({
        ruleCode: row.ruleCode,
        ruleName: row.ruleName,
        count: row.sampleSize ?? Math.floor(finishedMatches * 0.3),
        hitRate: row.hitRate ? Number(row.hitRate) : 0,
      }));

      // ===== byConfidence (finished matches, wdw hit rate) =====
      const highThreshold = FOOTBALL_MODEL_CONFIG.confidence.highGroupBy;
      const mediumThreshold = FOOTBALL_MODEL_CONFIG.confidence.mediumGroupBy;
      const confRows = await this.db.execute(sql<{
        confidence_level: string;
        total_cnt: number;
        hit_cnt: number;
      }>`
        SELECT
          CASE
            WHEN ${matches.confidence} >= ${highThreshold} THEN 'high'
            WHEN ${matches.confidence} >= ${mediumThreshold} THEN 'medium'
            ELSE 'low'
          END AS confidence_level,
          count(*) filter (where ${matches.hitWdw} is not null) AS total_cnt,
          count(*) filter (where ${matches.hitWdw} = true) AS hit_cnt
        FROM ${matches}
        WHERE ${matches.matchStatus} = 'finished'
        GROUP BY 1
      `);

      const confOrder = ['high', 'medium', 'low'];
      const confMap = new Map<string, { total: number; hits: number }>();
      const confRowsArr = (confRows as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
      for (const r of confRowsArr) {
        confMap.set(String(r.confidence_level), {
          total: Number(r.total_cnt) || 0,
          hits: Number(r.hit_cnt) || 0,
        });
      }
      const byConfidence = confOrder.map((level) => {
        const r = confMap.get(level) ?? { total: 0, hits: 0 };
        return {
          level,
          count: r.total,
          hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 1000 : 0,
        };
      });

      // ===== byHandicap (finished matches, handicap hit rate) =====
      const handicapRows = await this.db
        .select({
          handicap: matches.handicap,
          total: sql<number>`count(*) filter (where ${matches.hitHandicap} is not null)`,
          hits: sql<number>`count(*) filter (where ${matches.hitHandicap} = true)`,
        })
        .from(matches)
        .where(eq(matches.matchStatus, 'finished'))
        .groupBy(matches.handicap);

      const handicapTypeMap: Record<string, { total: number; hits: number }> = {};
      for (const row of handicapRows) {
        let type = '平手';
        const h = row.handicap;
        if (h.startsWith('-')) {
          const val = Math.abs(parseFloat(h));
          type = `让${val}球`;
        } else if (h.startsWith('+')) {
          const val = Math.abs(parseFloat(h));
          type = `受让${val}球`;
        } else if (h === '0') {
          type = '平手';
        } else {
          type = h;
        }
        if (!handicapTypeMap[type]) {
          handicapTypeMap[type] = { total: 0, hits: 0 };
        }
        handicapTypeMap[type].total += Number(row.total);
        handicapTypeMap[type].hits += Number(row.hits);
      }

      const byHandicap = Object.entries(handicapTypeMap).map(([type, data]) => ({
        type,
        count: data.total,
        hitRate: data.total > 0 ? Math.round((data.hits / data.total) * 1000) / 1000 : 0,
      }));

      return {
        totalMatches,
        finishedMatches,
        winDrawWinHitRate,
        handicapHitRate,
        overUnderHitRate,
        byLeague,
        byDate,
        byRule,
        byConfidence,
        byHandicap,
      };
    } catch (error) {
      this.logger.error('获取统计总览失败', JSON.stringify(error));
      throw error;
    }
  }
}
