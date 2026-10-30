/**
 * Server-only secrets & private keys.
 *
 * SERVER-ONLY — MUST NOT be imported from client-side code.
 * This module is resolved only on the server side (NestJS runtime).
 * Vite has no @server alias, so client builds can never pull this in.
 *
 * Resolution order (first present wins):
 *   1. process.env.ODDS_API_KEY  (runtime / deploy-time env var)
 *   2. built-in default           (server-only private fallback)
 *   3. empty string               (feature disabled)
 *
 * .env.local is loaded in non-production environments for local dev.
 * In production, secrets come from either runtime env vars or the
 * built-in default defined below — never from .env.local.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_ODDS_API_KEY = '';
const DEFAULT_SYNC_API_TOKEN = 'f43ff16129793f5bdd3109af35d0d4bd5826dbec342e1a2af31166d5cd5e90b5';
const DEFAULT_THERUNDOWN_KEY = '';
const DEFAULT_APISPORTS_KEY = '';

function loadEnvLocal(): void {
  if (process.env.NODE_ENV === 'production') return;
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

function resolveOddsApiKey(): string {
  const envVal = process.env.ODDS_API_KEY;
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal;
  }
  return DEFAULT_ODDS_API_KEY;
}

function resolveSyncApiToken(): string {
  const envVal = process.env.SYNC_API_TOKEN;
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal;
  }
  return DEFAULT_SYNC_API_TOKEN;
}

function resolveTheRundownKey(): string {
  const envVal = process.env.THERUNDOWN_KEY;
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal;
  }
  return DEFAULT_THERUNDOWN_KEY;
}

function resolveApiSportsKey(): string {
  const envVal = process.env.APISPORTS_KEY;
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal;
  }
  return DEFAULT_APISPORTS_KEY;
}

function resolveFootballDataOrgKey(): string {
  const envVal = process.env.FOOTBALL_DATA_ORG_KEY;
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal;
  }
  return '';
}

function resolveBeidanEnabled(): boolean {
  const envVal = process.env.BEIDAN_ENABLED;
  if (typeof envVal === 'string') {
    const lower = envVal.toLowerCase();
    if (lower === '0' || lower === 'false' || lower === 'off') return false;
    return true;
  }
  return true;
}

export const serverSecrets = {
  /** The Odds API key — server-only, never returned by any API. */
  oddsApiKey: resolveOddsApiKey(),

  /** External sync write token — server-only; empty disables writes. */
  syncApiToken: resolveSyncApiToken(),

  /** TheRundown API key — server-only; empty disables the source. */
  theRundownKey: resolveTheRundownKey(),

  /** API-FOOTBALL / API-BASKETBALL (api-sports.io) key — server-only; empty disables the source. */
  apiSportsKey: resolveApiSportsKey(),

  /** football-data.org API key — server-only; empty disables the source. */
  footballDataOrgKey: resolveFootballDataOrgKey(),

  /** 北京北单数据源是否启用 — 默认开启，显式设置 BEIDAN_ENABLED=false/0/off 时关闭。 */
  beidanEnabled: resolveBeidanEnabled(),
} as const;

export function isOddsApiEnabled(): boolean {
  return typeof serverSecrets.oddsApiKey === 'string'
    && serverSecrets.oddsApiKey.length > 0;
}

export function getOddsApiKeyMasked(): string {
  const key = serverSecrets.oddsApiKey;
  if (!key) return '';
  return `****${key.slice(-4)}`;
}

export function getSyncApiTokenMasked(): string {
  const token = serverSecrets.syncApiToken;
  if (!token) return '';
  return `****${token.slice(-4)}`;
}

export function isApiSportsEnabled(): boolean {
  return typeof serverSecrets.apiSportsKey === 'string'
    && serverSecrets.apiSportsKey.length > 0;
}

export function getApiSportsKeyMasked(): string {
  const key = serverSecrets.apiSportsKey;
  if (!key) return '';
  return `****${key.slice(-4)}`;
}

export function isBeidanEnabled(): boolean {
  return serverSecrets.beidanEnabled === true;
}
