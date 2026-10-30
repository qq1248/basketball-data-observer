import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { ruleDisabled } from '@server/database/schema';
import { eq, sql } from 'drizzle-orm';
import type { RuleBacktestItem, RuleBacktestResponse } from '@shared/api.interface';

type Sport = 'basketball' | 'football';
type Dimension = 'wdw' | 'handicap' | 'overunder';
type RuleDimension = Dimension | 'multi' | 'auxiliary' | 'unknown' | 'core_decision';

interface FinishedMatchRow {
  id: string;
  predictionDirection: string;
  handicapPick: string;
  handicapRecommendation: string;
  totalPick: string;
  ouRecommendation: string;
  modelRules: string[];
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
}

interface ClassifiedRule {
  rule: string;
  dimension: RuleDimension;
  directionWord: string | null;
  ruleGroup: string;
  isAuxiliary: boolean;
}

interface RuleStat {
  total: number;
  adopted: number;
  wdwHit: number;
  wdwTotal: number;
  hcpHit: number;
  hcpTotal: number;
  ouHit: number;
  ouTotal: number;
  classified: ClassifiedRule | null;
}

const BASKETBALL_DIRECTION_MAP: Record<string, Dimension> = {
  主胜: 'wdw',
  客胜: 'wdw',
  让分主胜: 'handicap',
  让分客胜: 'handicap',
  大分: 'overunder',
  小分: 'overunder',
};

const FOOTBALL_DIRECTION_MAP: Record<string, Dimension> = {
  主胜: 'wdw',
  客胜: 'wdw',
  平局: 'wdw',
  让球主胜: 'handicap',
  让球主负: 'handicap',
  让球平: 'handicap',
  大球: 'overunder',
  小球: 'overunder',
  大分: 'overunder',
  小分: 'overunder',
};

const BASKETBALL_AUX_REGEX = [
  /^V\d+ 指数线锚定/,
  /^V\d+ 无指数线：指数反推/,
  /^V\d+ 无指数线实力模型/,
  /^V\d+ 弱基线模式/,
  /^V\d+ 大小分以指数线为锚/,
  /^V\d+ 大小分概率约束/,
  /^数据不足/,
  /^已完赛/,
  /^官方数据/,
];

const FOOTBALL_AUX_REGEX = [
  /^数据不足/,
  /^已完赛/,
  /^官方数据/,
];

