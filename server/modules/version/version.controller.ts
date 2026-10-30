import { Controller, Get } from '@nestjs/common';
import type { VersionResponse } from '@shared/api.interface';
import {
  APP_VERSION,
  BUILD_NUMBER,
  BUILD_TIME,
  CHANGELOG,
  FORCE_UPDATE,
} from '../../config/version.config';

@Controller('api/version')
export class VersionController {
  @Get()
  getVersion(): VersionResponse {
    return {
      version: APP_VERSION,
      buildNumber: BUILD_NUMBER,
      buildTime: BUILD_TIME,
      changelog: CHANGELOG,
      forceUpdate: FORCE_UPDATE,
    };
  }
}
