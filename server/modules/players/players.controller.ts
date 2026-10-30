import { Controller, Get, Param } from '@nestjs/common';
import { PlayersService } from './players.service';
import type { PlayerItem } from '@shared/api.interface';

@Controller('api/players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get('team/:teamName')
  async getByTeam(@Param('teamName') teamName: string): Promise<PlayerItem[]> {
    return this.playersService.getByTeam(teamName);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<PlayerItem> {
    return this.playersService.getById(id);
  }
}
