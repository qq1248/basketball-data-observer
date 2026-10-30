import { IsString, IsIn } from 'class-validator';
import type { UpdateSupportTicketPriorityRequest } from '@shared/api.interface';

export class UpdateTicketPriorityDto implements UpdateSupportTicketPriorityRequest {
  @IsString()
  @IsIn(['normal', 'urgent'])
  priority!: 'normal' | 'urgent';
}
