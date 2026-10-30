import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FeatureEngineeringService } from './feature-engineering.service';
import { GbdtService } from './gbdt.service';
import { MlEnsembleService } from './ml-ensemble.service';
import { MlTrainingService } from './ml-training.service';

@Module({
  providers: [
    FeatureEngineeringService,
    GbdtService,
    MlEnsembleService,
    MlTrainingService,
  ],
  exports: [
    FeatureEngineeringService,
    GbdtService,
    MlEnsembleService,
    MlTrainingService,
  ],
})
export class MlEnsembleModule implements OnModuleInit {
  private readonly logger = new Logger(MlEnsembleModule.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit(): Promise<void> {
    if (process.env.ML_AUTO_TRAIN === 'false') {
      this.logger.log('ML_AUTO_TRAIN=false，跳过启动时训练');
      return;
    }
    const trainingService = this.moduleRef.get(MlTrainingService, { strict: false });
    if (!trainingService) {
      this.logger.warn('MlTrainingService 未找到，跳过启动时训练');
      return;
    }
    this.logger.log('ML 启动时训练已调度（异步执行，不阻塞启动）');
    void (async () => {
      try {
        await trainingService.trainAndLoadAll(50, 0.1, 42);
      } catch (e) {
        this.logger.error('ML 启动时训练失败', e);
      }
    })();
  }
}
