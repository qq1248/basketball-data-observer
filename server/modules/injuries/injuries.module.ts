import { Module } from '@nestjs/common';
import { InjuriesController } from './injuries.controller';
import { InjuriesService } from './injuries.service';
import { EuroLeagueInjuryService } from './euroleague-injury.service';
import { AcbInjuryService } from './acb-injury.service';

@Module({
  controllers: [InjuriesController],
  providers: [InjuriesService, EuroLeagueInjuryService, AcbInjuryService],
  exports: [EuroLeagueInjuryService, AcbInjuryService],
})
export class InjuriesModule {}
