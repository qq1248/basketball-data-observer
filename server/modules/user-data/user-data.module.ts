import { Module } from '@nestjs/common';
import { UserDataController } from './user-data.controller';
import { UserDataService } from './user-data.service';
import { AuthModule } from '@server/modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UserDataController],
  providers: [UserDataService],
})
export class UserDataModule {}
