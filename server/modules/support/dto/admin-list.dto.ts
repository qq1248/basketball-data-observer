import { Type } from 'class-transformer';
import { IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import type { AdminSupportTicketListParams } from '@shared/api.interface';

export class AdminListDto implements AdminSupportTicketListParams {
  @IsOptional()
  @IsIn(['all', 'open', 'processing', 'closed'])
  status?: 'all' | 'open' | 'processing' | 'closed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
