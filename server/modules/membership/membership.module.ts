import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { MembershipController } from './membership.controller';
import { AdminMembershipController } from './admin-membership.controller';

@Module({
  controllers: [MembershipController, AdminMembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
