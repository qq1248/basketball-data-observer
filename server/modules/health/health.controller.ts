import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, basketballMatches } from '@server/database/schema';
import { gte, lt, and, asc, count, eq } from 'drizzle-orm';
import { APP_VERSION, BUILD_TIME } from '@server/config/version.config';

interface HealthSyncResponse {
  status: 'ok';
  performance: {
    footballListP50Ms: number;
    footballListP95Ms: number;
    basketballListP50Ms: number;
    basketballListP95Ms: number;
    timestamp: string;
  };
  deployInfo: {
    version: string;
    buildTime: string;
  };
}

@Controller('api/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  @Get('overview')
  async getOverview() {
    const now = new Date();
    const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const nextDate = this.getNextDate(today);

    const [footballToday, basketballToday, footballTotal, basketballTotal] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(matches)
        .where(and(gte(matches.businessDate, today), lt(matches.businessDate, nextDate))),
      this.db
        .select({ total: count() })
        .from(basketballMatches)
        .where(and(gte(basketballMatches.businessDate, today), lt(basketballMatches.businessDate, nextDate))),
      this.db.select({ total: count() }).from(matches),
      this.db.select({ total: count() }).from(basketballMatches),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      deployInfo: {
        version: APP_VERSION || 'unknown',
        buildTime: BUILD_TIME || 'unknown',
      },
      football: {
        total: footballTotal[0].total,
        today: footballToday[0].total,
      },
      basketball: {
        total: basketballTotal[0].total,
        today: basketballToday[0].total,
      },
    };
  }

  @Get('perf')
  async getPerformanceHealth(): Promise<HealthSyncResponse> {
    const now = new Date();
    const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const nextDate = this.getNextDate(today);

    // Benchmark football list query (3 runs)
    const footballTimes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = process.hrtime.bigint();
      await this.db
        .select({ id: matches.id, matchNo: matches.matchNo })
        .from(matches)
        .where(and(
          gte(matches.businessDate, today),
          lt(matches.businessDate, nextDate),
        ))
        .orderBy(asc(matches.kickoffTime))
        .limit(50);
      const end = process.hrtime.bigint();
      footballTimes.push(Number(end - start) / 1e6);
    }

    // Benchmark basketball list query (3 runs)
    const basketballTimes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = process.hrtime.bigint();
      await this.db
        .select({ id: basketballMatches.id, matchNo: basketballMatches.matchNo })
        .from(basketballMatches)
        .where(and(
          gte(basketballMatches.businessDate, today),
          lt(basketballMatches.businessDate, nextDate),
        ))
        .orderBy(asc(basketballMatches.kickoffTime))
        .limit(50);
      const end = process.hrtime.bigint();
      basketballTimes.push(Number(end - start) / 1e6);
    }

    const footballSorted = [...footballTimes].sort((a: number, b: number) => a - b);
    const basketballSorted = [...basketballTimes].sort((a: number, b: number) => a - b);

    // With 3 samples: P50 = median (index 1), P95 ≈ max (index 2)
    const footballListP50Ms = Math.round(footballSorted[1] * 100) / 100;
    const footballListP95Ms = Math.round(footballSorted[2] * 100) / 100;
    const basketballListP50Ms = Math.round(basketballSorted[1] * 100) / 100;
    const basketballListP95Ms = Math.round(basketballSorted[2] * 100) / 100;

    return {
      status: 'ok',
      performance: {
        footballListP50Ms,
        footballListP95Ms,
        basketballListP50Ms,
        basketballListP95Ms,
        timestamp: new Date().toISOString(),
      },
      deployInfo: {
        version: APP_VERSION || 'unknown',
        buildTime: BUILD_TIME || 'unknown',
      },
    };
  }

  private getNextDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + 1);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, '0');
    const nd = String(date.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }
}
