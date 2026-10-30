import { Module } from '@nestjs/common';
import { FollowedTeamsController } from './followed-teams.controller';
import { FollowedTeamsService } from './followed-teams.service';
import { AuthModule } from '@server/modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FollowedTeamsController],
  providers: [FollowedTeamsService],
})
export class FollowedTeamsModule {}
