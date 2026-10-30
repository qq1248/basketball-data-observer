import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PredictionRecordsService } from './prediction-records.service';
import { AuthService } from '@server/modules/auth/auth.service';
import type {
  PredictionRecordItem,
  PredictionRecordListResponse,
} from '@shared/api.interface';

const COOKIE_NAME = 'app_session';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new BadRequestException(`${fieldName} 格式无效`);
  }
}

interface CreatePredictionRecordBody {
  actionType: string;
  viewedAt?: string;
}

@Controller('api/prediction-records')
export class PredictionRecordsController {
  constructor(
    private readonly predictionRecordsService: PredictionRecordsService,
    private readonly authService: AuthService,
  ) {}

  private async getUserIdFromRequest(req: Request): Promise<string> {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('未登录');
    }

    const payload = await this.authService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('登录已过期');
    }

    return payload.userId;
  }

  private async tryGetUserId(req: Request): Promise<string | null> {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return null;
    const payload = await this.authService.verifyToken(token);
    if (!payload) return null;
    return payload.userId;
  }

  @Get()
  async getRecords(
    @Req() req: Request,
    @Query('actionType') actionType?: string,
  ): Promise<PredictionRecordListResponse> {
    const userId = await this.getUserIdFromRequest(req);
    validateUuid(userId, 'userId');
    return this.predictionRecordsService.getList(userId, actionType);
  }

  @Post(':matchId')
  async addRecord(
    @Req() req: Request,
    @Param('matchId') matchId: string,
    @Body() body: CreatePredictionRecordBody,
  ): Promise<PredictionRecordItem | { skipped: true }> {
    validateUuid(matchId, 'matchId');
    const userId = await this.tryGetUserId(req);
    if (!userId) return { skipped: true };
    validateUuid(userId, 'userId');
    return this.predictionRecordsService.upsert(userId, matchId, body.actionType, body.viewedAt);
  }
}
