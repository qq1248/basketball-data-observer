import { Module } from '@nestjs/common';
import { OddsAlertsController } from './odds-alerts.controller';
import { OddsAlertsService } from './odds-alerts.service';

@Module({
  controllers: [OddsAlertsController],
  providers: [OddsAlertsService],
})
export class OddsAlertsModule {}
