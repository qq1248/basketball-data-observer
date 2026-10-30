import { Body, Controller, Get, Put, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { UserDataService } from './user-data.service';
import { AuthService } from '@server/modules/auth/auth.service';

const COOKIE_NAME = 'app_session';

@Controller('api/user')
export class UserDataController {
  constructor(
    private readonly userDataService: UserDataService,
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

  @Get('sync')
  async getSync(@Req() req: Request) {
    const userId = await this.getUserIdFromRequest(req);
    return this.userDataService.getUserData(userId);
  }

  @Put('sync')
  async putSync(
    @Req() req: Request,
    @Body() body: {
      favorites?: any[];
      followedTeams?: any[];
      settings?: Record<string, any>;
      records?: any[];
    },
  ) {
    const userId = await this.getUserIdFromRequest(req);
    return this.userDataService.updateUserData(userId, body);
  }

  @Get('stats')
  async getStats(@Req() req: Request) {
    const userId = await this.getUserIdFromRequest(req);
    return this.userDataService.getUserStats(userId);
  }
}
