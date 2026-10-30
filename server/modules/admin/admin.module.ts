import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from './audit.service';
import { SportteryModule } from '../sporttery/sporttery.module';
import { EloModule } from '../elo/elo.module';
import { MlEnsembleModule } from '../ml-ensemble/ml-ensemble.module';

@Module({
  imports: [AuthModule, SportteryModule, EloModule, MlEnsembleModule],
  controllers: [AdminController],
  providers: [AuditService],
})
export class AdminModule {}
