import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject } from '@nestjs/common';
import { EloService } from './elo.service';
import { EloHistoryService } from './elo-history.service';
import { teamsElo } from '@server/database/schema';
import { count, eq } from 'drizzle-orm';

@Module({
  providers: [EloService, EloHistoryService],
  exports: [EloService, EloHistoryService],
})
export class EloModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(EloModule.name);

  constructor(
    private readonly eloHistoryService: EloHistoryService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    void (async () => {
      try {
        const [fbCount] = await this.db
          .select({ count: count() })
          .from(teamsElo)
          .where(eq(teamsElo.sport, 'football'));
        const [bbCount] = await this.db
          .select({ count: count() })
          .from(teamsElo)
          .where(eq(teamsElo.sport, 'basketball'));

        const fbTeams = Number(fbCount?.count ?? 0);
        const bbTeams = Number(bbCount?.count ?? 0);

        if (fbTeams === 0) {
          this.logger.log('No football Elo ratings found, starting backfill...');
          const result = await this.eloHistoryService.backfillFootballElo();
          this.logger.log(
            `Football Elo backfill done: ${result.processed} matches, ${result.teamsCount} teams`,
          );
        } else {
          this.logger.log(`Football Elo ratings exist: ${fbTeams} teams, skipping backfill`);
        }

        if (bbTeams === 0) {
          this.logger.log('No basketball Elo ratings found, starting backfill...');
          const result = await this.eloHistoryService.backfillBasketballElo();
          this.logger.log(
            `Basketball Elo backfill done: ${result.processed} matches, ${result.teamsCount} teams`,
          );
        } else {
          this.logger.log(`Basketball Elo ratings exist: ${bbTeams} teams, skipping backfill`);
        }
      } catch (error) {
        this.logger.error(
          `Elo backfill failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }
}
