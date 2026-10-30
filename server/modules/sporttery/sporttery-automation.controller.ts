import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SyncAutomationTasksService } from './sporttery.automation';
import { SyncSchedulerService } from './sync-scheduler.service';

interface InvokeRequest {
  trigger: string;
  instanceID?: string;
  triggerType?: string;
}

interface InvokeResponse {
  code: number;
  message: string;
}

const VALID_TRIGGERS = [
  'daily_wnba_full_sync',
  'hourly_onsale_capture',
  'daily_review',
];

@Controller('api/sporttery/automation')
export class SportteryAutomationController {
  constructor(
    private readonly syncAutomation: SyncAutomationTasksService,
    private readonly syncScheduler: SyncSchedulerService,
  ) {}

  @Post('invoke')
  @HttpCode(HttpStatus.OK)
  async invoke(@Body() body: InvokeRequest): Promise<InvokeResponse> {
    const { trigger, instanceID } = body;

    if (!trigger) {
      throw new BadRequestException('Missing required field: trigger');
    }

    if (!VALID_TRIGGERS.includes(trigger)) {
      throw new BadRequestException(`Unknown trigger: ${trigger}`);
    }

    const instance = instanceID ?? `manual-${Date.now()}`;

    switch (trigger) {
      case 'daily_wnba_full_sync':
        await this.syncAutomation.dailyWnbaFullSync();
        break;
      case 'hourly_onsale_capture':
        await this.syncAutomation.hourlyOnsaleCapture();
        break;
      case 'daily_review':
        await this.syncAutomation.dailyReview();
        break;
    }

    return {
      code: 200,
      message: 'success',
    };
  }

  @Post('backfill-daily-review')
  @HttpCode(HttpStatus.OK)
  async backfillDailyReview(@Body() body: { date: string; sport?: 'basketball' | 'football' }): Promise<{ code: number; message: string; rows: number }> {
    const { date, sport = 'basketball' } = body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Invalid date format, expected YYYY-MM-DD');
    }
    const rows = await this.syncScheduler.generateDailyReview(sport, date);
    return { code: 200, message: 'success', rows };
  }
}
