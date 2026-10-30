import { Controller, Get } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import type { MatchStatsResponse } from '@shared/api.interface';

@Controller('api/stats')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('overview')
  async getOverview(): Promise<MatchStatsResponse> {
    return this.statisticsService.getOverview();
  }

  @Get('football')
  async getFootballStats(): Promise<MatchStatsResponse> {
    return this.statisticsService.getOverview();
  }
}
