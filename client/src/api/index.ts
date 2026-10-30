import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export * as matchesApi from './matches';
export * as favoritesApi from './favorites';
export * as predictionRecordsApi from './predictionRecords';
export * as modelRulesApi from './modelRules';
export * as teamsApi from './teams';
export * as injuriesApi from './injuries';
export * as statisticsApi from './statistics';
export * as parlaysApi from './parlays';
export * as followedTeamsApi from './followedTeams';
export * as playersApi from './players';
export * as basketballApi from './basketball';
export * as statsApi from './stats';
export * as versionApi from './version';
export * as syncApi from './sync';
export * as adminApi from './admin';
export * as supportApi from './support';
export * as schedulerApi from './scheduler';

export { logger, axiosForBackend };
