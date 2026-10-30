import { Module } from '@nestjs/common';
import { ParlaysController } from './parlays.controller';
import { ParlaysService } from './parlays.service';

@Module({
  controllers: [ParlaysController],
  providers: [ParlaysService],
})
export class ParlaysModule {}
