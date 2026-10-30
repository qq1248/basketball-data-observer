import { IsString, MinLength, MaxLength } from 'class-validator';
import type { CreateSupportMessageRequest } from '@shared/api.interface';

export class CreateMessageDto implements CreateSupportMessageRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
