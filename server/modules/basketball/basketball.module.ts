import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BasketballController } from './basketball.controller';
import { BasketballService } from './basketball.service';
import { BasketballAnchorPredictionService } from './basketball-anchor-prediction.service';
import { BasketballIntelService } from './basketball-intel.service';
import { BasketballAutoCheckService } from './basketball-auto-check.service';
import { BasketballFlashscoreService } from './flashscore.service';
import { SportteryModule } from '../sporttery/sporttery.module';
import { EloModule } from '../elo/elo.module';
import { MlEnsembleModule } from '../ml-ensemble/ml-ensemble.module';
import { BasketballPredictionModule } from '../basketball-prediction/basketball-prediction.module';

@Module({
  imports: [forwardRef(() => SportteryModule), EloModule, MlEnsembleModule, BasketballPredictionModule, HttpModule],
  controllers: [BasketballController],
  providers: [BasketballService, BasketballAnchorPredictionService, BasketballIntelService, BasketballAutoCheckService, BasketballFlashscoreService],
  exports: [BasketballService, BasketballPredictionModule, BasketballAutoCheckService],
})
export class BasketballModule {}
