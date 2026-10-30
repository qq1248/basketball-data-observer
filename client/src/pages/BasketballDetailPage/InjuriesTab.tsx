import type { BasketballMatchItem, BasketballKeyPlayer, InjuryReport } from '@shared/api.interface';
import { AlertTriangle } from 'lucide-react';
import { isPlaceholder } from '@client/src/utils/data-quality';

interface InjuriesTabProps {
  match: BasketballMatchItem;
  injuryReports: InjuryReport[];
  injurySummary: { homeHigh: number; homeMedium: number; awayHigh: number; awayMedium: number } | null;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  out: { label: '缺阵', className: 'text-miss-text bg-miss-bg border-miss-bg' },
  'out for season': { label: '赛季报销', className: 'text-miss-text bg-miss-bg border-miss-bg' },
  doubtful: { label: '存疑', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/20' },
  questionable: { label: '出战成疑', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/20' },
  probable: { label: '大概率出战', className: 'text-success bg-hit-bg border-hit-bg' },
  day_to_day: { label: '每日观察', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/20' },
  'day-to-day': { label: '每日观察', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/20' },
  缺阵: { label: '缺阵', className: 'text-miss-text bg-miss-bg border-miss-bg' },
  赛季报销: { label: '赛季报销', className: 'text-miss-text bg-miss-bg border-miss-bg' },
  出战成疑: { label: '出战成疑', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/20' },
  存疑: { label: '存疑', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/20' },
  赛前决定: { label: '赛前决定', className: 'text-draw-text bg-draw-bg border-draw-bg' },
};

const IMPACT_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: '高影响', className: 'text-miss-text bg-miss-bg/30 border-miss-text/30' },
  medium: { label: '中影响', className: 'text-basketball-orange bg-basketball-orange/10 border-basketball-orange/30' },
  low: { label: '低影响', className: 'text-muted-foreground bg-muted border-border' },
};

const DEFAULT_STATUS = { label: '', className: 'bg-muted text-muted-foreground border-border' };

function getStatusStyle(status: string | undefined | null): { label: string; className: string } {
  if (!status) return DEFAULT_STATUS;
  const s = String(status).trim().toLowerCase();
  const found = STATUS_STYLES[s];
  if (found) return found;
  return { label: String(status).trim(), className: 'bg-muted text-muted-foreground border-border' };
}

function getImpactStyle(impact: string): { label: string; className: string } {
  return IMPACT_STYLES[impact] || IMPACT_STYLES.low;
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl p-6 border border-border bg-card shadow-sm text-center">
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  );
}

function DataSourceLabel({ source }: { source: string }) {
  return (
    <span className="text-[10px] uppercase tracking-widest text-gray-400 ml-auto">
      数据来源：{source}
    </span>
  );
}

function isNBAOrWNBA(league?: string | null): boolean {
  if (!league) return false;
  const lower = league.toLowerCase();
  return lower.includes('nba') || lower.includes('wnba');
}

function isACB(league?: string | null): boolean {
  if (!league) return false;
  const lower = league.toLowerCase();
  return lower.includes('acb') || lower.includes('西篮联') || lower.includes('西班牙') || lower.includes('liga endesa');
}

function isBBL(league?: string | null): boolean {
  if (!league) return false;
  const lower = league.toLowerCase();
  return (
    lower.includes('bbl') ||
    lower.includes('德篮联') ||
    lower.includes('德国篮球') ||
    lower.includes('german') ||
    lower.includes('bundesliga')
  );
}

interface InjuriesJsonMeta {
  source: string | null;
  status: string | null;
}

function extractInjuriesMeta(value: unknown): InjuriesJsonMeta {
  if (!value) return { source: null, status: null };
  let parsed: Record<string, unknown> | null = null;
  if (typeof value === 'object') {
    parsed = value as Record<string, unknown>;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('{')) return { source: null, status: null };
    try { parsed = JSON.parse(trimmed); } catch { return { source: null, status: null }; }
  } else {
    return { source: null, status: null };
  }
  return {
    source: typeof parsed.source === 'string' ? parsed.source : null,
    status: typeof parsed.status === 'string' ? parsed.status : null,
  };
}

function InjuryReportList({ injuries }: { injuries: InjuryReport[] }) {
  if (injuries.length === 0) {
    return <p className="text-xs text-[var(--muted-foreground)] md:text-gray-400">暂无伤停数据</p>;
  }
  return (
    <div className="space-y-2">
      {injuries.map((inj) => {
        const statusStyle = getStatusStyle(inj.status);
        const impactStyle = getImpactStyle(inj.impactRating);
        return (
          <div
            key={inj.id}
            className="p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
          >
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
              <span className="text-sm font-medium text-[var(--foreground)] md:inherit">{inj.playerName}</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${impactStyle.className}`}
                >
                  {impactStyle.label}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${statusStyle.className}`}
                >
                  {statusStyle.label || inj.status}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] md:text-muted-foreground flex-wrap">
              {inj.position && <span className="font-mono">{inj.position}</span>}
              {inj.injuryType && (
                <>
                  <span className="text-[var(--muted-foreground)]/30 md:text-muted-foreground/30">·</span>
                  <span>{inj.injuryType}</span>
                </>
              )}
            </div>
            {inj.shortComment && (
              <p className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-2 leading-relaxed">{inj.shortComment}</p>
            )}
            {inj.expectedReturn && (
              <p className="text-[10px] text-[var(--muted-foreground)] md:text-gray-400 mt-1.5">预计复出：{inj.expectedReturn}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KeyPlayerList({ players }: { players: BasketballKeyPlayer[] }) {
  const list = (Array.isArray(players) ? players : []) as unknown as Record<string, unknown>[];

  const fmt = (v: unknown): string => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    if (!Number.isFinite(n) || n <= 0) return '—';
    return n.toFixed(1);
  };

  const toNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  };

  const getBadges = (): Map<number, string[]> => {
    const map = new Map<number, string[]>();
    if (list.length === 0) return map;
    let maxPpg = -1, maxRpg = -1, maxApg = -1;
    for (const p of list) {
      const ppg = toNum(p.ppg);
      const rpg = toNum(p.rpg);
      const apg = toNum(p.apg);
      if (ppg > maxPpg) maxPpg = ppg;
      if (rpg > maxRpg) maxRpg = rpg;
      if (apg > maxApg) maxApg = apg;
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const badges: string[] = [];
      const ppg = toNum(p.ppg);
      const rpg = toNum(p.rpg);
      const apg = toNum(p.apg);
      if (ppg > 0 && ppg === maxPpg) badges.push('得分王');
      if (rpg > 0 && rpg === maxRpg) badges.push('篮板王');
      if (apg > 0 && apg === maxApg) badges.push('助攻王');
      map.set(i, badges);
    }
    return map;
  };

  const badges = getBadges();

  return (
    <div className="space-y-2">
      {list.map((p, i) => {
        const pBadges = badges.get(i) || [];
        return (
          <div key={i} className="p-2.5 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)] md:border-border md:bg-background/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-[var(--foreground)] md:inherit">{String(p.name || '')}</span>
              <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground font-mono">
                #{String(p.jersey || p.number || '—')}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--foreground)] md:inherit">
              <span>
                <span className="text-[var(--muted-foreground)] md:text-muted-foreground/70">得分</span>{' '}
                <span className="font-mono text-[var(--foreground)]/80 md:text-foreground/80">{fmt(p.ppg)}</span>
              </span>
              <span>
                <span className="text-[var(--muted-foreground)] md:text-muted-foreground/70">篮板</span>{' '}
                <span className="font-mono text-[var(--foreground)]/80 md:text-foreground/80">{fmt(p.rpg)}</span>
              </span>
              <span>
                <span className="text-[var(--muted-foreground)] md:text-muted-foreground/70">助攻</span>{' '}
                <span className="font-mono text-[var(--foreground)]/80 md:text-foreground/80">{fmt(p.apg)}</span>
              </span>
            </div>
            {pBadges.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {pBadges.map((b) => (
                  <span
                    key={b}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 md:bg-nebula-crimson/10 md:text-nebula-crimson font-medium"
                  >
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getCorePlayerOutCount(
  injuryReports: InjuryReport[],
  keyPlayers: BasketballKeyPlayer[],
): number {
  if (!keyPlayers || keyPlayers.length === 0) return 0;
  if (!injuryReports || injuryReports.length === 0) return 0;
  const coreNames = keyPlayers.map((p) => p.name.trim().toLowerCase());
  const outSet = new Set<string>();
  for (const inj of injuryReports) {
    if (inj.impactRating !== 'high' && inj.impactRating !== 'medium') continue;
    const injName = inj.playerName.trim().toLowerCase();
    for (const name of coreNames) {
      if (name.length > 1 && (injName.includes(name) || name.includes(injName))) {
        outSet.add(name);
        break;
      }
    }
  }
  return outSet.size;
}

function calcLineupCompleteness(highCount: number, mediumCount: number): number {
  const deduction = highCount * 10 + mediumCount * 5;
  return Math.max(40, 100 - deduction);
}

function getInjuryDataSource(reports: InjuryReport[]): string | null {
  if (reports.length === 0) return null;
  const sources = new Set(reports.map((r) => r.dataSource));
  const names: string[] = [];
  if (sources.has('espn')) names.push('ESPN');
  if (sources.has('sporttery')) names.push('竞彩官方');
  if (sources.has('qiumibao')) names.push('球美宝');
  if (names.length === 0) return reports[0].dataSource;
  return names.join(' / ');
}

export default function InjuriesTab({ match, injuryReports, injurySummary }: InjuriesTabProps) {
  const homeReports = injuryReports.filter((r) => r.teamSide === 'home');
  const awayReports = injuryReports.filter((r) => r.teamSide === 'away');
  const homeKeyPlayers = match.homeKeyPlayers ?? [];
  const awayKeyPlayers = match.awayKeyPlayers ?? [];

  const hasInjuries = homeReports.length > 0 || awayReports.length > 0;
  const hasKeyPlayers = homeKeyPlayers.length > 0 || awayKeyPlayers.length > 0;
  const hasData = hasInjuries || hasKeyPlayers;

  const injuriesMeta = extractInjuriesMeta(match.injuries);
  const isInjuriesClean = injuriesMeta.source === 'ESPN' && injuriesMeta.status === 'clean';

  const homeHigh = injurySummary?.homeHigh ?? homeReports.filter((r) => r.impactRating === 'high').length;
  const homeMedium = injurySummary?.homeMedium ?? homeReports.filter((r) => r.impactRating === 'medium').length;
  const awayHigh = injurySummary?.awayHigh ?? awayReports.filter((r) => r.impactRating === 'high').length;
  const awayMedium = injurySummary?.awayMedium ?? awayReports.filter((r) => r.impactRating === 'medium').length;

  const homeLineupPct = calcLineupCompleteness(homeHigh, homeMedium);
  const awayLineupPct = calcLineupCompleteness(awayHigh, awayMedium);
  const homeCoreOut = getCorePlayerOutCount(homeReports, homeKeyPlayers);
  const awayCoreOut = getCorePlayerOutCount(awayReports, awayKeyPlayers);
  const injurySource = getInjuryDataSource(injuryReports);

  const r80 = match.intelAdjustments?.r80Injury;
  const hasR80 = !!r80 && (
    r80.spread !== undefined && r80.spread !== 0 ||
    r80.total !== undefined && r80.total !== 0 ||
    r80.homeCoreMissing > 0 ||
    r80.awayCoreMissing > 0
  );
  const rInjuryRules = (match.modelRules || []).filter((r: string) => r.startsWith('R-INJURY'));
  const hasAnyAdjustData = hasR80 || rInjuryRules.length > 0;

  return (
    <div className="space-y-3">
      {/* 伤停调整参考 */}
      {hasAnyAdjustData && (
        <div className="rounded-xl p-4 border border-blue-500/30 bg-blue-500/[0.05] md:border-nebula-crimson/30 md:bg-nebula-crimson/[0.03] shadow-sm">
          <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-nebula-crimson" />
            伤停调整参考
            {match.isOfficialLocked && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 ml-auto font-medium">
                参考值·不改变锁定预测
              </span>
            )}
          </div>

          {hasR80 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--card)] border border-[var(--border)] bg-[var(--card)] md:bg-card md:border-border">
                  <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1">让分调整</div>
                  <div className={`text-xl font-black font-mono ${r80.spread > 0 ? 'text-home-win' : r80.spread < 0 ? 'text-away-win' : 'text-muted-foreground'}`}>
                    {r80.spread > 0 ? '+' : ''}{r80.spread.toFixed(1)} 分
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {r80.spread > 0 ? '主强方向上调' : r80.spread < 0 ? '客强方向下调' : '无调整'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--card)] border border-[var(--border)] bg-[var(--card)] md:bg-card md:border-border">
                  <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1">大小分调整</div>
                  <div className={`text-xl font-black font-mono ${r80.total > 0 ? 'text-basketball-orange' : r80.total < 0 ? 'text-away-win' : 'text-muted-foreground'}`}>
                    {r80.total > 0 ? '+' : ''}{r80.total.toFixed(1)} 分
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">
                    {r80.total > 0 ? '偏大上调' : r80.total < 0 ? '偏小下调' : '无调整'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-home-win/10 border border-home-win/20">
                  <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{match.homeTeam} 核心缺阵</div>
                  <div className="text-xl font-black font-mono text-home-win">
                    {r80.homeCoreMissing} 人
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-away-win/10 border border-away-win/20">
                  <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{match.awayTeam} 核心缺阵</div>
                  <div className="text-xl font-black font-mono text-away-win">
                    {r80.awayCoreMissing} 人
                  </div>
                </div>
              </div>

              {r80.detail && (
                <p className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground leading-relaxed px-1">
                  <span className="text-[var(--muted-foreground)] md:text-muted-foreground/60">详情：</span>{r80.detail}
                </p>
              )}

              {r80.injuryRules && r80.injuryRules.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {r80.injuryRules.map((rule: string) => (
                    <span
                      key={rule}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium border border-blue-400/30 md:bg-nebula-crimson/10 md:text-nebula-crimson md:border-nebula-crimson/20"
                    >
                      {rule}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasR80 && rInjuryRules.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
                模型触发伤停相关规则，但未达到独立调整阈值
              </p>
              <div className="flex flex-wrap gap-1.5">
                {rInjuryRules.map((rule: string) => (
                  <span
                    key={rule}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-nebula-crimson/10 text-nebula-crimson font-medium border border-nebula-crimson/20"
                  >
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          )}

          {match.injuryAdjustApplied !== undefined && match.injuryAdjustApplied !== 0 && (
            <p className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground/60 mt-3 pt-2 border-t border-[var(--border)]/60 md:border-border/60 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              融合调整让分 {match.injuryAdjustApplied > 0 ? '+' : ''}{match.injuryAdjustApplied.toFixed(1)} 分
              {match.injuryAdjustPct ? `（影响面 ${match.injuryAdjustPct}%）` : ''}
              {match.isOfficialLocked ? '，冻结场仅参考，未写入预测' : ''}
            </p>
          )}
        </div>
      )}

      {/* 阵容完整度 */}
      {hasData && (
        <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
          <div className="text-sm font-semibold mb-4 text-[var(--foreground)] md:text-foreground flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-nebula-crimson" />
            阵容完整度参考
            {injurySource && <DataSourceLabel source={injurySource} />}
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-[var(--foreground)]/80 md:text-foreground/80">{match.homeTeam}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                    核心缺阵 <span className="font-mono text-miss-text font-semibold">{homeCoreOut}</span>人
                  </span>
                  <span className="text-sm font-black font-mono text-blue-400 md:text-nebula-crimson">
                    {homeLineupPct}%
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden bg-blue-500/10 md:bg-muted">
                <div
                  className="h-full rounded-full progress-gradient transition-all duration-[1.5s] ease-out"
                  style={{ width: `${homeLineupPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                <span>高影响 {homeHigh} 人</span>
                <span>中影响 {homeMedium} 人</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-[var(--foreground)]/80 md:text-foreground/80">{match.awayTeam}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                    核心缺阵 <span className="font-mono text-miss-text font-semibold">{awayCoreOut}</span>人
                  </span>
                  <span className="text-sm font-black font-mono text-blue-400 md:text-nebula-crimson">
                    {awayLineupPct}%
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden bg-blue-500/10 md:bg-muted">
                <div
                  className="h-full rounded-full progress-gradient transition-all duration-[1.5s] ease-out"
                  style={{ width: `${awayLineupPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                <span>高影响 {awayHigh} 人</span>
                <span>中影响 {awayMedium} 人</span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground/60 mt-3 text-center">
            * 仅供模型参考，按伤停影响评级估算，不代表真实出战状态
          </p>
        </div>
      )}

      {/* 伤病名单 */}
      {hasInjuries ? (
        <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
          <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-red-400 md:bg-miss-text" />
            结构化伤停报告
            {injurySource && <DataSourceLabel source={injurySource} />}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-home-win font-semibold mb-2">
                {match.homeTeam}
                <span className="text-[var(--muted-foreground)] md:text-muted-foreground font-normal ml-2">
                  {homeReports.length}人
                </span>
              </div>
              <InjuryReportList injuries={homeReports} />
            </div>
            <div>
              <div className="text-xs text-away-win font-semibold mb-2">
                {match.awayTeam}
                <span className="text-[var(--muted-foreground)] md:text-muted-foreground font-normal ml-2">
                  {awayReports.length}人
                </span>
              </div>
              <InjuryReportList injuries={awayReports} />
            </div>
          </div>
        </div>
      ) : hasKeyPlayers && (isACB(match.league) || isBBL(match.league)) ? (
        <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
          <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-red-400 md:bg-miss-text" />
            结构化伤停报告
          </div>
          <p className="text-xs text-[var(--muted-foreground)] md:text-gray-400 text-center py-4">
            {isACB(match.league)
              ? 'ACB 官方伤停数据暂不可用'
              : '该联赛暂无伤停数据源'}
          </p>
        </div>
      ) : null}

      {/* 核心球员 */}
      {hasKeyPlayers ? (
        <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
          <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
            核心球员
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-home-win font-semibold mb-2">{match.homeTeam}</div>
              {homeKeyPlayers.length > 0 ? (
                <KeyPlayerList players={homeKeyPlayers} />
              ) : (
                <p className="text-xs text-[var(--muted-foreground)] md:text-gray-400">暂无数据</p>
              )}
            </div>
            <div>
              <div className="text-xs text-away-win font-semibold mb-2">{match.awayTeam}</div>
              {awayKeyPlayers.length > 0 ? (
                <KeyPlayerList players={awayKeyPlayers} />
              ) : (
                <p className="text-xs text-[var(--muted-foreground)] md:text-gray-400">暂无数据</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!hasInjuries && !hasKeyPlayers && (
        <EmptyCard
          text={
            isInjuriesClean
              ? '本场两队均无伤停报告（ESPN 核实）'
              : isACB(match.league)
                ? 'ACB 官方伤停数据暂不可用'
                : isBBL(match.league)
                  ? '该联赛暂无伤停数据源'
                  : isNBAOrWNBA(match.league)
                    ? '暂无伤情情报，伤停数据持续补全中'
                    : '暂无数据'
          }
        />
      )}
    </div>
  );
}
