import { Module, forwardRef } from '@nestjs/common';
import { PredictionRecordsController } from './prediction-records.controller';
import { PredictionRecordsService } from './prediction-records.service';
import { AuthModule } from '@server/modules/auth/auth.module';
import { BasketballModule } from '@server/modules/basketball/basketball.module';

@Module({
  imports: [AuthModule, forwardRef(() => BasketballModule)],
  controllers: [PredictionRecordsController],
  providers: [PredictionRecordsService],
})
export class PredictionRecordsModule {}
