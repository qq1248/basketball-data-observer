const TEAM_ALIASES: Record<string, string> = {
  达拉斯飞翼: '达拉斯Wings',
  达拉斯飞马: '达拉斯Wings',
  凤凰城水星: '菲尼克斯水星',
  菲尼克斯水星: '菲尼克斯水星',
  凤凰城太阳: '菲尼克斯太阳',
  菲尼克斯太阳: '菲尼克斯太阳',
};

function normalizeTeamName(name: string): string {
  const alias = TEAM_ALIASES[name.trim()];
  const base = alias ?? name;
  return base
    .toLowerCase()
    .replace(/[\s\-._·]/g, '')
    .replace(/\bfc\b|\bafc\b|\bsc\b|\bcf\b|\bifk\b|\bff\b|\bbk\b|\bsk\b/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

interface MatchLike {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  source?: string;
  homeWinOdds?: number | null;
  awayWinOdds?: number | null;
  handicapLineNum?: number | null;
  totalLineNum?: number | null;
  confidence?: number;
}

const SOURCE_PRIORITY: Record<string, number> = {
  sporttery: 100,
  espn: 80,
  qiumei: 30,
  qiumibao: 30,
};

function sourceQualityScore(m: MatchLike): number {
  let score = SOURCE_PRIORITY[m.source || ''] ?? 10;
  if (m.homeWinOdds && m.homeWinOdds > 0) score += 5;
  if (m.handicapLineNum && m.handicapLineNum !== 0) score += 5;
  if (m.totalLineNum && m.totalLineNum > 0) score += 5;
  if (m.confidence && m.confidence > 0) score += 3;
  return score;
}

export function dedupMatches<T extends MatchLike>(matches: T[]): T[] {
  const WINDOW_MS = 12 * 3600 * 1000;
  const result: T[] = [];
  const used = new Set<string>();

  for (let i = 0; i < matches.length; i++) {
    if (used.has(matches[i].id)) continue;
    const m = matches[i];
    const homeNorm = normalizeTeamName(m.homeTeam);
    const awayNorm = normalizeTeamName(m.awayTeam);
    const kickoff = new Date(m.kickoffTime).getTime();

    // Collect all duplicates (including the current one)
    const group: T[] = [m];
    for (let j = i + 1; j < matches.length; j++) {
      if (used.has(matches[j].id)) continue;
      const other = matches[j];
      const oHomeNorm = normalizeTeamName(other.homeTeam);
      const oAwayNorm = normalizeTeamName(other.awayTeam);
      const oKickoff = new Date(other.kickoffTime).getTime();
      if (Math.abs(oKickoff - kickoff) > WINDOW_MS) continue;
      const sameTeams =
        (homeNorm === oHomeNorm && awayNorm === oAwayNorm) ||
        (homeNorm === oAwayNorm && awayNorm === oHomeNorm);
      if (!sameTeams) continue;
      group.push(other);
    }

    // Pick the highest quality match from the group
    let best = group[0];
    let bestIsReversed = false;
    for (let k = 1; k < group.length; k++) {
      if (sourceQualityScore(group[k]) > sourceQualityScore(best)) {
        best = group[k];
        const oHomeNorm = normalizeTeamName(best.homeTeam);
        const oAwayNorm = normalizeTeamName(best.awayTeam);
        bestIsReversed = homeNorm === oAwayNorm && awayNorm === oHomeNorm;
      }
    }

    // 如果最优记录是通过主客倒置匹配的，翻转主客队名和比分
    if (bestIsReversed) {
      const reversed: T = {
        ...best,
        homeTeam: best.awayTeam,
        awayTeam: best.homeTeam,
        homeScore: (best as unknown as { awayScore?: number | null }).awayScore ?? null,
        awayScore: (best as unknown as { homeScore?: number | null }).homeScore ?? null,
      } as T;
      result.push(reversed);
    } else {
      result.push(best);
    }
    // Mark all duplicates in this group as used
    for (const item of group) {
      used.add(item.id);
    }
  }
  return result;
}
