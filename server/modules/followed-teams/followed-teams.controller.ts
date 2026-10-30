import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Body,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FollowedTeamsService } from './followed-teams.service';
import { AuthService } from '@server/modules/auth/auth.service';
import type {
  FollowedTeamItem,
  FollowedTeamListResponse,
} from '@shared/api.interface';

const COOKIE_NAME = 'app_session';

@Controller('api/followed-teams')
export class FollowedTeamsController {
  constructor(
    private readonly followedTeamsService: FollowedTeamsService,
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

  @Get()
  async getList(@Req() req: Request): Promise<FollowedTeamListResponse> {
    const userId = await this.getUserIdFromRequest(req);
    return this.followedTeamsService.getList(userId);
  }

  @Post()
  async add(
    @Req() req: Request,
    @Body() body: { teamName: string; teamLogo?: string },
  ): Promise<FollowedTeamItem> {
    const userId = await this.getUserIdFromRequest(req);
    return this.followedTeamsService.add(userId, body.teamName, body.teamLogo);
  }

  @Delete(':teamName')
  async remove(
    @Req() req: Request,
    @Param('teamName') teamName: string,
  ): Promise<{ success: boolean }> {
    const userId = await this.getUserIdFromRequest(req);
    return this.followedTeamsService.remove(userId, teamName);
  }

  @Get('check/:teamName')
  async check(
    @Req() req: Request,
    @Param('teamName') teamName: string,
  ): Promise<{ followed: boolean }> {
    const userId = await this.getUserIdFromRequest(req);
    const followed = await this.followedTeamsService.isFollowed(userId, teamName);
    return { followed };
  }
}
