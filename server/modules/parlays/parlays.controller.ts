import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { ParlaysService } from './parlays.service';
import type {
  ParlayListResponse,
} from '@shared/api.interface';

@Controller('api/parlays')
export class ParlaysController {
  constructor(private readonly parlaysService: ParlaysService) {}

  @Get()
  async getParlays(
    @Query('date') date?: string,
    @Query('sport') sport?: 'football' | 'basketball',
  ): Promise<ParlayListResponse> {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const sportType = sport === 'basketball' ? 'basketball' : 'football';
    return this.parlaysService.getListByDate(targetDate, sportType);
  }
}
