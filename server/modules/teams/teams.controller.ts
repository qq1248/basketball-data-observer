import { Controller, Get, Param, Query } from '@nestjs/common';
import { TeamsService } from './teams.service';
import type {
  TeamSearchResponse,
  TeamItem,
  TeamProfileResponse,
} from '@shared/api.interface';

@Controller('api/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  async searchTeams(
    @Query('keyword') keyword?: string,
    @Query('league') league?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<TeamSearchResponse> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const sizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    return this.teamsService.search({
      keyword,
      league,
      page: pageNum > 0 ? pageNum : 1,
      pageSize: sizeNum > 0 && sizeNum <= 100 ? sizeNum : 20,
    });
  }

  @Get('by-name/:name')
  async getTeamByName(@Param('name') name: string): Promise<{ team: TeamItem }> {
    return this.teamsService.getByName(name);
  }

  @Get('profile/:teamName')
  async getTeamProfile(
    @Param('teamName') teamName: string,
    @Query('sport') sport?: 'football' | 'basketball',
    @Query('opponent') opponent?: string,
  ): Promise<TeamProfileResponse> {
    const sportType = sport === 'basketball' ? 'basketball' : 'football';
    return this.teamsService.getTeamProfile(teamName, sportType, opponent);
  }

  @Get(':id')
  async getTeam(@Param('id') id: string): Promise<{ team: TeamItem }> {
    return this.teamsService.getById(id);
  }
}
