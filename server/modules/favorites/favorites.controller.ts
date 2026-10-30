import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FavoritesService } from './favorites.service';
import { AuthService } from '@server/modules/auth/auth.service';
import type {
  FavoriteItem,
  BasketballFavoriteItem,
  FavoriteListResponse,
  SportType,
} from '@shared/api.interface';

const COOKIE_NAME = 'app_session';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new BadRequestException(`${fieldName} 格式无效`);
  }
}

interface AddFavoriteBody {
  sportType?: SportType;
}

@Controller('api/favorites')
export class FavoritesController {
  constructor(
    private readonly favoritesService: FavoritesService,
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
  async getFavorites(
    @Req() req: Request,
    @Query('sportType') sportType?: SportType,
  ): Promise<FavoriteListResponse> {
    const userId = await this.getUserIdFromRequest(req);
    validateUuid(userId, 'userId');
    const effectiveSportType: SportType = sportType ?? 'football';
    return this.favoritesService.getList(userId, effectiveSportType);
  }

  @Post(':matchId')
  async addFavorite(
    @Req() req: Request,
    @Param('matchId') matchId: string,
    @Body() body: AddFavoriteBody,
  ): Promise<FavoriteItem | BasketballFavoriteItem> {
    const userId = await this.getUserIdFromRequest(req);
    validateUuid(matchId, 'matchId');
    validateUuid(userId, 'userId');
    const effectiveSportType: SportType = body.sportType ?? 'football';
    return this.favoritesService.add(userId, matchId, effectiveSportType);
  }

  @Delete(':matchId')
  async removeFavorite(
    @Req() req: Request,
    @Param('matchId') matchId: string,
    @Query('sportType') sportType?: SportType,
  ): Promise<{ success: boolean }> {
    const userId = await this.getUserIdFromRequest(req);
    validateUuid(matchId, 'matchId');
    validateUuid(userId, 'userId');
    const effectiveSportType: SportType = sportType ?? 'football';
    return this.favoritesService.remove(userId, matchId, effectiveSportType);
  }
}
