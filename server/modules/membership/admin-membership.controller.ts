import { Controller } from '@nestjs/common';
import { MembershipService } from './membership.service';

@Controller('api/admin/membership')
export class AdminMembershipController {
  constructor(private readonly membershipService: MembershipService) {}
}
