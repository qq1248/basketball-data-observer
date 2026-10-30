import { Controller, Get, Query } from '@nestjs/common';
import { OddsAlertsService } from './odds-alerts.service';
import type { OddsAlertsResponse } from '@shared/api.interface';

@Controller('api/odds-alerts')
export class OddsAlertsController {
  constructor(private readonly oddsAlertsService: OddsAlertsService) {}

  @Get()
  async getAlerts(
    @Query('threshold') threshold?: string,
    @Query('league') league?: string,
    @Query('date') date?: string,
  ): Promise<OddsAlertsResponse> {
    let targetDate = date;
    if (!targetDate) {
      const now = new Date();
      const beijingMs = now.getTime() + 8 * 3600 * 1000;
      targetDate = new Date(beijingMs).toISOString().slice(0, 10);
    }
    const th = threshold ? parseFloat(threshold) : 0.15;
    return this.oddsAlertsService.getAlerts(th > 0 ? th : 0.15, league, targetDate);
  }
}
