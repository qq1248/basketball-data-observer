import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { modelRuleDetails } from '@server/database/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import type { ModelRuleDetail, ModelRulesResponse } from '@shared/api.interface';

@Injectable()
export class ModelRulesService {
  private readonly logger = new Logger(ModelRulesService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private toModelRuleDetail(row: typeof modelRuleDetails.$inferSelect): ModelRuleDetail {
    return {
      id: row.id,
      ruleCode: row.ruleCode,
      ruleName: row.ruleName,
      category: row.category,
      triggerCondition: row.triggerCondition,
      impactFormula: row.impactFormula,
      hitRate: Number(row.hitRate),
      sampleSize: row.sampleSize ?? 0,
      description: row.description,
      params: row.params,
      sortOrder: row.sortOrder ?? 0,
    };
  }

  async getRules(category?: string): Promise<ModelRulesResponse> {
    try {
      const conditions = [];
      if (category) {
        conditions.push(eq(modelRuleDetails.category, category));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await this.db
        .select()
        .from(modelRuleDetails)
        .where(whereClause)
        .orderBy(asc(modelRuleDetails.sortOrder), asc(modelRuleDetails.ruleCode));

      const rules: ModelRuleDetail[] = rows
        .map((row: typeof modelRuleDetails.$inferSelect) => this.toModelRuleDetail(row));

      const catRows = await this.db
        .select({ category: modelRuleDetails.category })
        .from(modelRuleDetails)
        .groupBy(modelRuleDetails.category)
        .orderBy(asc(modelRuleDetails.category));
      const categories: string[] = catRows.map((r: { category: string }) => r.category);

      const totalSamples = rules.reduce((sum: number, r: ModelRuleDetail) => sum + (r.sampleSize ?? 0), 0);

      const disclaimer = '本模型规则仅供学术研究与数据参考，所有分析结果不构成任何决策建议。体育比赛存在较大不确定性，请理性看待赛事数据，远离赌博。历史命中率不代表未来表现。';

      return {
        rules,
        hitRate: {
          winDrawWin: 0,
          overUnder: 0,
          version: '',
          sampleSize: totalSamples,
        },
        disclaimer,
        categories,
      };
    } catch (error) {
      this.logger.error(`获取模型规则失败 category=${category ?? ''}`, JSON.stringify(error));
      throw error;
    }
  }
}
