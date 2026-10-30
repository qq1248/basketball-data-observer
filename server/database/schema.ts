/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const basketballMatchesBackup20261030HomeawayFix = pgTable("basketball_matches_backup_20261030_homeaway_fix", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  matchDate: varchar("match_date", { length: 50 }),
  homeWinProb: integer("home_win_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapCoverProb: integer("handicap_cover_prob"),
  handicapRecommendation: varchar("handicap_recommendation", { length: 20 }),
  totalLine: varchar("total_line", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalDirection: varchar("total_direction", { length: 10 }),
  predictedHomeScore: integer("predicted_home_score"),
  predictedAwayScore: integer("predicted_away_score"),
  confidence: integer("confidence"),
  intel: text("intel"),
  riskWarning: text("risk_warning"),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  isNeutral: boolean("is_neutral"),
  category: varchar("category", { length: 20 }),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  venue: varchar("venue", { length: 50 }),
  homeWinOdds: numeric("home_win_odds"),
  awayWinOdds: numeric("away_win_odds"),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapPickProb: integer("handicap_pick_prob"),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  spreadProb15: integer("spread_prob_1_5"),
  spreadProb610: integer("spread_prob_6_10"),
  spreadProb1115: integer("spread_prob_11_15"),
  spreadProb1620: integer("spread_prob_16_20"),
  spreadProb21Plus: integer("spread_prob_21_plus"),
  spreadTopRange: varchar("spread_top_range", { length: 20 }),
  teamStats: jsonb("team_stats"),
  injuries: jsonb("injuries"),
  h2hHistory: jsonb("h2h_history"),
  radarData: jsonb("radar_data"),
  recentForm: jsonb("recent_form"),
  dataUpdatedAt: customTimestamptz("data_updated_at", { precision: 6 }),
  modelRules: text("model_rules").array(),
  handicapLineNum: numeric("handicap_line_num"),
  totalLineNum: numeric("total_line_num"),
  predHtHome: integer("pred_ht_home"),
  predHtAway: integer("pred_ht_away"),
  keyPlayers: jsonb("key_players"),
  upsetWarning: text("upset_warning"),
  intelSummary: text("intel_summary"),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  predictedTotal: numeric("predicted_total"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  ouDiffVsLine: numeric("ou_diff_vs_line"),
  rulesTriggered: jsonb("rules_triggered"),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  teamNews: text("team_news"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  businessDate: date("business_date"),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 30 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  oddsOpenHandicapLine: varchar("odds_open_handicap_line", { length: 10 }),
  oddsOpenTotalLine: varchar("odds_open_total_line", { length: 10 }),
  oddsOpenHomeWin: numeric("odds_open_home_win"),
  oddsOpenAwayWin: numeric("odds_open_away_win"),
  oddsOpenHandicapHome: numeric("odds_open_handicap_home"),
  oddsOpenHandicapAway: numeric("odds_open_handicap_away"),
  oddsOpenTotalOver: numeric("odds_open_total_over"),
  oddsOpenTotalUnder: numeric("odds_open_total_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  predEngineVersion: varchar("pred_engine_version", { length: 50 }),
  predictionAnchor: varchar("prediction_anchor", { length: 20 }),
  subModels: jsonb("sub_models"),
  injuryAdjustApplied: numeric("injury_adjust_applied"),
  injuryAdjustPct: integer("injury_adjust_pct"),
  advancedDataReady: boolean("advanced_data_ready"),
  advancedDataNotice: text("advanced_data_notice"),
  injuryUpdatedAt: customTimestamptz("injury_updated_at", { precision: 3 }),
  intelAdjustments: jsonb("intel_adjustments"),
  isOfficialLocked: boolean("is_official_locked"),
  starRating: varchar("star_rating", { length: 20 }),
  resultPendingReason: varchar("result_pending_reason", { length: 255 }),
  eloHome: numeric("elo_home"),
  eloAway: numeric("elo_away"),
  eloGap: numeric("elo_gap"),
  predictionRecalcReason: text("prediction_recalc_reason"),
  predictionRecalcAt: customTimestamptz("prediction_recalc_at", { precision: 3 }),
  predictionSnapshotHandicapLine: numeric("prediction_snapshot_handicap_line"),
  predictionSnapshotTotalLine: numeric("prediction_snapshot_total_line"),
  recentFormDetail: jsonb("recent_form_detail"),
  predGeneratedAt: customTimestamptz("pred_generated_at", { precision: 3 }),
  livePeriodEstimated: boolean("live_period_estimated"),
  isPredictionFrozen: boolean("is_prediction_frozen"),
  handicapOverride: jsonb("handicap_override"),
  totalOverride: jsonb("total_override"),
  frozenHandicapRec: varchar("frozen_handicap_rec", { length: 50 }),
  frozenTotalDirection: varchar("frozen_total_direction", { length: 50 }),
  frozenPredictionDirection: varchar("frozen_prediction_direction", { length: 50 }),
  frozenConfidence: integer("frozen_confidence"),
  frozenHandicapLine: numeric("frozen_handicap_line"),
  frozenTotalLine: numeric("frozen_total_line"),
  predictionHistory: jsonb("prediction_history"),
  predictionLockedUntil: customTimestamptz("prediction_locked_until", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
});

export const basketballMatchesBackup20261030BeforeFinalFlip = pgTable("basketball_matches_backup_20261030_before_final_flip", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  matchDate: varchar("match_date", { length: 50 }),
  homeWinProb: integer("home_win_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapCoverProb: integer("handicap_cover_prob"),
  handicapRecommendation: varchar("handicap_recommendation", { length: 20 }),
  totalLine: varchar("total_line", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalDirection: varchar("total_direction", { length: 10 }),
  predictedHomeScore: integer("predicted_home_score"),
  predictedAwayScore: integer("predicted_away_score"),
  confidence: integer("confidence"),
  intel: text("intel"),
  riskWarning: text("risk_warning"),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  isNeutral: boolean("is_neutral"),
  category: varchar("category", { length: 20 }),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  venue: varchar("venue", { length: 50 }),
  homeWinOdds: numeric("home_win_odds"),
  awayWinOdds: numeric("away_win_odds"),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapPickProb: integer("handicap_pick_prob"),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  spreadProb15: integer("spread_prob_1_5"),
  spreadProb610: integer("spread_prob_6_10"),
  spreadProb1115: integer("spread_prob_11_15"),
  spreadProb1620: integer("spread_prob_16_20"),
  spreadProb21Plus: integer("spread_prob_21_plus"),
  spreadTopRange: varchar("spread_top_range", { length: 20 }),
  teamStats: jsonb("team_stats"),
  injuries: jsonb("injuries"),
  h2hHistory: jsonb("h2h_history"),
  radarData: jsonb("radar_data"),
  recentForm: jsonb("recent_form"),
  dataUpdatedAt: customTimestamptz("data_updated_at", { precision: 6 }),
  modelRules: text("model_rules").array(),
  handicapLineNum: numeric("handicap_line_num"),
  totalLineNum: numeric("total_line_num"),
  predHtHome: integer("pred_ht_home"),
  predHtAway: integer("pred_ht_away"),
  keyPlayers: jsonb("key_players"),
  upsetWarning: text("upset_warning"),
  intelSummary: text("intel_summary"),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  predictedTotal: numeric("predicted_total"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  ouDiffVsLine: numeric("ou_diff_vs_line"),
  rulesTriggered: jsonb("rules_triggered"),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  teamNews: text("team_news"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  businessDate: date("business_date"),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 30 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  oddsOpenHandicapLine: varchar("odds_open_handicap_line", { length: 10 }),
  oddsOpenTotalLine: varchar("odds_open_total_line", { length: 10 }),
  oddsOpenHomeWin: numeric("odds_open_home_win"),
  oddsOpenAwayWin: numeric("odds_open_away_win"),
  oddsOpenHandicapHome: numeric("odds_open_handicap_home"),
  oddsOpenHandicapAway: numeric("odds_open_handicap_away"),
  oddsOpenTotalOver: numeric("odds_open_total_over"),
  oddsOpenTotalUnder: numeric("odds_open_total_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  predEngineVersion: varchar("pred_engine_version", { length: 50 }),
  predictionAnchor: varchar("prediction_anchor", { length: 20 }),
  subModels: jsonb("sub_models"),
  injuryAdjustApplied: numeric("injury_adjust_applied"),
  injuryAdjustPct: integer("injury_adjust_pct"),
  advancedDataReady: boolean("advanced_data_ready"),
  advancedDataNotice: text("advanced_data_notice"),
  injuryUpdatedAt: customTimestamptz("injury_updated_at", { precision: 3 }),
  intelAdjustments: jsonb("intel_adjustments"),
  isOfficialLocked: boolean("is_official_locked"),
  starRating: varchar("star_rating", { length: 20 }),
  resultPendingReason: varchar("result_pending_reason", { length: 255 }),
  eloHome: numeric("elo_home"),
  eloAway: numeric("elo_away"),
  eloGap: numeric("elo_gap"),
  predictionRecalcReason: text("prediction_recalc_reason"),
  predictionRecalcAt: customTimestamptz("prediction_recalc_at", { precision: 3 }),
  predictionSnapshotHandicapLine: numeric("prediction_snapshot_handicap_line"),
  predictionSnapshotTotalLine: numeric("prediction_snapshot_total_line"),
  recentFormDetail: jsonb("recent_form_detail"),
  predGeneratedAt: customTimestamptz("pred_generated_at", { precision: 3 }),
  livePeriodEstimated: boolean("live_period_estimated"),
  isPredictionFrozen: boolean("is_prediction_frozen"),
  handicapOverride: jsonb("handicap_override"),
  totalOverride: jsonb("total_override"),
  frozenHandicapRec: varchar("frozen_handicap_rec", { length: 50 }),
  frozenTotalDirection: varchar("frozen_total_direction", { length: 50 }),
  frozenPredictionDirection: varchar("frozen_prediction_direction", { length: 50 }),
  frozenConfidence: integer("frozen_confidence"),
  frozenHandicapLine: numeric("frozen_handicap_line"),
  frozenTotalLine: numeric("frozen_total_line"),
  predictionHistory: jsonb("prediction_history"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
});

export const basketballMatchesBackup20261030Homeaway = pgTable("basketball_matches_backup_20261030_homeaway", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  matchDate: varchar("match_date", { length: 50 }),
  homeWinProb: integer("home_win_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapCoverProb: integer("handicap_cover_prob"),
  handicapRecommendation: varchar("handicap_recommendation", { length: 20 }),
  totalLine: varchar("total_line", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalDirection: varchar("total_direction", { length: 10 }),
  predictedHomeScore: integer("predicted_home_score"),
  predictedAwayScore: integer("predicted_away_score"),
  confidence: integer("confidence"),
  intel: text("intel"),
  riskWarning: text("risk_warning"),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  isNeutral: boolean("is_neutral"),
  category: varchar("category", { length: 20 }),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  venue: varchar("venue", { length: 50 }),
  homeWinOdds: numeric("home_win_odds"),
  awayWinOdds: numeric("away_win_odds"),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapPickProb: integer("handicap_pick_prob"),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  spreadProb15: integer("spread_prob_1_5"),
  spreadProb610: integer("spread_prob_6_10"),
  spreadProb1115: integer("spread_prob_11_15"),
  spreadProb1620: integer("spread_prob_16_20"),
  spreadProb21Plus: integer("spread_prob_21_plus"),
  spreadTopRange: varchar("spread_top_range", { length: 20 }),
  teamStats: jsonb("team_stats"),
  injuries: jsonb("injuries"),
  h2hHistory: jsonb("h2h_history"),
  radarData: jsonb("radar_data"),
  recentForm: jsonb("recent_form"),
  dataUpdatedAt: customTimestamptz("data_updated_at", { precision: 6 }),
  modelRules: text("model_rules").array(),
  handicapLineNum: numeric("handicap_line_num"),
  totalLineNum: numeric("total_line_num"),
  predHtHome: integer("pred_ht_home"),
  predHtAway: integer("pred_ht_away"),
  keyPlayers: jsonb("key_players"),
  upsetWarning: text("upset_warning"),
  intelSummary: text("intel_summary"),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  predictedTotal: numeric("predicted_total"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  ouDiffVsLine: numeric("ou_diff_vs_line"),
  rulesTriggered: jsonb("rules_triggered"),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  teamNews: text("team_news"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  businessDate: date("business_date"),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 30 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  oddsOpenHandicapLine: varchar("odds_open_handicap_line", { length: 10 }),
  oddsOpenTotalLine: varchar("odds_open_total_line", { length: 10 }),
  oddsOpenHomeWin: numeric("odds_open_home_win"),
  oddsOpenAwayWin: numeric("odds_open_away_win"),
  oddsOpenHandicapHome: numeric("odds_open_handicap_home"),
  oddsOpenHandicapAway: numeric("odds_open_handicap_away"),
  oddsOpenTotalOver: numeric("odds_open_total_over"),
  oddsOpenTotalUnder: numeric("odds_open_total_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  predEngineVersion: varchar("pred_engine_version", { length: 50 }),
  predictionAnchor: varchar("prediction_anchor", { length: 20 }),
  subModels: jsonb("sub_models"),
  injuryAdjustApplied: numeric("injury_adjust_applied"),
  injuryAdjustPct: integer("injury_adjust_pct"),
  advancedDataReady: boolean("advanced_data_ready"),
  advancedDataNotice: text("advanced_data_notice"),
  injuryUpdatedAt: customTimestamptz("injury_updated_at", { precision: 3 }),
  intelAdjustments: jsonb("intel_adjustments"),
  isOfficialLocked: boolean("is_official_locked"),
  starRating: varchar("star_rating", { length: 20 }),
  resultPendingReason: varchar("result_pending_reason", { length: 255 }),
  eloHome: numeric("elo_home"),
  eloAway: numeric("elo_away"),
  eloGap: numeric("elo_gap"),
  predictionRecalcReason: text("prediction_recalc_reason"),
  predictionRecalcAt: customTimestamptz("prediction_recalc_at", { precision: 3 }),
  predictionSnapshotHandicapLine: numeric("prediction_snapshot_handicap_line"),
  predictionSnapshotTotalLine: numeric("prediction_snapshot_total_line"),
  recentFormDetail: jsonb("recent_form_detail"),
  predGeneratedAt: customTimestamptz("pred_generated_at", { precision: 3 }),
  livePeriodEstimated: boolean("live_period_estimated"),
  isPredictionFrozen: boolean("is_prediction_frozen"),
  handicapOverride: jsonb("handicap_override"),
  totalOverride: jsonb("total_override"),
  frozenHandicapRec: varchar("frozen_handicap_rec", { length: 50 }),
  frozenTotalDirection: varchar("frozen_total_direction", { length: 50 }),
  frozenPredictionDirection: varchar("frozen_prediction_direction", { length: 50 }),
  frozenConfidence: integer("frozen_confidence"),
  frozenHandicapLine: numeric("frozen_handicap_line"),
  frozenTotalLine: numeric("frozen_total_line"),
  predictionHistory: jsonb("prediction_history"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
});

export const dailyReview = pgTable("daily_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewDate: date("review_date").notNull(),
  sport: varchar("sport", { length: 20 }).notNull(),
  totalMatches: integer("total_matches").notNull().default(0),
  wdwHit: integer("wdw_hit"),
  wdwTotal: integer("wdw_total"),
  wdwRate: numeric("wdw_rate"),
  handicapHit: integer("handicap_hit"),
  handicapTotal: integer("handicap_total"),
  handicapRate: numeric("handicap_rate"),
  overunderHit: integer("overunder_hit"),
  overunderTotal: integer("overunder_total"),
  overunderRate: numeric("overunder_rate"),
  /**
   * @type { league: string, total: number, hdcHit: number, hdcRate: number, ouHit: number, ouRate: number }[]
   */
  byLeague: jsonb("by_league").notNull().default('[]'),
  /**
   * @type { matchNo: string, league: string, homeTeam: string, awayTeam: string, handicapDir: string, handicapLine: number, actualSpread: number, hit: boolean, totalDir: string, totalLine: number, actualTotal: number, totalHit: boolean, deviationNote: string }[]
   */
  anomalyMatches: jsonb("anomaly_matches").notNull().default('[]'),
  summary: text("summary"),
  source: varchar("source", { length: 20 }).notNull().default('all'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("idx_daily_review_date_sport_source").on(table.reviewDate, table.sport, table.source),
]);

export const scoreSentinelLogs = pgTable("score_sentinel_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id"),
  matchNo: varchar("match_no", { length: 100 }),
  source: varchar("source", { length: 50 }),
  errorType: varchar("error_type", { length: 50 }),
  prevHomeScore: integer("prev_home_score"),
  prevAwayScore: integer("prev_away_score"),
  wrongHomeScore: integer("wrong_home_score"),
  wrongAwayScore: integer("wrong_away_score"),
  correctHomeScore: integer("correct_home_score"),
  correctAwayScore: integer("correct_away_score"),
  reason: text("reason"),
  createdAt: customTimestamptz("created_at", { precision: 6 }).default(sql`CURRENT_TIMESTAMP`),
  errorDetail: text("error_detail"),
  attemptedStatus: varchar("attempted_status", { length: 50 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  serverTime: customTimestamptz("server_time", { precision: 6 }).default(sql`CURRENT_TIMESTAMP`),
  payload: jsonb("payload"),
}, (table) => [
  index("idx_sentinel_logs_error_type").on(table.errorType),
  index("idx_sentinel_logs_match_no").on(table.matchNo),
]);

export const teamSeasonStats = pgTable("team_season_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamName: varchar("team_name", { length: 100 }).notNull(),
  league: varchar("league", { length: 100 }).notNull(),
  season: varchar("season", { length: 20 }).notNull(),
  sport: varchar("sport", { length: 20 }).notNull().default('basketball'),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ppg: numeric("ppg").notNull().default('0'),
  oppg: numeric("oppg").notNull().default('0'),
  homePpg: numeric("home_ppg"),
  homeOppg: numeric("home_oppg"),
  awayPpg: numeric("away_ppg"),
  awayOppg: numeric("away_oppg"),
  recent10Ppg: numeric("recent10_ppg"),
  recent10Oppg: numeric("recent10_oppg"),
  recent20Ppg: numeric("recent20_ppg"),
  recent20Oppg: numeric("recent20_oppg"),
  fieldGoalPct: numeric("field_goal_pct"),
  threePointPct: numeric("three_point_pct"),
  dataSource: varchar("data_source", { length: 100 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("team_season_stats_team_name_league_season_sport_key").on(table.teamName, table.league, table.season, table.sport),
  index("idx_team_season_stats_team").on(table.teamName),
  index("idx_team_season_stats_league_season").on(table.league, table.season, table.sport),
]);

export const aiMatchReports = pgTable("ai_match_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull(),
  sport: varchar("sport", { length: 20 }).notNull().default('basketball'),
  reportType: varchar("report_type", { length: 50 }).notNull().default('full_analysis'),
  content: text("content").notNull(),
  modelVersion: varchar("model_version", { length: 50 }),
  generationTimeMs: integer("generation_time_ms"),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_ai_report_match_sport").on(table.matchId, table.sport),
  index("idx_ai_report_status").on(table.status),
]);

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  matchIds: uuid("match_ids").array(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_ai_msg_conv_id").on(table.conversationId),
  index("idx_ai_msg_created_at").on(table.createdAt),
  foreignKey({
    columns: [table.conversationId],
    foreignColumns: [aiChatConversations.id],
    name: "ai_chat_messages_conversation_id_fkey",
  }).onDelete("cascade"),
]);

export const aiChatConversations = pgTable("ai_chat_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 200 }).notNull().default('新对话'),
  sport: varchar("sport", { length: 20 }).notNull().default('basketball'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const modelRuleDetailsBackup20261020 = pgTable("model_rule_details_backup_20261020", {
  id: uuid("id"),
  ruleCode: varchar("rule_code", { length: 20 }),
  ruleName: varchar("rule_name", { length: 100 }),
  category: varchar("category", { length: 50 }),
  triggerCondition: text("trigger_condition"),
  impactFormula: text("impact_formula"),
  hitRate: numeric("hit_rate"),
  sampleSize: integer("sample_size"),
  description: text("description"),
  params: text("params").array(),
  sortOrder: integer("sort_order"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
});

export const matchAutoCheckReports = pgTable("match_auto_check_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkType: varchar("check_type", { length: 50 }).notNull().default('basketball'),
  triggerSource: varchar("trigger_source", { length: 50 }).notNull().default('sync'),
  triggerTask: varchar("trigger_task", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  totalMatches: integer("total_matches").notNull().default(0),
  upcomingCount: integer("upcoming_count").notNull().default(0),
  liveCount: integer("live_count").notNull().default(0),
  finishedCount: integer("finished_count").notNull().default(0),
  totalIssues: integer("total_issues").notNull().default(0),
  autoFixed: integer("auto_fixed").notNull().default(0),
  needsManual: integer("needs_manual").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  errorMessage: text("error_message"),
  /**
   * @type { integrity: { total: number, predicted: number, emptyFields: number, duplicateMatchNos: number }, statusFlow: { finished: number, pendingHit: number, stuckLive: number, wrongFinished: number }, periodDisplay: { reliable: number, estimated: number, misleading: number, otMislabeled: number }, dataCorrectness: { lineValid: number, directionConsistent: number, scoreAnomalies: number }, hitBackfill: { finishedWithHit: number, finishedMissingHit: number, hitMismatch: number }, modelBaseline: { v11Count: number, baselineByLeague: Record<string, number>, emptyFeatures: number, injuryAdjustApplied: number } }
   */
  summary: jsonb("summary").notNull().default('{}'),
  /**
   * @type { category: string, subCategory: string, severity: "low" | "medium" | "high", matchId: string, matchNo: string, league: string, homeTeam: string, awayTeam: string, detail: string, autoFixable: boolean, fixStatus: "pending" | "fixed" | "failed", fixDetail: string }[]
   */
  issues: jsonb("issues").notNull().default('[]'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_match_auto_check_reports_created_at").on(table.createdAt),
  index("idx_match_auto_check_reports_check_type").on(table.checkType),
  index("idx_match_auto_check_reports_status").on(table.status),
]);

export const backtestResults = pgTable("backtest_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  engineVersion: varchar("engine_version", { length: 50 }).notNull(),
  sport: varchar("sport", { length: 20 }).notNull(),
  sampleScope: varchar("sample_scope", { length: 50 }).notNull(),
  source: varchar("source", { length: 50 }),
  leagueFilter: varchar("league_filter", { length: 100 }),
  dateFrom: date("date_from"),
  dateTo: date("date_to"),
  sampleSize: integer("sample_size").notNull().default(0),
  wdwHitRate: numeric("wdw_hit_rate"),
  handicapHitRate: numeric("handicap_hit_rate"),
  overunderHitRate: numeric("overunder_hit_rate"),
  wdwSample: integer("wdw_sample").default(0),
  handicapSample: integer("handicap_sample").default(0),
  overunderSample: integer("overunder_sample").default(0),
  note: text("note"),
  calculatedAt: customTimestamptz("calculated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_backtest_sport_version").on(table.sport, table.engineVersion, table.calculatedAt),
]);

export const injuryReports = pgTable("injury_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id"),
  sport: varchar("sport", { length: 20 }).notNull().default('basketball'),
  teamSide: varchar("team_side", { length: 10 }).notNull(),
  teamName: varchar("team_name", { length: 255 }).notNull(),
  playerName: varchar("player_name", { length: 255 }).notNull(),
  position: varchar("position", { length: 50 }),
  injuryType: varchar("injury_type", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default('out'),
  impactRating: varchar("impact_rating", { length: 20 }).notNull().default('low'),
  expectedReturn: varchar("expected_return", { length: 255 }),
  source: varchar("source", { length: 50 }).notNull(),
  dataSource: varchar("data_source", { length: 50 }).notNull(),
  shortComment: text("short_comment"),
  longComment: text("long_comment"),
  injuryDate: customTimestamptz("injury_date", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_injury_reports_match_id").on(table.matchId),
  index("idx_injury_reports_sport").on(table.sport),
  index("idx_injury_reports_impact").on(table.impactRating),
  index("idx_injury_reports_team").on(table.teamName),
]);

export const teamAlias = pgTable("team_alias", {
  id: uuid("id").primaryKey().defaultRandom(),
  sport: varchar("sport", { length: 20 }).notNull(),
  canonicalName: varchar("canonical_name", { length: 100 }).notNull(),
  aliasName: varchar("alias_name", { length: 100 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("team_alias_sport_canonical_name_alias_name_key").on(table.sport, table.canonicalName, table.aliasName),
]);

export const teamsElo = pgTable("teams_elo", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamName: varchar("team_name", { length: 100 }).notNull(),
  sport: varchar("sport", { length: 20 }).notNull().default('football'),
  league: varchar("league", { length: 100 }).notNull(),
  eloRating: numeric("elo_rating").notNull().default('1500.00'),
  initialRating: numeric("initial_rating").notNull().default('1500.00'),
  kFactor: integer("k_factor").notNull().default(32),
  homeAdvantage: numeric("home_advantage").notNull().default('65.00'),
  regressToMean: numeric("regress_to_mean").notNull().default('0.00'),
  matchesPlayed: integer("matches_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  goalsFor: integer("goals_for").notNull().default(0),
  goalsAgainst: integer("goals_against").notNull().default(0),
  currentForm: text("current_form").array().notNull().default([]),
  lastMatchDate: date("last_match_date"),
  season: varchar("season", { length: 20 }).default('current'),
  version: integer("version").notNull().default(1),
  engineVersion: varchar("engine_version", { length: 20 }).notNull().default('v10.0-elo'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("idx_teams_elo_team_sport_league").on(table.teamName, table.sport, table.league),
  index("idx_teams_elo_sport_league").on(table.sport, table.league),
  index("idx_teams_elo_rating").on(table.eloRating),
]);

export const bakBasketballExpiredUpcoming20261015 = pgTable("bak_basketball_expired_upcoming_20261015", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  matchDate: varchar("match_date", { length: 50 }),
  homeWinProb: integer("home_win_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapCoverProb: integer("handicap_cover_prob"),
  handicapRecommendation: varchar("handicap_recommendation", { length: 20 }),
  totalLine: varchar("total_line", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalDirection: varchar("total_direction", { length: 10 }),
  predictedHomeScore: integer("predicted_home_score"),
  predictedAwayScore: integer("predicted_away_score"),
  confidence: integer("confidence"),
  intel: text("intel"),
  riskWarning: text("risk_warning"),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  isNeutral: boolean("is_neutral"),
  category: varchar("category", { length: 20 }),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  venue: varchar("venue", { length: 50 }),
  homeWinOdds: numeric("home_win_odds"),
  awayWinOdds: numeric("away_win_odds"),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapPickProb: integer("handicap_pick_prob"),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  spreadProb15: integer("spread_prob_1_5"),
  spreadProb610: integer("spread_prob_6_10"),
  spreadProb1115: integer("spread_prob_11_15"),
  spreadProb1620: integer("spread_prob_16_20"),
  spreadProb21Plus: integer("spread_prob_21_plus"),
  spreadTopRange: varchar("spread_top_range", { length: 20 }),
  teamStats: jsonb("team_stats"),
  injuries: jsonb("injuries"),
  h2hHistory: jsonb("h2h_history"),
  radarData: jsonb("radar_data"),
  recentForm: jsonb("recent_form"),
  dataUpdatedAt: customTimestamptz("data_updated_at", { precision: 6 }),
  modelRules: text("model_rules").array(),
  handicapLineNum: numeric("handicap_line_num"),
  totalLineNum: numeric("total_line_num"),
  predHtHome: integer("pred_ht_home"),
  predHtAway: integer("pred_ht_away"),
  keyPlayers: jsonb("key_players"),
  upsetWarning: text("upset_warning"),
  intelSummary: text("intel_summary"),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  predictedTotal: numeric("predicted_total"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  ouDiffVsLine: numeric("ou_diff_vs_line"),
  rulesTriggered: jsonb("rules_triggered"),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  teamNews: text("team_news"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  businessDate: date("business_date"),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 30 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  oddsOpenHandicapLine: varchar("odds_open_handicap_line", { length: 10 }),
  oddsOpenTotalLine: varchar("odds_open_total_line", { length: 10 }),
  oddsOpenHomeWin: numeric("odds_open_home_win"),
  oddsOpenAwayWin: numeric("odds_open_away_win"),
  oddsOpenHandicapHome: numeric("odds_open_handicap_home"),
  oddsOpenHandicapAway: numeric("odds_open_handicap_away"),
  oddsOpenTotalOver: numeric("odds_open_total_over"),
  oddsOpenTotalUnder: numeric("odds_open_total_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  predEngineVersion: varchar("pred_engine_version", { length: 20 }),
  predictionAnchor: varchar("prediction_anchor", { length: 20 }),
  subModels: jsonb("sub_models"),
  injuryAdjustApplied: numeric("injury_adjust_applied"),
  injuryAdjustPct: integer("injury_adjust_pct"),
  advancedDataReady: boolean("advanced_data_ready"),
  advancedDataNotice: text("advanced_data_notice"),
  injuryUpdatedAt: customTimestamptz("injury_updated_at", { precision: 3 }),
  intelAdjustments: jsonb("intel_adjustments"),
  isOfficialLocked: boolean("is_official_locked"),
  starRating: varchar("star_rating", { length: 20 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
});

export const bakMatchesExpiredUpcoming20261015 = pgTable("bak_matches_expired_upcoming_20261015", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  homeWinProb: integer("home_win_prob"),
  drawProb: integer("draw_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapRecommendation: varchar("handicap_recommendation", { length: 50 }),
  confidence: integer("confidence"),
  lowConfidence: boolean("low_confidence"),
  intel: text("intel"),
  modelRules: text("model_rules").array(),
  matchDate: date("match_date"),
  overUnder: varchar("over_under", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalGoals: numeric("total_goals"),
  mostLikelyScore: varchar("most_likely_score", { length: 50 }),
  scoreProbs: text("score_probs").array(),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  homeForm: text("home_form").array(),
  awayForm: text("away_form").array(),
  h2h: text("h2h").array(),
  oddsOpenHome: numeric("odds_open_home"),
  oddsOpenDraw: numeric("odds_open_draw"),
  oddsOpenAway: numeric("odds_open_away"),
  oddsLiveHome: numeric("odds_live_home"),
  oddsLiveDraw: numeric("odds_live_draw"),
  oddsLiveAway: numeric("odds_live_away"),
  totalGoalsProb: jsonb("total_goals_prob"),
  halfFullProb: jsonb("half_full_prob"),
  advancedStats: jsonb("advanced_stats"),
  environment: jsonb("environment"),
  drawConfidence: varchar("draw_confidence", { length: 20 }),
  drawFactors: text("draw_factors").array(),
  handicapWinProb: numeric("handicap_win_prob"),
  handicapDrawProb: numeric("handicap_draw_prob"),
  handicapLoseProb: numeric("handicap_lose_prob"),
  kellyH: numeric("kelly_h"),
  kellyD: numeric("kelly_d"),
  kellyA: numeric("kelly_a"),
  handicapSecondChoice: varchar("handicap_second_choice", { length: 50 }),
  handicapValueRating: varchar("handicap_value_rating", { length: 20 }),
  rulesTriggered: jsonb("rules_triggered"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  hitGoals: boolean("hit_goals"),
  hitHalffull: boolean("hit_halffull"),
  errorReason: varchar("error_reason", { length: 100 }),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  handicapType: varchar("handicap_type", { length: 20 }),
  homeGoalsAvg: numeric("home_goals_avg"),
  awayGoalsAvg: numeric("away_goals_avg"),
  homeConcededAvg: numeric("home_conceded_avg"),
  awayConcededAvg: numeric("away_conceded_avg"),
  homeHomeRecord: varchar("home_home_record", { length: 100 }),
  awayAwayRecord: varchar("away_away_record", { length: 100 }),
  homeInjuries: text("home_injuries"),
  awayInjuries: text("away_injuries"),
  tacticsHome: text("tactics_home"),
  tacticsAway: text("tactics_away"),
  keyPlayersHome: text("key_players_home"),
  keyPlayersAway: text("key_players_away"),
  upsetWarning: text("upset_warning"),
  teamNews: text("team_news"),
  injuries: text("injuries"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  keyPlayers: text("key_players"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 20 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  businessDate: date("business_date"),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsDraw: numeric("handicap_odds_draw"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  isOfficialLocked: boolean("is_official_locked"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
});

export const bakMatchesFinished20261015 = pgTable("bak_matches_finished_20261015", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  homeWinProb: integer("home_win_prob"),
  drawProb: integer("draw_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapRecommendation: varchar("handicap_recommendation", { length: 50 }),
  confidence: integer("confidence"),
  lowConfidence: boolean("low_confidence"),
  intel: text("intel"),
  modelRules: text("model_rules").array(),
  matchDate: date("match_date"),
  overUnder: varchar("over_under", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalGoals: numeric("total_goals"),
  mostLikelyScore: varchar("most_likely_score", { length: 50 }),
  scoreProbs: text("score_probs").array(),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  homeForm: text("home_form").array(),
  awayForm: text("away_form").array(),
  h2h: text("h2h").array(),
  oddsOpenHome: numeric("odds_open_home"),
  oddsOpenDraw: numeric("odds_open_draw"),
  oddsOpenAway: numeric("odds_open_away"),
  oddsLiveHome: numeric("odds_live_home"),
  oddsLiveDraw: numeric("odds_live_draw"),
  oddsLiveAway: numeric("odds_live_away"),
  totalGoalsProb: jsonb("total_goals_prob"),
  halfFullProb: jsonb("half_full_prob"),
  advancedStats: jsonb("advanced_stats"),
  environment: jsonb("environment"),
  drawConfidence: varchar("draw_confidence", { length: 20 }),
  drawFactors: text("draw_factors").array(),
  handicapWinProb: numeric("handicap_win_prob"),
  handicapDrawProb: numeric("handicap_draw_prob"),
  handicapLoseProb: numeric("handicap_lose_prob"),
  kellyH: numeric("kelly_h"),
  kellyD: numeric("kelly_d"),
  kellyA: numeric("kelly_a"),
  handicapSecondChoice: varchar("handicap_second_choice", { length: 50 }),
  handicapValueRating: varchar("handicap_value_rating", { length: 20 }),
  rulesTriggered: jsonb("rules_triggered"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  hitGoals: boolean("hit_goals"),
  hitHalffull: boolean("hit_halffull"),
  errorReason: varchar("error_reason", { length: 100 }),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  handicapType: varchar("handicap_type", { length: 20 }),
  homeGoalsAvg: numeric("home_goals_avg"),
  awayGoalsAvg: numeric("away_goals_avg"),
  homeConcededAvg: numeric("home_conceded_avg"),
  awayConcededAvg: numeric("away_conceded_avg"),
  homeHomeRecord: varchar("home_home_record", { length: 100 }),
  awayAwayRecord: varchar("away_away_record", { length: 100 }),
  homeInjuries: text("home_injuries"),
  awayInjuries: text("away_injuries"),
  tacticsHome: text("tactics_home"),
  tacticsAway: text("tactics_away"),
  keyPlayersHome: text("key_players_home"),
  keyPlayersAway: text("key_players_away"),
  upsetWarning: text("upset_warning"),
  teamNews: text("team_news"),
  injuries: text("injuries"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  keyPlayers: text("key_players"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 20 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  businessDate: date("business_date"),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsDraw: numeric("handicap_odds_draw"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  isOfficialLocked: boolean("is_official_locked"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
});

export const bakBasketballFinished20261015 = pgTable("bak_basketball_finished_20261015", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  league: varchar("league", { length: 100 }),
  homeTeam: varchar("home_team", { length: 100 }),
  awayTeam: varchar("away_team", { length: 100 }),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }),
  matchDate: varchar("match_date", { length: 50 }),
  homeWinProb: integer("home_win_prob"),
  awayWinProb: integer("away_win_prob"),
  predictionDirection: varchar("prediction_direction", { length: 20 }),
  handicap: varchar("handicap", { length: 10 }),
  handicapCoverProb: integer("handicap_cover_prob"),
  handicapRecommendation: varchar("handicap_recommendation", { length: 20 }),
  totalLine: varchar("total_line", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalDirection: varchar("total_direction", { length: 10 }),
  predictedHomeScore: integer("predicted_home_score"),
  predictedAwayScore: integer("predicted_away_score"),
  confidence: integer("confidence"),
  intel: text("intel"),
  riskWarning: text("risk_warning"),
  matchStatus: varchar("match_status", { length: 20 }),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  isNeutral: boolean("is_neutral"),
  category: varchar("category", { length: 20 }),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  venue: varchar("venue", { length: 50 }),
  homeWinOdds: numeric("home_win_odds"),
  awayWinOdds: numeric("away_win_odds"),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapPickProb: integer("handicap_pick_prob"),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob"),
  spreadProb15: integer("spread_prob_1_5"),
  spreadProb610: integer("spread_prob_6_10"),
  spreadProb1115: integer("spread_prob_11_15"),
  spreadProb1620: integer("spread_prob_16_20"),
  spreadProb21Plus: integer("spread_prob_21_plus"),
  spreadTopRange: varchar("spread_top_range", { length: 20 }),
  teamStats: jsonb("team_stats"),
  injuries: jsonb("injuries"),
  h2hHistory: jsonb("h2h_history"),
  radarData: jsonb("radar_data"),
  recentForm: jsonb("recent_form"),
  dataUpdatedAt: customTimestamptz("data_updated_at", { precision: 6 }),
  modelRules: text("model_rules").array(),
  handicapLineNum: numeric("handicap_line_num"),
  totalLineNum: numeric("total_line_num"),
  predHtHome: integer("pred_ht_home"),
  predHtAway: integer("pred_ht_away"),
  keyPlayers: jsonb("key_players"),
  upsetWarning: text("upset_warning"),
  intelSummary: text("intel_summary"),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  predictedTotal: numeric("predicted_total"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  ouDiffVsLine: numeric("ou_diff_vs_line"),
  rulesTriggered: jsonb("rules_triggered"),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  teamNews: text("team_news"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  source: varchar("source", { length: 20 }),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  businessDate: date("business_date"),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 30 }),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  oddsMovements: jsonb("odds_movements"),
  oddsOpenHandicapLine: varchar("odds_open_handicap_line", { length: 10 }),
  oddsOpenTotalLine: varchar("odds_open_total_line", { length: 10 }),
  oddsOpenHomeWin: numeric("odds_open_home_win"),
  oddsOpenAwayWin: numeric("odds_open_away_win"),
  oddsOpenHandicapHome: numeric("odds_open_handicap_home"),
  oddsOpenHandicapAway: numeric("odds_open_handicap_away"),
  oddsOpenTotalOver: numeric("odds_open_total_over"),
  oddsOpenTotalUnder: numeric("odds_open_total_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }),
  predEngineVersion: varchar("pred_engine_version", { length: 20 }),
  predictionAnchor: varchar("prediction_anchor", { length: 20 }),
  subModels: jsonb("sub_models"),
  injuryAdjustApplied: numeric("injury_adjust_applied"),
  injuryAdjustPct: integer("injury_adjust_pct"),
  advancedDataReady: boolean("advanced_data_ready"),
  advancedDataNotice: text("advanced_data_notice"),
  injuryUpdatedAt: customTimestamptz("injury_updated_at", { precision: 3 }),
  intelAdjustments: jsonb("intel_adjustments"),
  isOfficialLocked: boolean("is_official_locked"),
  starRating: varchar("star_rating", { length: 20 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }),
});

export const syncTaskLogs = pgTable("sync_task_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: varchar("task_name", { length: 100 }).notNull(),
  taskType: varchar("task_type", { length: 50 }).notNull().default('scheduled'),
  trigger: varchar("trigger", { length: 50 }).notNull().default('cron'),
  status: varchar("status", { length: 20 }).notNull(),
  startedAt: customTimestamptz("started_at", { precision: 6 }).notNull(),
  finishedAt: customTimestamptz("finished_at", { precision: 6 }),
  durationMs: integer("duration_ms"),
  recordsUpdated: integer("records_updated").default(0),
  dataSource: varchar("data_source", { length: 255 }),
  errorMessage: text("error_message"),
  /**
   * @type { footballUpdated?: number, basketballUpdated?: number, hitBackfilled?: number, leaguesCount?: number }
   */
  details: jsonb("details"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_sync_task_logs_task_name_status").on(table.taskName, table.status, table.startedAt),
  index("idx_sync_task_logs_started_at").on(table.startedAt),
]);

export const ruleDisabled = pgTable("rule_disabled", {
  id: uuid("id").primaryKey().defaultRandom(),
  rulePattern: text("rule_pattern").notNull().unique(),
  ruleDisplay: text("rule_display").notNull(),
  sport: varchar("sport", { length: 20 }).notNull(),
  dimension: varchar("dimension", { length: 20 }).notNull(),
  totalTriggered: integer("total_triggered").notNull().default(0),
  adoptedCount: integer("adopted_count").notNull().default(0),
  adoptedRate: numeric("adopted_rate").notNull().default('0'),
  wdwHitRate: numeric("wdw_hit_rate"),
  handicapHitRate: numeric("handicap_hit_rate"),
  ouHitRate: numeric("ou_hit_rate"),
  action: varchar("action", { length: 20 }).notNull().default('observe'),
  actionReason: text("action_reason"),
  disabledAt: customTimestamptz("disabled_at", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 6 }).notNull().default(sql`now()`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 6 }).notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("rule_disabled_rule_pattern_key").on(table.rulePattern),
  index("idx_rule_disabled_sport").on(table.sport),
  index("idx_rule_disabled_action").on(table.action),
]);

export const snapshotBballPredPreIntel = pgTable("_snapshot_bball_pred_pre_intel", {
  id: uuid("id"),
  matchNo: varchar("match_no", { length: 20 }),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapCoverProb: integer("handicap_cover_prob"),
  handicapPickProb: integer("handicap_pick_prob"),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  totalPick: varchar("total_pick", { length: 10 }),
  overProb: integer("over_prob"),
  underProb: integer("under_prob"),
  totalPickProb: integer("total_pick_prob"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  predictedHomeScore: integer("predicted_home_score"),
  predictedAwayScore: integer("predicted_away_score"),
  predictedTotal: numeric("predicted_total"),
  confidence: integer("confidence"),
  modelRules: text("model_rules").array(),
});

export const basketballOddsSnapshots = pgTable("basketball_odds_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull(),
  oddsType: varchar("odds_type", { length: 20 }).notNull(),
  /**
   * @type { home?: number, away?: number, line?: number, over?: number, under?: number }
   */
  oddsJson: jsonb("odds_json").notNull(),
  source: varchar("source", { length: 50 }),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`now()`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_basketball_odds_snapshots_match_id").on(table.matchId),
  index("idx_basketball_odds_snapshots_created_at").on(table.createdAt),
  index("idx_basketball_odds_snapshots_match_type").on(table.matchId, table.oddsType),
  foreignKey({
    columns: [table.matchId],
    foreignColumns: [basketballMatches.id],
    name: "basketball_odds_snapshots_match_id_fkey",
  }).onDelete("cascade"),
]);

export const oddsSnapshots = pgTable("odds_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull(),
  oddsType: varchar("odds_type", { length: 20 }).notNull(),
  /**
   * @type { home?: number, draw?: number, away?: number, line?: number, over?: number, under?: number }
   */
  oddsJson: jsonb("odds_json").notNull(),
  source: varchar("source", { length: 50 }),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`now()`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_odds_snapshots_match_id").on(table.matchId),
  index("idx_odds_snapshots_created_at").on(table.createdAt),
  index("idx_odds_snapshots_match_type").on(table.matchId, table.oddsType),
  foreignKey({
    columns: [table.matchId],
    foreignColumns: [matches.id],
    name: "odds_snapshots_match_id_fkey",
  }).onDelete("cascade"),
]);

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  targetType: varchar("target_type", { length: 50 }),
  targetId: varchar("target_id", { length: 100 }),
  detail: text("detail"),
  result: varchar("result", { length: 20 }).notNull().default('success'),
  errorMessage: text("error_message"),
  operatorId: varchar("operator_id", { length: 100 }),
  operatorEmail: varchar("operator_email", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_admin_audit_logs_action_type").on(table.actionType),
  index("idx_admin_audit_logs_operator").on(table.operatorId),
  index("idx_admin_audit_logs_created_at").on(table.createdAt),
]);

export const supportMessages = pgTable("support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull(),
  sender: varchar("sender", { length: 10 }).notNull(),
  body: text("body").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_support_messages_ticket_id").on(table.ticketId),
  index("idx_support_messages_created_at").on(table.createdAt),
  foreignKey({
    columns: [table.ticketId],
    foreignColumns: [supportTickets.id],
    name: "support_messages_ticket_id_fkey",
  }).onDelete("cascade"),
]);

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 50 }).notNull().default('其他'),
  status: varchar("status", { length: 20 }).notNull().default('open'),
  priority: varchar("priority", { length: 20 }).notNull().default('normal'),
  lastMessageAt: customTimestamptz("last_message_at", { precision: 3 }),
  unreadByAdmin: integer("unread_by_admin").notNull().default(0),
  unreadByUser: integer("unread_by_user").notNull().default(0),
  userId: uuid("user_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_support_tickets_status").on(table.status),
  index("idx_support_tickets_created_at").on(table.createdAt),
  index("idx_support_tickets_user_id").on(table.userId),
]);

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userData = pgTable("user_data", {
  userId: uuid("user_id").primaryKey(),
  favorites: jsonb("favorites").notNull().default('[]'),
  followedTeams: jsonb("followed_teams").notNull().default('[]'),
  settings: jsonb("settings").notNull().default('{}'),
  records: jsonb("records").notNull().default('[]'),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.userId],
    foreignColumns: [users.id],
    name: "user_data_user_id_fkey",
  }).onDelete("cascade"),
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  role: varchar("role", { length: 50 }).notNull().default('user'),
  status: varchar("status", { length: 50 }).notNull().default('active'),
  lastLoginAt: customTimestamptz("last_login_at", { precision: 3 }),
  lastActiveAt: customTimestamptz("last_active_at", { precision: 3 }),
  sessionToken: varchar("session_token", { length: 255 }),
}, (table) => [
  uniqueIndex("users_email_key").on(table.email),
  index("idx_users_session_token").on(table.sessionToken),
]);

export const dataSnapshots = pgTable("data_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableName: varchar("table_name", { length: 100 }).notNull(),
  snapshotName: varchar("snapshot_name", { length: 255 }).notNull(),
  recordCount: integer("record_count").notNull().default(0),
  predictedCount: integer("predicted_count").notNull().default(0),
  intelCount: integer("intel_count").notNull().default(0),
  emptyFieldsCount: integer("empty_fields_count").notNull().default(0),
  snapshotData: jsonb("snapshot_data").notNull().default('{}'),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const basketballMatches = pgTable("basketball_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchNo: varchar("match_no", { length: 20 }).notNull(),
  league: varchar("league", { length: 100 }).notNull(),
  homeTeam: varchar("home_team", { length: 100 }).notNull(),
  awayTeam: varchar("away_team", { length: 100 }).notNull(),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }).notNull(),
  matchDate: varchar("match_date", { length: 50 }).notNull(),
  homeWinProb: integer("home_win_prob").notNull().default(0),
  awayWinProb: integer("away_win_prob").notNull().default(0),
  predictionDirection: varchar("prediction_direction", { length: 20 }).notNull(),
  handicap: varchar("handicap", { length: 10 }).notNull().default('0'),
  handicapCoverProb: integer("handicap_cover_prob").notNull().default(50),
  handicapRecommendation: varchar("handicap_recommendation", { length: 20 }).notNull(),
  totalLine: varchar("total_line", { length: 10 }).notNull().default('150.5'),
  overProb: integer("over_prob").notNull().default(50),
  underProb: integer("under_prob").notNull().default(50),
  totalDirection: varchar("total_direction", { length: 10 }).notNull(),
  predictedHomeScore: integer("predicted_home_score").notNull().default(0),
  predictedAwayScore: integer("predicted_away_score").notNull().default(0),
  confidence: integer("confidence").notNull().default(0),
  intel: text("intel").notNull(),
  riskWarning: text("risk_warning").notNull(),
  matchStatus: varchar("match_status", { length: 20 }).notNull().default('upcoming'),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  isNeutral: boolean("is_neutral").notNull().default(false),
  category: varchar("category", { length: 20 }).notNull().default('official'),
  handicapOddsHome: numeric("handicap_odds_home").default(sql`NULL::numeric`),
  handicapOddsAway: numeric("handicap_odds_away").default(sql`NULL::numeric`),
  totalOddsOver: numeric("total_odds_over").default(sql`NULL::numeric`),
  totalOddsUnder: numeric("total_odds_under").default(sql`NULL::numeric`),
  venue: varchar("venue", { length: 50 }).notNull().default('主场'),
  homeWinOdds: numeric("home_win_odds"),
  awayWinOdds: numeric("away_win_odds"),
  handicapPick: varchar("handicap_pick", { length: 20 }),
  handicapPickProb: integer("handicap_pick_prob").notNull().default(50),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob").notNull().default(50),
  spreadProb15: integer("spread_prob_1_5").notNull().default(20),
  spreadProb610: integer("spread_prob_6_10").notNull().default(20),
  spreadProb1115: integer("spread_prob_11_15").notNull().default(20),
  spreadProb1620: integer("spread_prob_16_20").notNull().default(20),
  spreadProb21Plus: integer("spread_prob_21_plus").notNull().default(20),
  spreadTopRange: varchar("spread_top_range", { length: 20 }),
  teamStats: jsonb("team_stats"),
  injuries: jsonb("injuries"),
  h2hHistory: jsonb("h2h_history"),
  radarData: jsonb("radar_data"),
  recentForm: jsonb("recent_form"),
  dataUpdatedAt: customTimestamptz("data_updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  modelRules: text("model_rules").array().notNull().default([]),
  handicapLineNum: numeric("handicap_line_num"),
  totalLineNum: numeric("total_line_num"),
  predHtHome: integer("pred_ht_home").default(0),
  predHtAway: integer("pred_ht_away").default(0),
  /**
   * @type { home: BasketballKeyPlayer[], away: BasketballKeyPlayer[] }
   */
  keyPlayers: jsonb("key_players"),
  upsetWarning: text("upset_warning"),
  intelSummary: text("intel_summary"),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  predictedTotal: numeric("predicted_total"),
  ouConfidence: varchar("ou_confidence", { length: 20 }),
  ouDiffVsLine: numeric("ou_diff_vs_line"),
  /**
   * @type { rule: string, impact: string, direction: string }[]
   */
  rulesTriggered: jsonb("rules_triggered").notNull().default('[]'),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }),
  teamNews: text("team_news"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  source: varchar("source", { length: 20 }).notNull().default('sporttery'),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  businessDate: date("business_date"),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 30 }).notNull(),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  /**
   * @type { time: string, type: string, oldValue: string, newValue: string }[]
   */
  oddsMovements: jsonb("odds_movements").notNull().default('[]'),
  oddsOpenHandicapLine: varchar("odds_open_handicap_line", { length: 10 }),
  oddsOpenTotalLine: varchar("odds_open_total_line", { length: 10 }),
  oddsOpenHomeWin: numeric("odds_open_home_win"),
  oddsOpenAwayWin: numeric("odds_open_away_win"),
  oddsOpenHandicapHome: numeric("odds_open_handicap_home"),
  oddsOpenHandicapAway: numeric("odds_open_handicap_away"),
  oddsOpenTotalOver: numeric("odds_open_total_over"),
  oddsOpenTotalUnder: numeric("odds_open_total_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }).unique(),
  predEngineVersion: varchar("pred_engine_version", { length: 50 }).default('v7.x'),
  predictionAnchor: varchar("prediction_anchor", { length: 20 }),
  /**
   * @type { key: string, label: string, role: string, homeWinProb: number, awayWinProb: number, predictionDirection: string, note?: string }[]
   */
  subModels: jsonb("sub_models").notNull().default('[]'),
  injuryAdjustApplied: numeric("injury_adjust_applied").default('0'),
  injuryAdjustPct: integer("injury_adjust_pct").default(0),
  advancedDataReady: boolean("advanced_data_ready").default(false),
  advancedDataNotice: text("advanced_data_notice"),
  injuryUpdatedAt: customTimestamptz("injury_updated_at", { precision: 3 }),
  /**
   * @type { r44H2h: { spread: number, detail: string } | null, r80Injury: { spread: number, total: number, homeCoreMissing: number, awayCoreMissing: number, detail: string } | null, r81Form: { spread: number, total: number, homeFormScore: number, awayFormScore: number, detail: string } | null, totalSpreadAdjust: number, totalTotalAdjust: number, applied: boolean }
   */
  intelAdjustments: jsonb("intel_adjustments"),
  isOfficialLocked: boolean("is_official_locked").notNull().default(false),
  starRating: varchar("star_rating", { length: 20 }),
  resultPendingReason: varchar("result_pending_reason", { length: 255 }),
  eloHome: numeric("elo_home").default('1500.00'),
  eloAway: numeric("elo_away").default('1500.00'),
  eloGap: numeric("elo_gap").default('0.00'),
  predictionRecalcReason: text("prediction_recalc_reason"),
  predictionRecalcAt: customTimestamptz("prediction_recalc_at", { precision: 3 }),
  predictionSnapshotHandicapLine: numeric("prediction_snapshot_handicap_line"),
  predictionSnapshotTotalLine: numeric("prediction_snapshot_total_line"),
  /**
   * @type { home: RecentGameDetail[], away: RecentGameDetail[], computed_at: string }
   */
  recentFormDetail: jsonb("recent_form_detail"),
  predGeneratedAt: customTimestamptz("pred_generated_at", { precision: 3 }),
  livePeriodEstimated: boolean("live_period_estimated").default(false),
  isPredictionFrozen: boolean("is_prediction_frozen").notNull().default(false),
  /**
   * @type { recommendation: string, pickProb: number, confidence: string, reason: string, updatedBy: string, updatedAt: string, snapshotLine: number }
   */
  handicapOverride: jsonb("handicap_override"),
  /**
   * @type { direction: string, pickProb: number, confidence: string, reason: string, updatedBy: string, updatedAt: string, snapshotLine: number }
   */
  totalOverride: jsonb("total_override"),
  frozenHandicapRec: varchar("frozen_handicap_rec", { length: 50 }),
  frozenTotalDirection: varchar("frozen_total_direction", { length: 50 }),
  frozenPredictionDirection: varchar("frozen_prediction_direction", { length: 50 }),
  frozenConfidence: integer("frozen_confidence"),
  frozenHandicapLine: numeric("frozen_handicap_line"),
  frozenTotalLine: numeric("frozen_total_line"),
  /**
   * @type { at: string, trigger: string, handicapDirection: string, handicapProb: number, handicapLine: number, totalDirection: string, totalProb: number, totalLine: number, confidence: number, engine: string }[]
   */
  predictionHistory: jsonb("prediction_history").notNull().default('[]'),
  predictionLockedUntil: customTimestamptz("prediction_locked_until", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_basketball_matches_match_no").on(table.matchNo),
  index("idx_basketball_matches_match_date").on(table.matchDate),
  uniqueIndex("idx_bball_matches_source_source_id").on(table.source, table.sourceId),
  index("idx_basketball_matches_business_date").on(table.businessDate),
  uniqueIndex("basketball_matches_match_no_business_date_unique").on(table.matchNo, table.businessDate),
  uniqueIndex("idx_basketball_matches_source_match_id_unique").on(table.sourceMatchId),
  index("idx_basketball_pred_locked").on(table.predictionLockedUntil),
]);

export const postFollows = pgTable("post_follows", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  postId: uuid("post_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // Complex index: CREATE UNIQUE INDEX idx_post_follows_user_post ON post_follows USING btree (((user_id).user_id), post_id),
  foreignKey({
    columns: [table.postId],
    foreignColumns: [posts.id],
    name: "post_follows_post_id_fkey",
  }).onDelete("cascade"),
]);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  inviterId: userProfile("inviter_id").notNull(),
  inviteeId: userProfile("invitee_id"),
  inviteCode: varchar("invite_code", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  rewardAmount: numeric("reward_amount").notNull().default('0'),
  rewardType: varchar("reward_type", { length: 20 }).notNull().default('cash'),
  rewardDays: integer("reward_days").notNull().default(0),
  tierType: varchar("tier_type", { length: 20 }),
  inviteeName: varchar("invitee_name", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // Complex index: CREATE INDEX idx_invitations_inviter ON invitations USING btree (((inviter_id).user_id)),
  index("idx_invitations_invite_code").on(table.inviteCode),
]);

export const follows = pgTable("follows", {
  id: uuid("id").primaryKey().defaultRandom(),
  followerId: userProfile("follower_id").notNull(),
  followingId: userProfile("following_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // Complex index: CREATE UNIQUE INDEX idx_follows_unique ON follows USING btree (((follower_id).user_id), ((following_id).user_id)),
]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  matchId: uuid("match_id").notNull(),
  prediction: varchar("prediction", { length: 20 }).notNull(),
  confidence: integer("confidence").notNull().default(50),
  reason: text("reason").notNull(),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  followCount: integer("follow_count").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_posts_match_id").on(table.matchId),
  index("idx_posts_created_at").on(table.createdAt),
]);

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  team: varchar("team", { length: 100 }).notNull(),
  position: varchar("position", { length: 20 }).notNull(),
  nationality: varchar("nationality", { length: 50 }),
  age: integer("age"),
  rating: numeric("rating").notNull().default('6.0'),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  appearances: integer("appearances").notNull().default(0),
  injuryStatus: varchar("injury_status", { length: 20 }).notNull().default('fit'),
  recentRatings: jsonb("recent_ratings").notNull().default('[]'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_players_team").on(table.team),
  index("idx_players_name").on(table.name),
]);

export const paymentSettings = pgTable("payment_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 20 }).notNull().default('hupi'),
  merchantId: varchar("merchant_id", { length: 100 }),
  merchantKey: varchar("merchant_key", { length: 200 }),
  enabled: boolean("enabled").notNull().default(false),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const paymentOrders = pgTable("payment_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  userId: userProfile("user_id"),
  plan: varchar("plan", { length: 20 }).notNull(),
  amount: numeric("amount").notNull().default('0'),
  payMethod: varchar("pay_method", { length: 20 }).notNull().default('wechat'),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  payUrl: text("pay_url"),
  paidAt: customTimestamptz("paid_at", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("payment_orders_order_no_key").on(table.orderNo),
]);

export const followedTeams = pgTable("followed_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  teamName: varchar("team_name", { length: 100 }).notNull(),
  teamLogo: varchar("team_logo", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // Complex index: CREATE UNIQUE INDEX idx_followed_teams_user_team ON followed_teams USING btree (((user_id).user_id), team_name),
]);

export const parlays = pgTable("parlays", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  /**
   * @type { matchId: string, matchNo: string, homeTeam: string, awayTeam: string, betType: string, betOption: string, odds: number }[]
   */
  matches: jsonb("matches").notNull().default('[]'),
  totalOdds: numeric("total_odds").notNull().default('0'),
  confidence: integer("confidence").notNull().default(0),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  comboType: varchar("combo_type", { length: 20 }).default('2串1'),
  hitRate: integer("hit_rate").default(0),
  riskLevel: varchar("risk_level", { length: 20 }).default('balanced'),
  hit: boolean("hit"),
  note: text("note"),
  sportType: varchar("sport_type", { length: 10 }).notNull().default('football'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_parlays_sport_date").on(table.sportType, table.date),
]);

export const h2hRecords = pgTable("h2h_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  homeTeam: varchar("home_team", { length: 100 }).notNull(),
  awayTeam: varchar("away_team", { length: 100 }).notNull(),
  matchDate: date("match_date").notNull(),
  league: varchar("league", { length: 100 }).notNull(),
  homeScore: integer("home_score").notNull().default(0),
  awayScore: integer("away_score").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_h2h_home_away").on(table.homeTeam, table.awayTeam),
  index("idx_h2h_match_date").on(table.matchDate),
]);

export const memberSettings = pgTable("member_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  wechatQrUrl: text("wechat_qr_url"),
  alipayQrUrl: text("alipay_qr_url"),
  customerWechat: varchar("customer_wechat", { length: 100 }),
  monthlyPrice: numeric("monthly_price").default('39'),
  yearlyPrice: numeric("yearly_price").default('299'),
  vipPrice: numeric("vip_price").default('99'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const cardOrders = pgTable("card_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  cardId: uuid("card_id"),
  amount: numeric("amount").default('0'),
  payMethod: varchar("pay_method", { length: 20 }).default('card'),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // Complex index: CREATE INDEX idx_card_orders_user_id ON card_orders USING btree (((user_id).user_id)),
  foreignKey({
    columns: [table.cardId],
    foreignColumns: [cards.id],
    name: "card_orders_card_id_fkey",
  }),
]);

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  cardType: varchar("card_type", { length: 20 }).notNull(),
  days: integer("days").notNull().default(30),
  status: varchar("status", { length: 20 }).notNull().default('unused'),
  usedBy: userProfile("used_by"),
  usedAt: customTimestamptz("used_at", { precision: 6 }),
  amount: numeric("amount").default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("cards_code_key").on(table.code),
  index("idx_cards_code").on(table.code),
  index("idx_cards_status").on(table.status),
]);

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull().unique(),
  level: varchar("level", { length: 20 }).notNull().default('free'),
  expireAt: customTimestamptz("expire_at", { precision: 6 }),
  role: varchar("role", { length: 20 }).notNull().default('user'),
  inviteCode: varchar("invite_code", { length: 20 }).unique(),
  rewardBalance: numeric("reward_balance").notNull().default('0'),
  welcomeGiftGiven: boolean("welcome_gift_given").notNull().default(false),
  invitedBy: varchar("invited_by", { length: 100 }),
  inviteRewardTiers: text("invite_reward_tiers").array().notNull().default([]),
  totalInviteDays: integer("total_invite_days").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("members_user_id_key").on(table.userId),
  // Complex index: CREATE INDEX idx_members_user_id ON members USING btree (((user_id).user_id)),
  index("idx_members_role").on(table.role),
  uniqueIndex("idx_members_invite_code").on(table.inviteCode),
]);

export const modelRuleDetails = pgTable("model_rule_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleCode: varchar("rule_code", { length: 20 }).notNull().unique(),
  ruleName: varchar("rule_name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull().default('基础规则'),
  triggerCondition: text("trigger_condition").notNull(),
  impactFormula: text("impact_formula").notNull(),
  hitRate: numeric("hit_rate").default('0'),
  sampleSize: integer("sample_size").default(0),
  description: text("description").notNull(),
  params: text("params").array().notNull().default([]),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("model_rule_details_rule_code_key").on(table.ruleCode),
  index("idx_rules_category").on(table.category),
  index("idx_rules_code").on(table.ruleCode),
]);

export const oddsRecords = pgTable("odds_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull(),
  bookmaker: varchar("bookmaker", { length: 50 }).default('average'),
  oddsType: varchar("odds_type", { length: 20 }).notNull().default('1x2'),
  homeValue: numeric("home_value"),
  drawValue: numeric("draw_value"),
  awayValue: numeric("away_value"),
  handicapValue: varchar("handicap_value", { length: 10 }).default('0'),
  overValue: numeric("over_value"),
  underValue: numeric("under_value"),
  totalLine: numeric("total_line").default('2.5'),
  snapshotTime: customTimestamptz("snapshot_time", { precision: 6 }).notNull(),
  isInitial: boolean("is_initial").notNull().default(false),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_odds_match_id").on(table.matchId),
  index("idx_odds_snapshot_time").on(table.snapshotTime),
  foreignKey({
    columns: [table.matchId],
    foreignColumns: [matches.id],
    name: "odds_records_match_id_fkey",
  }).onDelete("cascade"),
]);

export const injuries = pgTable("injuries", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id"),
  teamName: varchar("team_name", { length: 100 }).notNull(),
  playerName: varchar("player_name", { length: 100 }).notNull(),
  position: varchar("position", { length: 50 }),
  injuryType: varchar("injury_type", { length: 100 }),
  impactLevel: varchar("impact_level", { length: 20 }).default('medium'),
  expectedReturn: date("expected_return"),
  status: varchar("status", { length: 20 }).default('out'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_injuries_team_id").on(table.teamId),
  index("idx_injuries_team_name").on(table.teamName),
  foreignKey({
    columns: [table.teamId],
    foreignColumns: [teams.id],
    name: "injuries_team_id_fkey",
  }).onDelete("cascade"),
]);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  league: varchar("league", { length: 100 }).notNull(),
  foundedYear: integer("founded_year"),
  stadium: varchar("stadium", { length: 100 }),
  capacity: integer("capacity").default(0),
  rank: integer("rank").default(0),
  homeRecord: varchar("home_record", { length: 50 }),
  awayRecord: varchar("away_record", { length: 50 }),
  avgGoalsFor: numeric("avg_goals_for").default('1.50'),
  avgGoalsAgainst: numeric("avg_goals_against").default('1.00'),
  tacticSystem: varchar("tactic_system", { length: 100 }),
  corePlayers: text("core_players").array().notNull().default([]),
  recentForm: text("recent_form").array().notNull().default([]),
  description: text("description").notNull(),
  logoUrl: varchar("logo_url", { length: 500 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("teams_name_key").on(table.name),
  index("idx_teams_name").on(table.name),
  index("idx_teams_league").on(table.league),
]);

export const predictionRecords = pgTable("prediction_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  matchId: uuid("match_id").notNull(),
  actionType: varchar("action_type", { length: 20 }).notNull(),
  viewedAt: customTimestamptz("viewed_at", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  // Complex index: CREATE INDEX idx_prediction_records_user_id ON prediction_records USING btree (((user_id).user_id)),
  index("idx_prediction_records_match_id").on(table.matchId),
]);

export const favorites = pgTable("favorites", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  matchId: uuid("match_id").notNull(),
  sportType: varchar("sport_type", { length: 20 }).notNull().default('football'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  // Complex index: CREATE INDEX idx_favorites_user_id ON favorites USING btree (((user_id).user_id)),
  index("idx_favorites_match_id").on(table.matchId),
  // Complex index: CREATE UNIQUE INDEX idx_favorites_user_match ON favorites USING btree (((user_id).user_id), match_id),
  index("idx_favorites_user_sport").on(table.userId, table.sportType),
]);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchNo: varchar("match_no", { length: 20 }).notNull(),
  league: varchar("league", { length: 100 }).notNull(),
  homeTeam: varchar("home_team", { length: 100 }).notNull(),
  awayTeam: varchar("away_team", { length: 100 }).notNull(),
  kickoffTime: customTimestamptz("kickoff_time", { precision: 6 }).notNull(),
  homeWinProb: integer("home_win_prob").notNull().default(0),
  drawProb: integer("draw_prob").notNull().default(0),
  awayWinProb: integer("away_win_prob").notNull().default(0),
  predictionDirection: varchar("prediction_direction", { length: 20 }).notNull(),
  handicap: varchar("handicap", { length: 10 }).notNull().default('0'),
  handicapRecommendation: varchar("handicap_recommendation", { length: 50 }).notNull(),
  confidence: integer("confidence").notNull().default(0),
  lowConfidence: boolean("low_confidence").notNull().default(false),
  intel: text("intel").notNull(),
  modelRules: text("model_rules").array().notNull().default([]),
  matchDate: date("match_date").notNull(),
  overUnder: varchar("over_under", { length: 10 }).notNull().default('2.5'),
  overProb: integer("over_prob").notNull().default(50),
  underProb: integer("under_prob").notNull().default(50),
  totalGoals: numeric("total_goals").notNull().default('2.50'),
  mostLikelyScore: varchar("most_likely_score", { length: 50 }).notNull(),
  scoreProbs: text("score_probs").array().notNull().default([]),
  matchStatus: varchar("match_status", { length: 20 }).notNull().default('upcoming'),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  homeForm: text("home_form").array().notNull().default([]),
  awayForm: text("away_form").array().notNull().default([]),
  h2h: text("h2h").array().notNull().default([]),
  oddsOpenHome: numeric("odds_open_home"),
  oddsOpenDraw: numeric("odds_open_draw"),
  oddsOpenAway: numeric("odds_open_away"),
  oddsLiveHome: numeric("odds_live_home"),
  oddsLiveDraw: numeric("odds_live_draw"),
  oddsLiveAway: numeric("odds_live_away"),
  /**
   * @type { goals: string, prob: number }[]
   */
  totalGoalsProb: jsonb("total_goals_prob").default('[]'),
  /**
   * @type { code: string, prob: number }[]
   */
  halfFullProb: jsonb("half_full_prob").default('[]'),
  /**
   * @type { xgHome: number, xgAway: number, xaHome: number, xaAway: number, shotsHome: number, shotsAway: number, shotsOnTargetHome: number, shotsOnTargetAway: number, cornersHome: number, cornersAway: number, possessionHome: number, possessionAway: number, foulsHome: number, foulsAway: number, passAccuracyHome: number, passAccuracyAway: number }
   */
  advancedStats: jsonb("advanced_stats").default('{}'),
  /**
   * @type { weather: { temp: number, condition: string, humidity: number, wind: number }, stadium: { name: string, capacity: number, grass: string }, referee: { name: string, matches: number, avgYellow: number, avgRed: number, penaltyRate: number } }
   */
  environment: jsonb("environment").default('{}'),
  drawConfidence: varchar("draw_confidence", { length: 20 }).default('中'),
  drawFactors: text("draw_factors").array().notNull().default([]),
  handicapWinProb: numeric("handicap_win_prob").default('0'),
  handicapDrawProb: numeric("handicap_draw_prob").default('0'),
  handicapLoseProb: numeric("handicap_lose_prob").default('0'),
  kellyH: numeric("kelly_h").default('0'),
  kellyD: numeric("kelly_d").default('0'),
  kellyA: numeric("kelly_a").default('0'),
  handicapSecondChoice: varchar("handicap_second_choice", { length: 50 }),
  handicapValueRating: varchar("handicap_value_rating", { length: 20 }).default('中价值'),
  /**
   * @type { rule: string, impact: string, direction: string }[]
   */
  rulesTriggered: jsonb("rules_triggered").notNull().default('[]'),
  hitWdw: boolean("hit_wdw"),
  hitHandicap: boolean("hit_handicap"),
  hitOverunder: boolean("hit_overunder"),
  hitGoals: boolean("hit_goals"),
  hitHalffull: boolean("hit_halffull"),
  errorReason: varchar("error_reason", { length: 100 }),
  homeHalfScore: integer("home_half_score"),
  awayHalfScore: integer("away_half_score"),
  handicapType: varchar("handicap_type", { length: 20 }).default('official'),
  homeGoalsAvg: numeric("home_goals_avg").default('0'),
  awayGoalsAvg: numeric("away_goals_avg").default('0'),
  homeConcededAvg: numeric("home_conceded_avg").default('0'),
  awayConcededAvg: numeric("away_conceded_avg").default('0'),
  homeHomeRecord: varchar("home_home_record", { length: 100 }),
  awayAwayRecord: varchar("away_away_record", { length: 100 }),
  homeInjuries: text("home_injuries"),
  awayInjuries: text("away_injuries"),
  tacticsHome: text("tactics_home").notNull(),
  tacticsAway: text("tactics_away").notNull(),
  keyPlayersHome: text("key_players_home").notNull(),
  keyPlayersAway: text("key_players_away").notNull(),
  upsetWarning: text("upset_warning").notNull(),
  teamNews: text("team_news"),
  injuries: text("injuries"),
  mediaConsensus: text("media_consensus"),
  expertPicks: text("expert_picks"),
  keyPlayers: text("key_players"),
  intelUpdatedAt: customTimestamptz("intel_updated_at", { precision: 3 }),
  totalPick: varchar("total_pick", { length: 10 }),
  totalPickProb: integer("total_pick_prob").default(50),
  source: varchar("source", { length: 20 }).notNull().default('sporttery'),
  sourceId: varchar("source_id", { length: 100 }),
  sourceLeagueCode: varchar("source_league_code", { length: 20 }),
  livePeriod: integer("live_period"),
  liveClock: varchar("live_clock", { length: 20 }),
  lastScoreAt: customTimestamptz("last_score_at", { precision: 3 }),
  liveScoreSource: varchar("live_score_source", { length: 20 }).notNull(),
  lastDataSyncAt: customTimestamptz("last_data_sync_at", { precision: 6 }),
  lastOddsUpdateAt: customTimestamptz("last_odds_update_at", { precision: 6 }),
  /**
   * @type { time: string, type: string, oldValue: string, newValue: string }[]
   */
  oddsMovements: jsonb("odds_movements").notNull().default('[]'),
  businessDate: date("business_date"),
  handicapOddsHome: numeric("handicap_odds_home"),
  handicapOddsDraw: numeric("handicap_odds_draw"),
  handicapOddsAway: numeric("handicap_odds_away"),
  totalOddsOver: numeric("total_odds_over"),
  totalOddsUnder: numeric("total_odds_under"),
  sourceMatchId: varchar("source_match_id", { length: 30 }).unique(),
  isOfficialLocked: boolean("is_official_locked").notNull().default(false),
  resultPendingReason: varchar("result_pending_reason", { length: 255 }),
  eloHome: numeric("elo_home").default('1500.00'),
  eloAway: numeric("elo_away").default('1500.00'),
  eloGap: numeric("elo_gap").default('0.00'),
  /**
   * @type { home: { athleteName: string, status: string, date: string | null, type: string | null }[], away: { athleteName: string, status: string, date: string | null, type: string | null }[], source?: string, fetchedAt?: string }
   */
  injuriesJson: jsonb("injuries_json"),
  predEngineVersion: varchar("pred_engine_version", { length: 50 }),
  handicapConfidence: varchar("handicap_confidence", { length: 20 }).notNull().default('低'),
  ouConfidence: varchar("ou_confidence", { length: 20 }).notNull().default('低'),
  predGeneratedAt: customTimestamptz("pred_generated_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_matches_match_date").on(table.matchDate),
  index("idx_matches_match_no").on(table.matchNo),
  uniqueIndex("idx_matches_source_source_id").on(table.source, table.sourceId),
  index("idx_matches_business_date").on(table.businessDate),
  uniqueIndex("matches_match_no_business_date_unique").on(table.matchNo, table.businessDate),
  uniqueIndex("idx_matches_source_match_id_unique").on(table.sourceMatchId),
  index("idx_matches_home_away_kickoff").on(table.homeTeam, table.awayTeam, table.kickoffTime),
  uniqueIndex("matches_match_no_match_date_idx").on(table.matchNo, table.matchDate),
]);

// table aliases
export const adminAuditLogsTable = adminAuditLogs;
export const aiChatConversationsTable = aiChatConversations;
export const aiChatMessagesTable = aiChatMessages;
export const aiMatchReportsTable = aiMatchReports;
export const appSettingsTable = appSettings;
export const backtestResultsTable = backtestResults;
export const bakBasketballExpiredUpcoming20261015Table = bakBasketballExpiredUpcoming20261015;
export const bakBasketballFinished20261015Table = bakBasketballFinished20261015;
export const bakMatchesExpiredUpcoming20261015Table = bakMatchesExpiredUpcoming20261015;
export const bakMatchesFinished20261015Table = bakMatchesFinished20261015;
export const basketballMatchesTable = basketballMatches;
export const basketballMatchesBackup20261030BeforeFinalFlipTable = basketballMatchesBackup20261030BeforeFinalFlip;
export const basketballMatchesBackup20261030HomeawayTable = basketballMatchesBackup20261030Homeaway;
export const basketballMatchesBackup20261030HomeawayFixTable = basketballMatchesBackup20261030HomeawayFix;
export const basketballOddsSnapshotsTable = basketballOddsSnapshots;
export const cardOrdersTable = cardOrders;
export const cardsTable = cards;
export const dailyReviewTable = dailyReview;
export const dataSnapshotsTable = dataSnapshots;
export const favoritesTable = favorites;
export const followedTeamsTable = followedTeams;
export const followsTable = follows;
export const h2hRecordsTable = h2hRecords;
export const injuriesTable = injuries;
export const injuryReportsTable = injuryReports;
export const invitationsTable = invitations;
export const matchAutoCheckReportsTable = matchAutoCheckReports;
export const matchesTable = matches;
export const memberSettingsTable = memberSettings;
export const membersTable = members;
export const modelRuleDetailsTable = modelRuleDetails;
export const modelRuleDetailsBackup20261020Table = modelRuleDetailsBackup20261020;
export const oddsRecordsTable = oddsRecords;
export const oddsSnapshotsTable = oddsSnapshots;
export const parlaysTable = parlays;
export const paymentOrdersTable = paymentOrders;
export const paymentSettingsTable = paymentSettings;
export const playersTable = players;
export const postFollowsTable = postFollows;
export const postsTable = posts;
export const predictionRecordsTable = predictionRecords;
export const ruleDisabledTable = ruleDisabled;
export const scoreSentinelLogsTable = scoreSentinelLogs;
export const snapshotBballPredPreIntelTable = snapshotBballPredPreIntel;
export const supportMessagesTable = supportMessages;
export const supportTicketsTable = supportTickets;
export const syncTaskLogsTable = syncTaskLogs;
export const teamAliasTable = teamAlias;
export const teamSeasonStatsTable = teamSeasonStats;
export const teamsTable = teams;
export const teamsEloTable = teamsElo;
export const userDataTable = userData;
export const usersTable = users;
