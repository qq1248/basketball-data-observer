import { Controller, Get, Post, Query, Body, Param } from '@nestjs/common';
import { ModelRulesService } from './model-rules.service';
import { RuleBacktestService } from './rule-backtest.service';
import { ModelUpgradeBacktestService } from './model-upgrade-backtest.service';
import type { ModelRulesResponse, RuleBacktestResponse } from '@shared/api.interface';
import type { ModelUpgradeBacktestResponse } from './model-upgrade-backtest.service';

@Controller('api/model-rules')
export class ModelRulesController {
  constructor(
    private readonly modelRulesService: ModelRulesService,
    private readonly ruleBacktestService: RuleBacktestService,
    private readonly modelUpgradeBacktest: ModelUpgradeBacktestService,
  ) {}

  @Get()
  async getRules(@Query('category') category?: string): Promise<ModelRulesResponse> {
    return this.modelRulesService.getRules(category);
  }

  @Get('backtest/:sport')
  async getBacktest(@Param('sport') sport: 'basketball' | 'football'): Promise<RuleBacktestResponse> {
    return this.ruleBacktestService.runBacktest(sport);
  }

  @Post('backtest/:sport/apply')
  async applyBacktest(@Param('sport') sport: 'basketball' | 'football'): Promise<{ disabled: number; sport: string }> {
    const result = await this.ruleBacktestService.runBacktest(sport);
    const disabled = await this.ruleBacktestService.persistBacktest(sport, result);
    return { disabled, sport };
  }

  @Get('disabled')
  async getDisabledRules(@Query('sport') sport?: 'basketball' | 'football') {
    const rules = await this.ruleBacktestService.getDisabledRules(sport);
    return { items: rules, total: rules.length };
  }

  @Get('upgrade-backtest/:sport')
  async getUpgradeBacktest(@Param('sport') sport: 'basketball' | 'football'): Promise<ModelUpgradeBacktestResponse> {
    if (sport === 'basketball') {
      return this.modelUpgradeBacktest.runBasketballBacktest();
    }
    return this.modelUpgradeBacktest.runFootballBacktest();
  }
}
