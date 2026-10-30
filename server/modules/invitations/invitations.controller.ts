import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { InvitationsService } from './invitations.service';
import type { Request } from 'express';
import type {
  InviteInfoResponse,
  InviteRewardListResponse,
  BindInviteCodeRequest,
  BindInviteCodeResponse,
} from './invitations.service';

@Controller('api/disabled-invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @NeedLogin()
  @Get('info')
  async getInfo(@Req() req: Request): Promise<InviteInfoResponse> {
    const { userId } = req.userContext;
    return this.invitationsService.getInviteInfo(userId);
  }

  @NeedLogin()
  @Get('rewards')
  async getRewards(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<InviteRewardListResponse> {
    const { userId } = req.userContext;
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    if (isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('page 必须是正整数');
    }
    if (isNaN(pageSizeNum) || pageSizeNum < 1 || pageSizeNum > 100) {
      throw new BadRequestException('pageSize 必须在 1-100 之间');
    }
    const result = await this.invitationsService.getRewards(
      userId,
      pageNum,
      pageSizeNum,
    );
    return {
      items: result.items,
      total: result.total,
      page: pageNum,
      pageSize: pageSizeNum,
    };
  }

  @NeedLogin()
  @Post('bind')
  async bind(
    @Req() req: Request,
    @Body() body: BindInviteCodeRequest,
  ): Promise<BindInviteCodeResponse> {
    const { userId } = req.userContext;
    const { inviteCode } = body;
    if (!inviteCode || typeof inviteCode !== 'string') {
      throw new BadRequestException('邀请码不能为空');
    }
    return this.invitationsService.bindInviteCode(userId, inviteCode);
  }
}
