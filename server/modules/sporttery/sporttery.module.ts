import { Module, forwardRef, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { SportteryController } from './sporttery.controller';
import { SportteryAutomationController } from './sporttery-automation.controller';
import { SportteryService } from './sporttery.service';
import { WnbaSyncService } from './wnba-sync.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { SyncAutomationTasksService } from './sporttery.automation';
import { SinaInjuryService } from './sina-injury.service';
import { FootballAutoCheckService } from './football-auto-check.service';
import { AuthModule } from '../auth/auth.module';
import { EloModule } from '../elo/elo.module';
import { XgModule } from '../xg/xg.module';
import { MlEnsembleModule } from '../ml-ensemble/ml-ensemble.module';
import { BasketballPredictionModule } from '../basketball-prediction/basketball-prediction.module';
import { BasketballModule } from '../basketball/basketball.module';

@Module({
  imports: [AuthModule, EloModule, XgModule, MlEnsembleModule, BasketballPredictionModule, forwardRef(() => BasketballModule)],
  controllers: [SportteryController, SportteryAutomationController],
  providers: [SportteryService, WnbaSyncService, SyncSchedulerService, SyncAutomationTasksService, SinaInjuryService, FootballAutoCheckService],
  exports: [SportteryService, WnbaSyncService, SyncSchedulerService, SyncAutomationTasksService, SinaInjuryService, FootballAutoCheckService],
})
export class SportteryModule {
  private readonly logger = new Logger(SportteryModule.name);

  constructor(
    private readonly sportteryService: SportteryService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}
}
