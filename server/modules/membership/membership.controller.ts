import { Controller } from '@nestjs/common';
import { MembershipService } from './membership.service';

@Controller('api/membership')
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}
}
