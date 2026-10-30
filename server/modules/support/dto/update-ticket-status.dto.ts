import { IsString, IsIn } from 'class-validator';
import type { UpdateSupportTicketStatusRequest } from '@shared/api.interface';

export class UpdateTicketStatusDto implements UpdateSupportTicketStatusRequest {
  @IsString()
  @IsIn(['open', 'processing', 'closed'])
  status!: 'open' | 'processing' | 'closed';
}
