import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { SportteryModule } from '../sporttery/sporttery.module';

@Module({
  imports: [SportteryModule],
  controllers: [MatchesController],
  providers: [MatchesService],
})
export class MatchesModule {}
