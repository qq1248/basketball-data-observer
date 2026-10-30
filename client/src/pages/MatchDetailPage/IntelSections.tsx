import React from 'react';
import {
  Trophy,
  TrendingUp,
  Home,
  Swords,
  Target,
  AlertTriangle,
  Zap,
  Users,
  Lightbulb,
  Newspaper,
  Info,
  RotateCcw,
  Crosshair,
} from 'lucide-react';

interface IntelSection {
  title: string;
  content: string;
  icon: React.ReactNode;
  accent: string;
}

const SECTION_ICON_MAP: Record<string, { Icon: typeof Trophy; accent: string }> = {
  '联赛排名': { Icon: Trophy, accent: 'text-amber-400' },
  '近期状态': { Icon: TrendingUp, accent: 'text-emerald-400' },
  '主客场': { Icon: Home, accent: 'text-sky-400' },
  'H2H交锋': { Icon: Swords, accent: 'text-rose-400' },
  '战意赛程': { Icon: Target, accent: 'text-purple-400' },
  '战术分析': { Icon: Lightbulb, accent: 'text-cyan-400' },
  '关键球员': { Icon: Crosshair, accent: 'text-orange-400' },
  '媒体共识': { Icon: Newspaper, accent: 'text-blue-400' },
  '深度复盘': { Icon: RotateCcw, accent: 'text-emerald-400' },
  '赛况复盘': { Icon: RotateCcw, accent: 'text-emerald-400' },
  '进球详情': { Icon: Zap, accent: 'text-yellow-400' },
  '赛果': { Icon: Trophy, accent: 'text-amber-400' },
  '赛事背景': { Icon: Info, accent: 'text-blue-400' },
  '赛事': { Icon: Trophy, accent: 'text-amber-400' },
  '看点': { Icon: Zap, accent: 'text-yellow-400' },
  '球队身价': { Icon: Users, accent: 'text-purple-400' },
  '埃因现状': { Icon: AlertTriangle, accent: 'text-orange-400' },
};

function matchSectionTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('【') && trimmed.includes('】')) {
    return trimmed.slice(1, trimmed.indexOf('】'));
  }
  return trimmed;
}

function parseIntelSections(intel: string): IntelSection[] {
  if (!intel) return [];

  const sections: IntelSection[] = [];
  const regex = /【([^】]+)】([^【]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(intel)) !== null) {
    const title = match[1].trim();
    const content = match[2].trim();
    if (!content) continue;

    const matched = Object.entries(SECTION_ICON_MAP).find(([key]) =>
      title.includes(key) || key.includes(title)
    );

    const { Icon, accent } = matched
      ? matched[1]
      : { Icon: Info, accent: 'text-muted-foreground' };

    sections.push({
      title,
      content,
      icon: <Icon className="w-4 h-4" />,
      accent,
    });
  }

  if (sections.length === 0 && intel.trim()) {
    sections.push({
      title: '情报分析',
      content: intel.trim(),
      icon: <Info className="w-4 h-4" />,
      accent: 'text-accent',
    });
  }

  return sections;
}

const IMPORTANT_SECTIONS = [
  '联赛排名',
  '近期状态',
  '主客场',
  'H2H交锋',
  '战意赛程',
  '战术分析',
  '关键球员',
  '媒体共识',
];

function isImportantSection(title: string): boolean {
  return IMPORTANT_SECTIONS.some((s) => title.includes(s) || s.includes(title));
}

interface IntelSectionsProps {
  intel: string;
  homeTeam: string;
  awayTeam: string;
}

const IntelSections: React.FC<IntelSectionsProps> = ({ intel, homeTeam, awayTeam }) => {
  const sections = parseIntelSections(intel);

  if (sections.length === 0) {
    return null;
  }

  const twoTeamSections = sections.filter(
    (s) =>
      (s.content.includes(homeTeam) || s.title.includes(homeTeam) || s.title.includes('主')) &&
      (s.content.includes(awayTeam) || s.title.includes(awayTeam) || s.title.includes('客') || s.title.includes('联赛排名'))
  );

  return (
    <div className="space-y-3">
      {sections.map((section, index) => {
        const important = isImportantSection(section.title);
        const isTwoTeam = twoTeamSections.includes(section);
        return (
          <div
            key={index}
            className={`rounded-lg border border-border/60 overflow-hidden ${
              important ? 'bg-card' : 'bg-muted/20'
            }`}
          >
            <div
              className={`flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60 ${
                important ? 'bg-muted/40' : 'bg-transparent'
              }`}
            >
              <span className={section.accent}>{section.icon}</span>
              <span className={`text-sm font-medium ${important ? 'text-foreground' : 'text-foreground/80'}`}>
                {section.title}
              </span>
            </div>
            <div className="px-3.5 py-3">
              {isTwoTeam ? (
                <TwoTeamContent content={section.content} homeTeam={homeTeam} awayTeam={awayTeam} title={section.title} />
              ) : (
                <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {section.content}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface TwoTeamContentProps {
  content: string;
  homeTeam: string;
  awayTeam: string;
  title: string;
}

function splitByTeams(
  text: string,
  homeTeam: string,
  awayTeam: string
): { home: string; away: string; common: string } {
  const homeKeywords = ['主', '主队', homeTeam];
  const awayKeywords = ['客', '客队', awayTeam];

  let homePart = '';
  let awayPart = '';
  let commonPart = '';

  const lines = text.split(/[；;。\n]/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const isHome = homeKeywords.some((k) => line.startsWith(k) || line.includes(k));
    const isAway = awayKeywords.some((k) => line.startsWith(k) || line.includes(k));

    if (isHome && !isAway) {
      homePart += (homePart ? '；' : '') + line;
    } else if (isAway && !isHome) {
      awayPart += (awayPart ? '；' : '') + line;
    } else {
      commonPart += (commonPart ? '；' : '') + line;
    }
  }

  return { home: homePart, away: awayPart, common: commonPart };
}

const TwoTeamContent: React.FC<TwoTeamContentProps> = ({ content, homeTeam, awayTeam, title }) => {
  const { home, away, common } = splitByTeams(content, homeTeam, awayTeam);

  if (!home && !away) {
    return <p className="text-xs text-foreground/80 leading-relaxed">{content}</p>;
  }

  return (
    <div className="space-y-3">
      {common && (
        <p className="text-xs text-foreground/70 leading-relaxed pb-2 border-b border-border/40">
          {common}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {home && (
          <div className="p-2.5 rounded-md bg-home-win/5 border border-home-win/20">
            <div className="text-xs font-medium text-home-win mb-1.5">{homeTeam}</div>
            <p className="text-xs text-foreground/80 leading-relaxed">{home}</p>
          </div>
        )}
        {away && (
          <div className="p-2.5 rounded-md bg-away-win/5 border border-away-win/20">
            <div className="text-xs font-medium text-away-win mb-1.5">{awayTeam}</div>
            <p className="text-xs text-foreground/80 leading-relaxed">{away}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default IntelSections;
