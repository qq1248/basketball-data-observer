import { Module } from '@nestjs/common';
import { ModelRulesController } from './model-rules.controller';
import { ModelRulesService } from './model-rules.service';
import { RuleBacktestService } from './rule-backtest.service';
import { ModelUpgradeBacktestService } from './model-upgrade-backtest.service';
import { BasketballEfficiencyService } from '@server/modules/basketball/basketball-efficiency.service';
import { FootballPoissonService } from '@server/modules/sporttery/football-poisson.service';

@Module({
  controllers: [ModelRulesController],
  providers: [
    ModelRulesService,
    RuleBacktestService,
    ModelUpgradeBacktestService,
    BasketballEfficiencyService,
    FootballPoissonService,
  ],
  exports: [RuleBacktestService],
})
export class ModelRulesModule {}