@Injectable()
export class RuleBacktestService {
  private readonly logger = new Logger(RuleBacktestService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async runBacktest(sport: Sport): Promise<RuleBacktestResponse> {
    const directionMap = sport === 'basketball' ? BASKETBALL_DIRECTION_MAP : FOOTBALL_DIRECTION_MAP;
    const auxPatterns = sport === 'basketball' ? BASKETBALL_AUX_REGEX : FOOTBALL_AUX_REGEX;

    const rows = await this.queryFinishedMatches(sport);

    const ruleStats = new Map<string, RuleStat>();
    const dimensionTotals = { wdw: { hit: 0, total: 0 }, handicap: { hit: 0, total: 0 }, overunder: { hit: 0, total: 0 } };

    for (const row of rows) {
      if (row.hitWdw !== null) { dimensionTotals.wdw.total += 1; if (row.hitWdw) dimensionTotals.wdw.hit += 1; }
      if (row.hitHandicap !== null) { dimensionTotals.handicap.total += 1; if (row.hitHandicap) dimensionTotals.handicap.hit += 1; }
      if (row.hitOverunder !== null) { dimensionTotals.overunder.total += 1; if (row.hitOverunder) dimensionTotals.overunder.hit += 1; }

      const rules = row.modelRules ?? [];
      const wdwDir = row.predictionDirection ?? '';
      const hcpDir = row.handicapPick || row.handicapRecommendation || '';
      const ouDir = row.totalPick || row.ouRecommendation || '';

      for (const rule of rules) {
        if (!ruleStats.has(rule)) {
          ruleStats.set(rule, {
            total: 0,
            adopted: 0,
            wdwHit: 0,
            wdwTotal: 0,
            hcpHit: 0,
            hcpTotal: 0,
            ouHit: 0,
            ouTotal: 0,
            classified: this.classifyRule(rule, directionMap, auxPatterns),
          });
        }
        const stat = ruleStats.get(rule)!;
        stat.total += 1;

        const classified = stat.classified!;
        if (classified.dimension === 'auxiliary') continue;

        const dim = classified.dimension;
        const dirWord = classified.directionWord ?? '';

        if (dim === 'core_decision') {
          stat.adopted += 1;
          const coreDim = classified.ruleGroup === 'wdw_core' ? 'wdw'
            : classified.ruleGroup === 'handicap_core' ? 'handicap'
            : 'overunder';
          if (coreDim === 'wdw' && row.hitWdw !== null) {
            stat.wdwTotal += 1;
            if (row.hitWdw) stat.wdwHit += 1;
          }
          if (coreDim === 'handicap' && row.hitHandicap !== null) {
            stat.hcpTotal += 1;
            if (row.hitHandicap) stat.hcpHit += 1;
          }
          if (coreDim === 'overunder' && row.hitOverunder !== null) {
            stat.ouTotal += 1;
            if (row.hitOverunder) stat.ouHit += 1;
          }
          continue;
        }

        if (dim === 'wdw') {
          if (dirWord && wdwDir.includes(dirWord)) {
            stat.adopted += 1;
            if (row.hitWdw !== null) {
              stat.wdwTotal += 1;
              if (row.hitWdw) stat.wdwHit += 1;
            }
          }
        } else if (dim === 'handicap') {
          if (dirWord && this.matchHandicapDir(hcpDir, dirWord, sport)) {
            stat.adopted += 1;
            if (row.hitHandicap !== null) {
              stat.hcpTotal += 1;
              if (row.hitHandicap) stat.hcpHit += 1;
            }
          }
        } else if (dim === 'overunder') {
          if (dirWord && this.matchOuDir(ouDir, dirWord, sport)) {
            stat.adopted += 1;
            if (row.hitOverunder !== null) {
              stat.ouTotal += 1;
              if (row.hitOverunder) stat.ouHit += 1;
            }
          }
        } else if (dim === 'multi') {
          let adopted = false;
          if (wdwDir && dirWord && wdwDir.includes(dirWord)) {
            adopted = true;
            if (row.hitWdw !== null) {
              stat.wdwTotal += 1;
              if (row.hitWdw) stat.wdwHit += 1;
            }
          }
          if (hcpDir && dirWord && this.matchHandicapDir(hcpDir, dirWord, sport)) {
            adopted = true;
            if (row.hitHandicap !== null) {
              stat.hcpTotal += 1;
              if (row.hitHandicap) stat.hcpHit += 1;
            }
          }
          if (ouDir && dirWord && this.matchOuDir(ouDir, dirWord, sport)) {
            adopted = true;
            if (row.hitOverunder !== null) {
              stat.ouTotal += 1;
              if (row.hitOverunder) stat.ouHit += 1;
            }
          }
          if (adopted) stat.adopted += 1;
        }
      }
    }

    const items: RuleBacktestItem[] = [];
    for (const [rule, stat] of ruleStats) {
      const adoptedRate = stat.total > 0 ? (stat.adopted / stat.total) * 100 : 0;
      const classified = stat.classified!;

      const wdwHitRate = stat.wdwTotal > 0
        ? Math.round((stat.wdwHit / stat.wdwTotal) * 1000) / 10
        : null;
      const hcpHitRate = stat.hcpTotal > 0
        ? Math.round((stat.hcpHit / stat.hcpTotal) * 1000) / 10
        : null;
      const ouHitRate = stat.ouTotal > 0
        ? Math.round((stat.ouHit / stat.ouTotal) * 1000) / 10
        : null;

      const dimForPrimary = classified.dimension === 'core_decision'
        ? (classified.ruleGroup.replace('_core', '') as Dimension)
        : classified.dimension;
      const primaryHitRate = this.getPrimaryHitRate(dimForPrimary, wdwHitRate, hcpHitRate, ouHitRate);
      const primarySample = this.getPrimarySample(dimForPrimary, stat.wdwTotal, stat.hcpTotal, stat.ouTotal);

      let action: RuleBacktestItem['action'] = 'keep';
      let category: RuleBacktestItem['category'] = 'core';

      if (classified.dimension === 'auxiliary' || adoptedRate < 20) {
        action = 'auxiliary_mark';
        category = 'auxiliary';
      } else if (primarySample < 20) {
        action = 'insufficient_sample';
        category = 'core';
      } else if (primaryHitRate !== null && primaryHitRate < 50) {
        action = 'remove';
        category = 'core';
      } else if (primaryHitRate !== null && primaryHitRate >= 60) {
        action = 'high_confidence';
        category = 'core';
      } else {
        action = 'keep';
        category = 'core';
      }

      items.push({
        rule,
        totalTriggered: stat.total,
        adoptedCount: stat.adopted,
        adoptedRate: Math.round(adoptedRate * 10) / 10,
        wdwHitRate,
        handicapHitRate: hcpHitRate,
        overunderHitRate: ouHitRate,
        primaryDimension: dimForPrimary,
        action,
        category,
        ruleGroup: classified.ruleGroup,
      });
    }

    items.sort((a: RuleBacktestItem, b: RuleBacktestItem) => {
      const actionOrder: Record<string, number> = {
        remove: 0,
        high_confidence: 1,
        keep: 2,
        insufficient_sample: 3,
        auxiliary_mark: 4,
      };
      if (actionOrder[a.action] !== actionOrder[b.action]) {
        return actionOrder[a.action] - actionOrder[b.action];
      }
      return b.totalTriggered - a.totalTriggered;
    });

    return {
      sport,
      totalRules: items.length,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  private async queryFinishedMatches(sport: Sport): Promise<FinishedMatchRow[]> {
    const tableName = sport === 'basketball' ? 'basketball_matches' : 'matches';
    const hcpPickCol = sport === 'basketball' ? 'handicap_pick' : 'handicap_recommendation';
    const ouPickCol = sport === 'basketball' ? 'total_direction' : 'total_pick';

    const result = await this.db.execute(sql`
      SELECT
        id::text,
        COALESCE(prediction_direction, '') AS "predictionDirection",
        COALESCE(${sql.raw(hcpPickCol)}, '') AS "handicapPick",
        COALESCE(handicap_recommendation, '') AS "handicapRecommendation",
        COALESCE(${sql.raw(ouPickCol)}, '') AS "totalPick",
        COALESCE(${sql.raw(ouPickCol)}, '') AS "ouRecommendation",
        COALESCE(model_rules, ARRAY[]::text[]) AS "modelRules",
        hit_wdw AS "hitWdw",
        hit_handicap AS "hitHandicap",
        hit_overunder AS "hitOverunder"
      FROM ${sql.raw(tableName)}
      WHERE match_status = 'finished'
        AND model_rules IS NOT NULL
        AND array_length(model_rules, 1) > 0
    `);

    return result as unknown as FinishedMatchRow[];
  }

  private classifyRule(
    rule: string,
    directionMap: Record<string, Dimension>,
    auxPatterns: RegExp[],
  ): ClassifiedRule {
    let directionWord: string | null = null;
    let dimension: RuleDimension = 'unknown';

    const foundDimensions: Dimension[] = [];
    const foundWords: string[] = [];

    for (const [word, dim] of Object.entries(directionMap)) {
      if (rule.includes(word)) {
        foundDimensions.push(dim);
        foundWords.push(word);
      }
    }

    if (foundDimensions.length === 1) {
      dimension = foundDimensions[0];
      directionWord = foundWords[0];
    } else if (foundDimensions.length > 1) {
      const uniqueDims = [...new Set(foundDimensions)];
      if (uniqueDims.length === 1) {
        dimension = uniqueDims[0];
        directionWord = foundWords[0];
      } else {
        dimension = 'multi';
        directionWord = foundWords[0];
      }
    }

    const isAux = auxPatterns.some((p: RegExp) => p.test(rule));
    if (isAux) {
      return { rule, dimension: 'auxiliary' as RuleDimension, directionWord: null, ruleGroup: this.extractRuleGroup(rule), isAuxiliary: true };
    }

    if (dimension === 'unknown') {
      const coreDim = this.inferCoreDecisionDimension(rule);
      if (coreDim) {
        return {
          rule,
          dimension: 'core_decision',
          directionWord: null,
          ruleGroup: `${coreDim}_core`,
          isAuxiliary: false,
        };
      }
      return { rule, dimension: 'auxiliary', directionWord: null, ruleGroup: this.extractRuleGroup(rule), isAuxiliary: true };
    }

    return { rule, dimension, directionWord, ruleGroup: this.extractRuleGroup(rule), isAuxiliary: false };
  }

  private inferCoreDecisionDimension(rule: string): Dimension | null {
    const r = rule.toLowerCase();
    const hasWdw = /胜负平|胜平负|主胜|客胜|wdw|胜负/.test(rule) || /主客胜|主客/.test(rule);
    const hasHandicap = /让球|让分|盘口|handicap|热门方p值/.test(rule) || /让球/.test(rule);
    const hasOu = /大小球|大小分|总分|overunder|大球|小球|大分|小分/.test(rule);
    const isDecision = /基线模型|推荐|出票|出方向|方向判定|p值推荐|以.*为锚/.test(rule);

    if (!isDecision) return null;
    if (hasHandicap) return 'handicap';
    if (hasOu) return 'overunder';
    if (hasWdw) return 'wdw';
    return null;
  }

  private extractRuleGroup(rule: string): string {
    const vMatch = rule.match(/^V(\d+(?:\.\d+)?)[\.\s]?/);
    if (vMatch) return `V${vMatch[1]}`;
    const rMatch = rule.match(/^R(\d+[a-z]*)[\.\s]?/);
    if (rMatch) return `R${rMatch[1]}`;
    if (rule.startsWith('数据不足')) return '数据不足';
    if (rule.startsWith('已完赛')) return '已完赛';
    if (rule.startsWith('官方数据')) return '官方数据';
    if (rule.startsWith('v')) return 'legacy-v';
    return 'other';
  }

  private matchHandicapDir(hcpPick: string, directionWord: string, sport: Sport): boolean {
    if (sport === 'basketball') {
      if (directionWord === '让分主胜') return hcpPick.includes('让分主胜');
      if (directionWord === '让分客胜') return hcpPick.includes('让分客胜');
      if (directionWord === '主胜') return hcpPick.includes('让分主胜');
      if (directionWord === '客胜') return hcpPick.includes('让分客胜');
    } else {
      if (directionWord === '让球主胜') return hcpPick.includes('让球主胜');
      if (directionWord === '让球主负') return hcpPick.includes('让球主负');
      if (directionWord === '让球平') return hcpPick.includes('让球平');
      if (directionWord === '主胜') return hcpPick.includes('让球主胜');
      if (directionWord === '客胜') return hcpPick.includes('让球主负');
    }
    return false;
  }

  private matchOuDir(ouPick: string, directionWord: string, sport: Sport): boolean {
    if (sport === 'basketball') {
      if (directionWord === '大分') return ouPick.includes('大分');
      if (directionWord === '小分') return ouPick.includes('小分');
    } else {
      if (directionWord === '大球') return ouPick.includes('大球');
      if (directionWord === '小球') return ouPick.includes('小球');
      if (directionWord === '大分') return ouPick.includes('大分');
      if (directionWord === '小分') return ouPick.includes('小分');
    }
    return false;
  }

  private getPrimaryHitRate(
    dim: RuleDimension,
    wdw: number | null,
    hcp: number | null,
    ou: number | null,
  ): number | null {
    if (dim === 'wdw') return wdw;
    if (dim === 'handicap') return hcp;
    if (dim === 'overunder') return ou;
    if (dim === 'multi') {
      const vals = [wdw, hcp, ou].filter((v: number | null): v is number => v !== null);
      return vals.length > 0 ? vals[0] : null;
    }
    return null;
  }

  private getPrimarySample(
    dim: RuleDimension,
    wdw: number,
    hcp: number,
    ou: number,
  ): number {
    if (dim === 'wdw') return wdw;
    if (dim === 'handicap') return hcp;
    if (dim === 'overunder') return ou;
    return Math.max(wdw, hcp, ou);
  }

  async persistBacktest(sport: Sport, result: RuleBacktestResponse): Promise<number> {
    const removeItems = result.items.filter((i: RuleBacktestItem) => i.action === 'remove');
    let count = 0;

    for (const item of removeItems) {
      const primaryRate = this.getPrimaryHitRate(
        item.primaryDimension,
        item.wdwHitRate,
        item.handicapHitRate,
        item.overunderHitRate,
      );
      const rateStr = primaryRate != null ? String(primaryRate) : '';

      await this.db
        .insert(ruleDisabled)
        .values({
          rulePattern: item.rule,
          ruleDisplay: item.rule.slice(0, 200),
          sport,
          dimension: item.primaryDimension,
          totalTriggered: item.totalTriggered,
          adoptedCount: item.adoptedCount,
          adoptedRate: String(item.adoptedRate),
          wdwHitRate: item.wdwHitRate != null ? String(item.wdwHitRate) : null,
          handicapHitRate: item.handicapHitRate != null ? String(item.handicapHitRate) : null,
          ouHitRate: item.overunderHitRate != null ? String(item.overunderHitRate) : null,
          action: 'disabled',
          actionReason: `精确回测命中率不足：主维度命中率 ${rateStr}%，样本 ${item.adoptedCount} 场`,
          disabledAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ruleDisabled.rulePattern,
          set: {
            totalTriggered: item.totalTriggered,
            adoptedCount: item.adoptedCount,
            adoptedRate: String(item.adoptedRate),
            wdwHitRate: item.wdwHitRate != null ? String(item.wdwHitRate) : null,
            handicapHitRate: item.handicapHitRate != null ? String(item.handicapHitRate) : null,
            ouHitRate: item.overunderHitRate != null ? String(item.overunderHitRate) : null,
            action: 'disabled',
            disabledAt: new Date(),
            updatedAt: sql`NOW()`,
          },
        });
      count += 1;
    }

    this.logger.log(`规则汰换落库完成：${sport} 共禁用 ${count} 条规则`);
    return count;
  }

  async getDisabledRules(sport?: Sport): Promise<Array<typeof ruleDisabled.$inferSelect>> {
    if (sport) {
      return this.db
        .select()
        .from(ruleDisabled)
        .where(sql`${ruleDisabled.sport} = ${sport} AND ${ruleDisabled.action} = 'disabled'`);
    }
    return this.db.select().from(ruleDisabled).where(eq(ruleDisabled.action, 'disabled'));
  }

  async filterDisabledRules(rules: string[], sport: Sport): Promise<string[]> {
    const disabledRows = await this.db
      .select({ rulePattern: ruleDisabled.rulePattern })
      .from(ruleDisabled)
      .where(
        sql`${ruleDisabled.sport} = ${sport} AND ${ruleDisabled.action} = 'disabled'`,
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
}
