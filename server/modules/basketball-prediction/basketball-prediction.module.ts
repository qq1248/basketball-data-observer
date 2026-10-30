import { Module } from '@nestjs/common';
import { BasketballDataDrivenPredictionService } from './basketball-data-driven.service';

@Module({
  providers: [BasketballDataDrivenPredictionService],
  exports: [BasketballDataDrivenPredictionService],
})
export class BasketballPredictionModule {}
