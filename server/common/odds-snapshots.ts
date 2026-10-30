import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';

export interface FootballOddsSnapshot1x2 {
  home?: number;
  draw?: number;
  away?: number;
}

export interface FootballOddsSnapshotHandicap {
  home?: number;
  draw?: number;
  away?: number;
  line?: number;
}

export interface FootballOddsSnapshotTotal {
  over?: number;
  under?: number;
  line?: number;
}

export type FootballOddsSnapshot =
  | FootballOddsSnapshot1x2
  | FootballOddsSnapshotHandicap
  | FootballOddsSnapshotTotal;

export interface BasketballOddsSnapshotH2H {
  home?: number;
  away?: number;
}

export interface BasketballOddsSnapshotHandicap {
  home?: number;
  away?: number;
  line?: number;
}

export interface BasketballOddsSnapshotTotal {
  over?: number;
  under?: number;
  line?: number;
}

export type BasketballOddsSnapshot =
  | BasketballOddsSnapshotH2H
  | BasketballOddsSnapshotHandicap
  | BasketballOddsSnapshotTotal;

/**
 * Insert a football odds snapshot if values differ from the latest snapshot of the same type.
 * Uses raw SQL to avoid depending on schema.ts codegen (table may not be in schema yet).
 * Returns true if a snapshot was inserted.
 */
export async function insertFootballOddsSnapshotIfChanged(
  db: PostgresJsDatabase,
  matchId: string,
  oddsType: '1x2' | 'handicap' | 'total',
  oddsData: FootballOddsSnapshot,
  source: string,
): Promise<boolean> {
  // Fetch latest snapshot of same type to compare
  const latest = await db.execute<{ odds_json: unknown }>(sql`
    SELECT odds_json
    FROM odds_snapshots
    WHERE match_id = ${matchId}::uuid
      AND odds_type = ${oddsType}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const latestData = latest[0]?.odds_json as Record<string, unknown> | undefined;

  // Compare all relevant numeric fields
  const fields = Object.keys(oddsData) as Array<keyof FootballOddsSnapshot>;
  let changed = false;
  if (!latestData) {
    changed = true;
  } else {
    for (const field of fields) {
      const newVal = oddsData[field] as number | undefined;
      const oldVal = latestData[String(field)] as number | undefined;
      if (newVal === undefined && oldVal === undefined) continue;
      if (newVal === undefined || oldVal === undefined) {
        changed = true;
        break;
      }
      if (Math.abs(newVal - oldVal) > 1e-9) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) return false;

  const jsonStr = JSON.stringify(oddsData);

  await db.execute(sql`
    INSERT INTO odds_snapshots (match_id, odds_type, odds_json, source)
    VALUES (
      ${matchId}::uuid,
      ${oddsType},
      ${jsonStr}::jsonb,
      ${source}
    )
  `);

  return true;
}

/**
 * Insert a basketball odds snapshot if values differ from the latest snapshot of the same type.
 * Returns true if a snapshot was inserted.
 */
export async function insertBasketballOddsSnapshotIfChanged(
  db: PostgresJsDatabase,
  matchId: string,
  oddsType: 'h2h' | 'handicap' | 'total',
  oddsData: BasketballOddsSnapshot,
  source: string,
): Promise<boolean> {
  const latest = await db.execute<{ odds_json: unknown }>(sql`
    SELECT odds_json
    FROM basketball_odds_snapshots
    WHERE match_id = ${matchId}::uuid
      AND odds_type = ${oddsType}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const latestData = latest[0]?.odds_json as Record<string, unknown> | undefined;

  const fields = Object.keys(oddsData) as Array<keyof BasketballOddsSnapshot>;
  let changed = false;
  if (!latestData) {
    changed = true;
  } else {
    for (const field of fields) {
      const newVal = oddsData[field] as number | undefined;
      const oldVal = latestData[String(field)] as number | undefined;
      if (newVal === undefined && oldVal === undefined) continue;
      if (newVal === undefined || oldVal === undefined) {
        changed = true;
        break;
      }
      if (Math.abs(newVal - oldVal) > 1e-9) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) return false;

  const jsonStr = JSON.stringify(oddsData);

  await db.execute(sql`
    INSERT INTO basketball_odds_snapshots (match_id, odds_type, odds_json, source)
    VALUES (
      ${matchId}::uuid,
      ${oddsType},
      ${jsonStr}::jsonb,
      ${source}
    )
  `);

  return true;
}
