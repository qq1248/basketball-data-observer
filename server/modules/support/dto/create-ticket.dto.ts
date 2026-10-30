import { IsString, IsIn, IsOptional, MinLength, MaxLength, IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';
import type { CreateSupportTicketRequest } from '@shared/api.interface';

export class CreateTicketDto implements CreateSupportTicketRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsIn(['功能问题', '数据问题', '建议反馈', '其他'])
  category!: '功能问题' | '数据问题' | '建议反馈' | '其他';

  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
