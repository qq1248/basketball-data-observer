import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import type { BasketballMatchItem } from '@shared/api.interface';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';

interface StructuredInjury {
  playerName: string;
  status: string;
  shortComment: string;
  longComment?: string;
  date?: string | null;
  source?: string;
}

function parseInjuries(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const v of value) {
      if (typeof v === 'string' && v.trim()) {
        result.push(v);
      } else if (v && typeof v === 'object') {
        const line = formatInjury(v as StructuredInjury);
        if (line) result.push(line);
      }
    }
    return result;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
        if (parsed && typeof parsed === 'object') {
          const result: string[] = [];
          const home = (parsed as Record<string, unknown>).home;
          const away = (parsed as Record<string, unknown>).away;
          if (Array.isArray(home)) {
            for (const item of home) {
              if (typeof item === 'string') {
                if (item.trim()) result.push(item);
              } else if (item && typeof item === 'object') {
                const inj = item as StructuredInjury;
                const line = formatInjury(inj);
                if (line) result.push(line);
              }
            }
          }
          if (Array.isArray(away)) {
            for (const item of away) {
              if (typeof item === 'string') {
                if (item.trim()) result.push(item);
              } else if (item && typeof item === 'object') {
                const inj = item as StructuredInjury;
                const line = formatInjury(inj);
                if (line) result.push(line);
              }
            }
          }
          return result;
        }
      } catch {
        // fall through to raw string
      }
    }
    return [trimmed];
  }
  return [];
}

function formatInjury(inj: StructuredInjury): string {
  if (!inj.playerName) return '';
  const status = inj.status ? `【${inj.status}】` : '';
  const comment = inj.shortComment || inj.longComment || '';
  return `${inj.playerName} ${status}${comment}`.trim();
}

function parseTeamInjuries(value: unknown, team: 'home' | 'away'): string[] {
  if (!value) return [];
  let parsed: Record<string, unknown> | null = null;
  if (typeof value === 'object') {
    parsed = value as Record<string, unknown>;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('{')) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  } else {
    return [];
  }
  const teamArr = parsed[team];
  if (!Array.isArray(teamArr)) return [];
  const result: string[] = [];
  for (const item of teamArr) {
    if (typeof item === 'string') {
      if (item.trim()) result.push(item);
    } else if (item && typeof item === 'object') {
      const inj = item as StructuredInjury;
      const line = formatInjury(inj);
      if (line) result.push(line);
    }
  }
  return result;
}

function extractInjurySource(value: unknown): string | null {
  if (!value) return null;
  let parsed: Record<string, unknown> | null = null;
  if (typeof value === 'object') {
    parsed = value as Record<string, unknown>;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
  } else {
    return null;
  }
  const src = parsed.source;
  return typeof src === 'string' ? src : null;
}

function extractInjuryFetchedAt(value: unknown): string | null {
  if (!value) return null;
  let parsed: Record<string, unknown> | null = null;
  if (typeof value === 'object') {
    parsed = value as Record<string, unknown>;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
  } else {
    return null;
  }
  const fetchedAt = parsed.fetchedAt;
  if (typeof fetchedAt === 'string') return fetchedAt;
  return null;
}

interface MediaOpinionItem {
  source?: string;
  view?: string;
  credibility?: string;
}

function isMediaOpinionArray(value: unknown): value is MediaOpinionItem[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => typeof item === 'object' && item !== null);
}

function getCredibilityBadgeClass(level: string): string {
  const l = level.trim();
  if (l === '高') return 'bg-green-500/20 text-green-400 border-green-400/30 md:bg-green-500/15 md:text-green-500 md:border-green-500/30';
  if (l === '中') return 'bg-amber-500/20 text-amber-400 border-amber-400/30 md:bg-amber-500/15 md:text-amber-500 md:border-amber-500/30';
  return 'bg-blue-500/10 text-[var(--muted-foreground)] border-[var(--border)] md:bg-muted/40 md:text-muted-foreground md:border-border';
}

