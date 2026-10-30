import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InjuriesService } from './injuries.service';
import { EuroLeagueInjuryService } from './euroleague-injury.service';
import { AcbInjuryService } from './acb-injury.service';
import type { MatchInjuriesResponse, InjuryItem, InjuryListResponse } from '@shared/api.interface';

@Controller('api/injuries')
export class InjuriesController {
  constructor(
    private readonly injuriesService: InjuriesService,
    private readonly euroLeagueInjuryService: EuroLeagueInjuryService,
    private readonly acbInjuryService: AcbInjuryService,
  ) {}

  @Get()
  async getInjuryList(
    @Query('teamName') teamName?: string,
    @Query('impactLevel') impactLevel?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<InjuryListResponse> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    const safePage = Math.max(1, pageNum);
    const safePageSize = Math.min(100, Math.max(1, pageSizeNum));
    return this.injuriesService.getList({
      teamName,
      impactLevel,
      status,
      page: safePage,
      pageSize: safePageSize,
    });
  }

  @Get('match/:matchId')
  async getMatchInjuries(
    @Param('matchId') matchId: string,
  ): Promise<MatchInjuriesResponse> {
    return this.injuriesService.getByMatch(matchId);
  }

  @Get('team/:teamId')
  async getTeamInjuries(
    @Param('teamId') teamId: string,
  ): Promise<{ items: InjuryItem[] }> {
    return this.injuriesService.getByTeam(teamId);
  }

  @Post('sync/euroleague')
  async syncEuroLeague(
    @Query('round') round?: string,
    @Query('season') season?: string,
  ): Promise<{ synced: number; round: number }> {
    const roundNum = round ? Number(round) : undefined;
    const result = await this.euroLeagueInjuryService.fetchAndSync(roundNum, season);
    return { synced: result.count, round: result.round };
  }

  @Post('sync/acb')
  async syncAcb(
    @Query('round') round?: string,
  ): Promise<{ synced: number; jornada: number; teams: string[]; status: string; errorNote: string }> {
    const roundNum = round ? Number(round) : undefined;
    const result = await this.acbInjuryService.fetchAndSync(roundNum);
    return {
      synced: result.count,
      jornada: result.jornada,
      teams: result.teams,
      status: result.status,
      errorNote: result.errorNote,
    };
  }
}
