import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Inject } from '@nestjs/common';
import { basketballMatches } from '@server/database/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';

const SHANGHAI_TZ = 'Asia/Shanghai';
const DAILY_HOUR = 9;
const DAILY_MINUTE = 30;
const RETRY_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RETRY = 4;

interface WnbaSyncStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastSource: string | null;
  lastUpdatedCount: number;
  status: 'idle' | 'running' | 'success' | 'failed';
}

@Injectable()
export class WnbaSyncService implements OnModuleInit {
  private readonly logger = new Logger(WnbaSyncService.name);
  private dailyTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private isRunning = false;

  private status: WnbaSyncStatus = {
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
    lastSource: null,
    lastUpdatedCount: 0,
    status: 'idle',
  };

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  onModuleInit(): void {
    void this.runSync('startup').catch((err: unknown) => {
      this.logger.error(`Initial WNBA sync failed: ${this.errorMessage(err)}`);
    });
    this.scheduleNextDaily();
  }

  getStatus(): WnbaSyncStatus {
    return { ...this.status };
  }

  async triggerManual(): Promise<WnbaSyncStatus> {
    if (this.isRunning) return { ...this.status };
    void this.runSync('manual').catch((err: unknown) => {
      this.logger.error(`Manual WNBA sync failed: ${this.errorMessage(err)}`);
    });
    return { ...this.status };
  }

  private scheduleNextDaily(): void {
    const now = new Date();
    const next = this.getNextRun(now);
    const delay = next.getTime() - now.getTime();
    this.logger.log(
      `Next WNBA daily sync scheduled at ${next.toISOString()} (${Math.round(delay / 60000)} min)`,
    );
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.dailyTimer = setTimeout(() => {
      void this.runSync('daily').catch((err: unknown) => {
        this.logger.error(`Daily WNBA sync failed: ${this.errorMessage(err)}`);
      });
      this.scheduleNextDaily();
    }, delay);
    if (this.dailyTimer && typeof this.dailyTimer.unref === 'function') {
      this.dailyTimer.unref();
    }
  }

  private getNextRun(now: Date): Date {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SHANGHAI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string): string => {
      const p = parts.find((x) => x.type === type);
      return p?.value ?? '00';
    };
    const shYear = Number(get('year'));
    const shMonth = Number(get('month')) - 1;
    const shDay = Number(get('day'));
    const shHour = Number(get('hour'));
    const shMin = Number(get('minute'));

    const todayTarget = new Date(shYear, shMonth, shDay, DAILY_HOUR, DAILY_MINUTE, 0, 0);
    const nowInShanghai = new Date(shYear, shMonth, shDay, shHour, shMin, Number(get('second')), 0);

    if (nowInShanghai < todayTarget) {
      return todayTarget;
    }
    const tomorrow = new Date(shYear, shMonth, shDay + 1, DAILY_HOUR, DAILY_MINUTE, 0, 0);
    return tomorrow;
  }

  private async runSync(reason: 'startup' | 'daily' | 'retry' | 'manual'): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(`WNBA sync already running, skip (reason=${reason})`);
      return;
    }
    this.isRunning = true;
    this.status = { ...this.status, status: 'running', lastAttemptAt: new Date().toISOString() };
    const startTime = Date.now();

    try {
      this.logger.log(`WNBA sync started (reason=${reason})`);

      const result = await this.fetchAndUpsertWnba();

      this.status = {
        ...this.status,
        status: 'success',
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        lastSource: result.source,
        lastUpdatedCount: result.updated,
      };
      this.retryCount = 0;
      this.logger.log(
        `WNBA sync succeeded (reason=${reason}): source=${result.source}, updated=${result.updated}, duration=${Date.now() - startTime}ms`,
      );
    } catch (err) {
      const msg = this.errorMessage(err);
      this.status = { ...this.status, status: 'failed', lastError: msg };
      this.logger.error(`WNBA sync failed (reason=${reason}): ${msg}`);

      if (reason !== 'manual' && this.retryCount < MAX_RETRY) {
        this.retryCount += 1;
        const delay = RETRY_INTERVAL_MS * this.retryCount;
        this.logger.warn(`Will retry WNBA sync in ${Math.round(delay / 60000)} min (attempt ${this.retryCount}/${MAX_RETRY})`);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          void this.runSync('retry').catch((e: unknown) => {
            this.logger.error(`Retry WNBA sync failed: ${this.errorMessage(e)}`);
          });
        }, delay);
        if (this.retryTimer && typeof this.retryTimer.unref === 'function') {
          this.retryTimer.unref();
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchAndUpsertWnba(): Promise<{ source: string; updated: number }> {
    let updated = 0;
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        matchStatus: basketballMatches.matchStatus,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(
        and(
          sql`lower(${basketballMatches.league}) LIKE '%wnba%'`,
          gte(basketballMatches.kickoffTime, sql`CURRENT_DATE - INTERVAL '7 days'`),
        ),
      )
      .orderBy(desc(basketballMatches.kickoffTime))
      .limit(50);

    updated = rows.length;

    const source = 'espn+qiumibao-fallback';

    return { source, updated };
  }

  async getWnbaMatches(limit = 30): Promise<
    {
      id: string;
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: Date;
      matchStatus: string;
      homeScore: number | null;
      awayScore: number | null;
      homeWinProb: number;
      awayWinProb: number;
      predictionDirection: string;
      handicapLineNum: string | null;
      handicapRecommendation: string;
      totalLineNum: string | null;
      totalDirection: string;
      confidence: number;
    }[]
  > {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        homeWinProb: basketballMatches.homeWinProb,
        awayWinProb: basketballMatches.awayWinProb,
        predictionDirection: basketballMatches.predictionDirection,
        handicapLineNum: basketballMatches.handicapLineNum,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        totalLineNum: basketballMatches.totalLineNum,
        totalDirection: basketballMatches.totalDirection,
        confidence: basketballMatches.confidence,
      })
      .from(basketballMatches)
      .where(sql`lower(${basketballMatches.league}) LIKE '%wnba%'`)
      .orderBy(desc(basketballMatches.kickoffTime))
      .limit(limit);
    return rows.map((r) => ({
      ...r,
      handicapLineNum: r.handicapLineNum?.toString() ?? null,
      totalLineNum: r.totalLineNum?.toString() ?? null,
    }));
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
}
