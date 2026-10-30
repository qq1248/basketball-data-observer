import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';
import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { MatchesModule } from './modules/matches/matches.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { PredictionRecordsModule } from './modules/prediction-records/prediction-records.module';
import { TeamsModule } from './modules/teams/teams.module';
import { InjuriesModule } from './modules/injuries/injuries.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { ModelRulesModule } from './modules/model-rules/model-rules.module';
import { ParlaysModule } from './modules/parlays/parlays.module';
import { FollowedTeamsModule } from './modules/followed-teams/followed-teams.module';
import { PlayersModule } from './modules/players/players.module';
import { BasketballModule } from './modules/basketball/basketball.module';
import { VersionModule } from './modules/version/version.module';
import { SportteryModule } from './modules/sporttery/sporttery.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserDataModule } from './modules/user-data/user-data.module';
import { AdminModule } from './modules/admin/admin.module';
import { SupportModule } from './modules/support/support.module';
import { HealthModule } from './modules/health/health.module';
import { EloModule } from './modules/elo/elo.module';
import { XgModule } from './modules/xg/xg.module';
import { MlEnsembleModule } from './modules/ml-ensemble/ml-ensemble.module';

@Module({
  imports: [
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    MatchesModule,
    FavoritesModule,
    PredictionRecordsModule,
    TeamsModule,
    InjuriesModule,
    StatisticsModule,
    ModelRulesModule,
    ParlaysModule,
    BasketballModule,
    FollowedTeamsModule,
    PlayersModule,
    VersionModule,
    SportteryModule,
    AuthModule,
    UserDataModule,
    AdminModule,
    SupportModule,
    HealthModule,
    EloModule,
    XgModule,
    MlEnsembleModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    ViewModule,
  ],
  controllers: [],
  providers: [
    {
      provide: 'APP_FILTER',
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