function renderMediaConsensus(value: unknown): ReactNode {
  // Try parsing JSON string first
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return (
        <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground/60 italic">暂无可靠数据</p>
      );
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // fall through to string rendering
      }
    }
  }

  if (parsed == null) {
    return <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground/60 italic">暂无可靠数据</p>;
  }

  if (isMediaOpinionArray(parsed)) {
    if (parsed.length === 0) {
      return <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground/60 italic">暂无可靠数据</p>;
    }
    return (
      <ul className="space-y-2.5">
        {parsed.map((item, idx) => {
          const source = item.source ?? '未知媒体';
          const view = item.view ?? '';
          const credibility = item.credibility ?? '';
          return (
            <li
              key={idx}
              className="rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)] md:border-border/60 md:bg-muted/20 p-2.5"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-[var(--foreground)] md:text-foreground">
                  {source}
                </span>
                {credibility && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${getCredibilityBadgeClass(credibility)}`}
                  >
                    可信度 {credibility}
                  </span>
                )}
              </div>
              {view && (
                <p className="text-xs text-[var(--foreground)]/80 md:text-foreground/80 leading-relaxed">
                  {view}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  // String or other value
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!text) {
    return <p className="text-sm text-muted-foreground/60 italic">暂无可靠数据</p>;
  }
  return (
    <p className="text-sm text-[var(--foreground)]/80 md:text-foreground/80 leading-relaxed whitespace-pre-wrap">
      {text}
    </p>
  );
}

interface IntelTabProps {
  match: BasketballMatchItem;
}

function renderH2HContent(value: unknown): ReactNode {
  if (!value) return <EmptyText />;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return <EmptyText />;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return renderH2HArray(parsed);
        }
        if (parsed && typeof parsed === 'object') {
          return <p className="text-sm text-[var(--foreground)]/80 md:text-foreground/80 leading-relaxed whitespace-pre-wrap">{trimmed}</p>;
        }
      } catch {
        // fall through to raw string
      }
    }
    const lines = trimmed.split(/\n|；|;|，/).map((s: string) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{trimmed}</p>;
    }
    return (
      <ul className="space-y-1">
        {lines.map((line: string, idx: number) => (
          <li key={idx} className="text-xs text-[var(--foreground)]/75 md:text-foreground/75 leading-relaxed flex gap-1.5">
            <span className="text-blue-400 md:text-primary shrink-0">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(value) && value.length > 0) {
    return renderH2HArray(value);
  }
  return <EmptyText />;
}

function renderH2HArray(items: unknown[]): ReactNode {
  const valid = items.filter((item: unknown) => item && typeof item === 'object');
  if (valid.length === 0) return <EmptyText />;
  return (
    <div className="space-y-1.5">
      {valid.map((item: unknown, idx: number) => {
        const g = item as Record<string, unknown>;
        const date = typeof g.date === 'string' ? g.date : '';
        const home = typeof g.homeTeam === 'string' ? g.homeTeam : '';
        const away = typeof g.awayTeam === 'string' ? g.awayTeam : '';
        const hs = typeof g.homeScore === 'number' ? g.homeScore : null;
        const as = typeof g.awayScore === 'number' ? g.awayScore : null;
        return (
          <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--border)]/60 md:border-border/50 last:border-b-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground w-10 shrink-0">{date}</span>
              <span className="truncate text-[var(--foreground)]/80 md:text-foreground/80">{home} vs {away}</span>
            </div>
            {hs !== null && as !== null && (
              <span className="font-mono font-semibold text-[var(--foreground)] md:text-foreground tabular-nums ml-2">
                {hs}-{as}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderKeyPlayersContent(match: BasketballMatchItem): ReactNode {
  const { homeKeyPlayers, awayKeyPlayers, keyPlayers, homeTeam, awayTeam } = match;
  const hasStructured = (homeKeyPlayers && homeKeyPlayers.length > 0) || (awayKeyPlayers && awayKeyPlayers.length > 0);
  if (hasStructured) {
    return (
      <div className="space-y-3">
        {homeKeyPlayers && homeKeyPlayers.length > 0 && (
          <div>
             <div className="text-xs font-semibold text-[var(--foreground)] md:text-foreground mb-1.5">{homeTeam || '主队'}</div>
             <div className="space-y-1">
               {homeKeyPlayers.map((p, idx) => (
                 <div key={idx} className="flex items-center justify-between text-xs py-1">
                   <span className="text-[var(--foreground)]/80 md:text-foreground/80">{p.name} <span className="text-[var(--muted-foreground)] md:text-muted-foreground">{p.position}</span></span>
                   <span className="font-mono text-[var(--foreground)]/70 md:text-foreground/70">{p.ppg}分 {p.rpg}板 {p.apg}助</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {awayKeyPlayers && awayKeyPlayers.length > 0 && (
          <div>
             <div className="text-xs font-semibold text-[var(--foreground)] md:text-foreground mb-1.5">{awayTeam || '客队'}</div>
             <div className="space-y-1">
               {awayKeyPlayers.map((p, idx) => (
                 <div key={idx} className="flex items-center justify-between text-xs py-1">
                   <span className="text-[var(--foreground)]/80 md:text-foreground/80">{p.name} <span className="text-[var(--muted-foreground)] md:text-muted-foreground">{p.position}</span></span>
                   <span className="font-mono text-[var(--foreground)]/70 md:text-foreground/70">{p.ppg}分 {p.rpg}板 {p.apg}助</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (typeof keyPlayers === 'string' && keyPlayers.trim()) {
    const trimmed = keyPlayers.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return (
            <ul className="space-y-1">
              {parsed.filter((v): v is string => typeof v === 'string').map((line: string, idx: number) => (
                 <li key={idx} className="text-xs text-[var(--foreground)]/75 md:text-foreground/75 leading-relaxed flex gap-1.5">
                   <span className="text-orange-400 md:text-basketball-orange shrink-0">·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (parsed && typeof parsed === 'object') {
          return <p className="text-sm text-[var(--foreground)]/80 md:text-foreground/80 leading-relaxed whitespace-pre-wrap">{trimmed}</p>;
        }
      } catch {
        // fall through
      }
    }
    const lines = trimmed.split(/\n|；|;|，/).map((s: string) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{trimmed}</p>;
    }
    return (
      <ul className="space-y-1">
        {lines.map((line: string, idx: number) => (
                 <li key={idx} className="text-xs text-[var(--foreground)]/75 md:text-foreground/75 leading-relaxed flex gap-1.5">
                   <span className="text-orange-400 md:text-basketball-orange shrink-0">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <EmptyText />;
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

const PLACEHOLDER_PATTERNS = /(采集中|待采集|暂无数据|数据收集中|情报收集中|暂无情报|ESPN 数据源|ESPN数据源)/i;
const CLICHE_KEYWORDS = [
  '整体实力碾压',
  '主场攻击力强劲',
  '深指数下仍具备过线能力',
  '客场作战能力不俗',
  '近期状态火热',
  '防守端表现出色',
  '两队实力相当',
  '主场优势明显',
  '客场表现一般',
];

function isUnreliableIntel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_PATTERNS.test(trimmed)) return true;
  if (trimmed.length < 60) return true;
  return CLICHE_KEYWORDS.some((kw) => trimmed.includes(kw));
}

function SectionBlock({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)]/60 md:border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--secondary)] md:bg-muted/40 border-b border-[var(--border)]/60 md:border-border/60">
        <span className={`w-1 h-4 rounded-full ${accent}`} />
        <span className="text-sm font-semibold text-[var(--foreground)] md:text-foreground">{title}</span>
      </div>
      <div className="px-3 py-3">{children}</div>
    </div>
  );
}

function EmptyText() {
  return <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground/60 italic">暂无可靠情报</p>;
}

export default function IntelTab({ match }: IntelTabProps) {
  const combinedTeamNews = [match.intelSummary, match.teamNews].filter(Boolean).join('\n');
  const teamNewsEmpty = isEmptyValue(match.teamNews) && isEmptyValue(match.intelSummary)
     || (combinedTeamNews && isUnreliableIntel(combinedTeamNews));
  const mediaEmpty = isEmptyValue(match.mediaConsensus) || (typeof match.mediaConsensus === 'string' && isUnreliableIntel(match.mediaConsensus));
  const expertEmpty = isEmptyValue(match.expertPicks) || (typeof match.expertPicks === 'string' && isUnreliableIntel(match.expertPicks));
  const keyPlayersEmpty = isEmptyValue(match.keyPlayers) && isEmptyValue(match.homeKeyPlayers) && isEmptyValue(match.awayKeyPlayers);
  const h2hEmpty = isEmptyValue(match.h2hHistory);
  const upsetEmpty = isEmptyValue(match.upsetWarning) || (typeof match.upsetWarning === 'string' && isUnreliableIntel(match.upsetWarning));
  const homeInjuryList = parseInjuries(match.homeInjuries ?? '');
  const awayInjuryList = parseInjuries(match.awayInjuries ?? '');
  const officialHomeInjuries = parseTeamInjuries(match.injuries ?? '', 'home');
  const officialAwayInjuries = parseTeamInjuries(match.injuries ?? '', 'away');
  const injurySource = extractInjurySource(match.injuries ?? '');
  const injuryFetchedAt = extractInjuryFetchedAt(match.injuries ?? '');
  const hasOfficialInjuries = officialHomeInjuries.length > 0 || officialAwayInjuries.length > 0;
  const displayHomeInjuries = officialHomeInjuries.length > 0 ? officialHomeInjuries : homeInjuryList;
  const displayAwayInjuries = officialAwayInjuries.length > 0 ? officialAwayInjuries : awayInjuryList;
  const injuriesEmpty = displayHomeInjuries.length === 0 && displayAwayInjuries.length === 0;
  const allEmpty = teamNewsEmpty && mediaEmpty && expertEmpty && injuriesEmpty && keyPlayersEmpty && upsetEmpty && h2hEmpty;
  const intelSectionHasContent = !teamNewsEmpty || !injuriesEmpty || !h2hEmpty || !keyPlayersEmpty || !mediaEmpty || !expertEmpty;

  if (allEmpty) {
    return (
      <div className="rounded-xl p-6 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm text-center">
        <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground">暂无可靠情报</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 冷门预警 */}
      {!upsetEmpty && match.upsetWarning && (
        <div
          className="rounded-xl p-4 border border-red-400/30 md:border-miss-bg bg-red-500/5 md:bg-[hsl(358_80%_96%)]"
        >
          <div className="text-sm font-semibold mb-2 text-red-400 md:text-miss-text flex items-center gap-2">
            <span>⚠</span>
            冷门预警
          </div>
          <div className="text-sm text-red-300/80 md:text-miss-text/80 leading-relaxed">
            {match.upsetWarning}
          </div>
        </div>
      )}

      {/* 赛事情报区块 */}
       {intelSectionHasContent && (
         <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
           <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
             <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-primary" />
             赛事情报
           </div>
           <div className="space-y-3">
             {/* 球队新闻 */}
             {!teamNewsEmpty && (
               <SectionBlock title="球队新闻" accent="bg-basketball-orange">
                 <div className="space-y-2">
                   {match.intelSummary && (
                     <p className="text-sm text-[var(--foreground)]/80 md:text-foreground/80 leading-relaxed whitespace-pre-wrap font-medium">
                       {match.intelSummary}
                     </p>
                   )}
                   {match.teamNews && match.teamNews !== match.intelSummary && (
                     <p className="text-sm text-[var(--foreground)]/70 md:text-foreground/70 leading-relaxed whitespace-pre-wrap border-l-2 border-[var(--border)]/30 md:border-border pl-3">
                       {match.teamNews}
                     </p>
                   )}
                 </div>
               </SectionBlock>
             )}

             {/* 伤停汇总 */}
             {!injuriesEmpty && (
               <SectionBlock title="伤停汇总" accent="bg-miss-text">
                 <div className="space-y-2.5">
                   {displayHomeInjuries.length > 0 && (
                     <div>
                       <div className="text-xs font-semibold text-[var(--foreground)] md:text-foreground mb-1.5">
                         {match.homeTeam || '主队'}
                       </div>
                       <ul className="space-y-1">
                         {displayHomeInjuries.map((item, idx) => (
                            <li
                              key={`h-${idx}`}
                              className="text-xs text-[var(--foreground)]/75 md:text-foreground/75 leading-relaxed flex gap-1.5"
                            >
                              <span className="text-red-400 md:text-miss-text shrink-0">·</span>
                             <span>{item}</span>
                           </li>
                         ))}
                       </ul>
                     </div>
                   )}
                   {displayAwayInjuries.length > 0 && (
                     <div>
                       <div className="text-xs font-semibold text-[var(--foreground)] md:text-foreground mb-1.5">
                         {match.awayTeam || '客队'}
                       </div>
                       <ul className="space-y-1">
                         {displayAwayInjuries.map((item, idx) => (
                            <li
                              key={`a-${idx}`}
                              className="text-xs text-[var(--foreground)]/75 md:text-foreground/75 leading-relaxed flex gap-1.5"
                            >
                              <span className="text-red-400 md:text-miss-text shrink-0">·</span>
                             <span>{item}</span>
                           </li>
                         ))}
                       </ul>
                     </div>
                   )}
                   {injurySource && (
                     <p className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground text-right pt-1">
                       来源：{injurySource}
                       {injuryFetchedAt && ` · ${new Date(injuryFetchedAt).toLocaleString('zh-CN', { hour12: false })}`}
                     </p>
                   )}
                 </div>
               </SectionBlock>
             )}

             {/* 交锋记录 */}
             {!h2hEmpty && (
               <SectionBlock title="交锋记录" accent="bg-primary">
                 {renderH2HContent(match.h2hHistory)}
               </SectionBlock>
             )}

             {/* 关键球员 */}
             {!keyPlayersEmpty && (
               <SectionBlock title="关键球员" accent="bg-basketball-orange">
                 {renderKeyPlayersContent(match)}
               </SectionBlock>
             )}

             {/* 媒体观点 */}
             {!mediaEmpty && (
               <SectionBlock title="媒体观点" accent="bg-primary">
                 {renderMediaConsensus(match.mediaConsensus)}
               </SectionBlock>
             )}

             {/* 专家观点 */}
             {!expertEmpty && (
               <SectionBlock title="专家观点" accent="bg-draw-text">
                 {renderMediaConsensus(match.expertPicks)}
               </SectionBlock>
             )}
           </div>
         </div>
       )}

      {match.intelUpdatedAt && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>
            情报更新于 {formatBeijingTime(match.intelUpdatedAt, 'datetime')}
          </span>
        </div>
      )}
    </div>
  );
}
