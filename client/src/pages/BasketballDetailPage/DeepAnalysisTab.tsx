import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Users, Trophy, Activity, BarChart3, History } from 'lucide-react';
import type { BasketballMatchItem, BasketballTeamProfile, BasketballRadarData, BasketballH2HGame, BasketballKeyPlayer } from '@shared/api.interface';

interface DeepAnalysisTabProps {
  match: BasketballMatchItem;
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Users;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-blue-500/15 md:bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-blue-400 md:text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--foreground)] md:text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function NoData({ text = '暂无可靠数据' }: { text?: string }) {
  return (
    <div className="text-center py-4 text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
      {text}
    </div>
  );
}

function KeyPlayersSection({
  homeTeam,
  awayTeam,
  homePlayers,
  awayPlayers,
}: {
  homeTeam: string;
  awayTeam: string;
  homePlayers: BasketballKeyPlayer[];
  awayPlayers: BasketballKeyPlayer[];
}) {
  const fmt = (v: unknown): string => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    if (!Number.isFinite(n) || n <= 0) return '—';
    return n.toFixed(1);
  };

  const toNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  };

  const getBadges = (players: BasketballKeyPlayer[]) => {
    const map = new Map<string, string[]>();
    if (players.length === 0) return map;
    let maxPpg = -1, maxRpg = -1, maxApg = -1;
    for (const p of players) {
      const ppg = toNum(p.ppg);
      const rpg = toNum(p.rpg);
      const apg = toNum(p.apg);
      if (ppg > maxPpg) maxPpg = ppg;
      if (rpg > maxRpg) maxRpg = rpg;
      if (apg > maxApg) maxApg = apg;
    }
    for (const p of players) {
      const ppg = toNum(p.ppg);
      const rpg = toNum(p.rpg);
      const apg = toNum(p.apg);
      const badges: string[] = [];
      if (ppg > 0 && ppg === maxPpg) badges.push('得分王');
      if (rpg > 0 && rpg === maxRpg) badges.push('篮板王');
      if (apg > 0 && apg === maxApg) badges.push('助攻王');
      map.set(p.name, badges);
    }
    return map;
  };

  const renderTable = (players: BasketballKeyPlayer[], teamColor: string) => {
    if (!players || players.length === 0) {
      return <NoData />;
    }
    const badgesMap = getBadges(players);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
           <tr className="text-[var(--muted-foreground)] md:text-muted-foreground border-b border-[var(--border)] md:border-border/50">
              <th className="text-left font-medium py-1.5 px-1">球员</th>
              <th className="text-center font-medium py-1.5 px-1">位置</th>
              <th className="text-right font-medium py-1.5 px-1">得分</th>
              <th className="text-right font-medium py-1.5 px-1">篮板</th>
              <th className="text-right font-medium py-1.5 px-1">助攻</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const badges = badgesMap.get(p.name) || [];
              return (
               <tr key={i} className="border-b border-[var(--border)]/40 md:border-border/30 last:border-0">
                 <td className="py-2 px-1">
                   <div className={`text-sm font-medium ${teamColor}`}>{p.name}</div>
                  {badges.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {badges.map((b, j) => (
                        <span
                          key={j}
                            className="text-[9px] px-1 py-0.5 rounded bg-orange-400/20 text-orange-400 md:bg-basketball-orange/15 md:text-basketball-orange font-medium"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.note && (
                    <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">{p.note}</div>
                  )}
                </td>
                 <td className="text-center py-2 px-1 text-[var(--muted-foreground)] md:text-muted-foreground">{p.position}</td>
                 <td className="text-right py-2 px-1 tabular-nums font-mono text-[var(--foreground)] md:inherit">
                  {fmt(p.ppg)}
                </td>
                <td className="text-right py-2 px-1 tabular-nums font-mono">
                  {fmt(p.rpg)}
                </td>
                <td className="text-right py-2 px-1 tabular-nums font-mono">
                  {fmt(p.apg)}
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium text-home-win mb-2">{homeTeam}（主）</div>
        {renderTable(homePlayers, 'text-home-win')}
      </div>
      <div>
        <div className="text-xs font-medium text-away-win mb-2">{awayTeam}（客）</div>
        {renderTable(awayPlayers, 'text-away-win')}
      </div>
    </div>
  );
}

function TeamProfileSection({
  homeTeam,
  awayTeam,
  homeProfile,
  awayProfile,
}: {
  homeTeam: string;
  awayTeam: string;
  homeProfile?: BasketballTeamProfile | null;
  awayProfile?: BasketballTeamProfile | null;
}) {
  const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace('%', ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const hasData = (p?: BasketballTeamProfile | null) =>
    p && (p.homeRecord || p.awayRecord || (num(p.winRate) ?? 0) > 0 || (num(p.pointsPerGame) ?? 0) > 0);

  if (!hasData(homeProfile) && !hasData(awayProfile)) {
    return <NoData />;
  }

  const StatGrid = ({ profile, side }: { profile?: BasketballTeamProfile | null; side: 'home' | 'away' }) => {
    if (!profile) return null;
    const items: { label: string; value: string }[] = [];
    const winRateVal = num(profile.winRate);
    const ppgVal = num(profile.pointsPerGame);
    const rpgVal = num(profile.reboundsPerGame);
    const apgVal = num(profile.assistsPerGame);
    const fgVal = num(profile.fieldGoalPct);
    const tptVal = num(profile.threePointPct);
    if (winRateVal != null && winRateVal > 0)
      items.push({ label: '胜率', value: `${winRateVal.toFixed(1)}%` });
    if (profile.homeRecord) items.push({ label: '主场战绩', value: profile.homeRecord });
    if (profile.awayRecord) items.push({ label: '客场战绩', value: profile.awayRecord });
    if (ppgVal != null && ppgVal > 0)
      items.push({ label: '场均得分', value: ppgVal.toFixed(1) });
    if (rpgVal != null && rpgVal > 0)
      items.push({ label: '场均篮板', value: rpgVal.toFixed(1) });
    if (apgVal != null && apgVal > 0)
      items.push({ label: '场均助攻', value: apgVal.toFixed(1) });
    if (fgVal != null && fgVal > 0)
      items.push({ label: '投篮命中率', value: `${fgVal.toFixed(1)}%` });
    if (tptVal != null && tptVal > 0)
      items.push({ label: '三分命中率', value: `${tptVal.toFixed(1)}%` });

    return (
      <div>
        <div className={`text-xs font-medium mb-2 ${side === 'home' ? 'text-home-win' : 'text-away-win'}`}>
          {side === 'home' ? homeTeam : awayTeam}
        </div>
        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5">
            {items.map((it) => (
               <div key={it.label} className="flex justify-between text-xs px-2 py-1.5 rounded bg-[var(--secondary)] md:bg-background/50">
                 <span className="text-[var(--muted-foreground)] md:text-muted-foreground">{it.label}</span>
                 <span className="font-medium tabular-nums text-[var(--foreground)] md:inherit">{it.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <NoData text="暂无基础战绩数据" />
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <StatGrid profile={homeProfile} side="home" />
      <StatGrid profile={awayProfile} side="away" />
    </div>
  );
}

function RadarSection({
  homeTeam,
  awayTeam,
  homeRadar,
  awayRadar,
}: {
  homeTeam: string;
  awayTeam: string;
  homeRadar?: BasketballRadarData | null;
  awayRadar?: BasketballRadarData | null;
}) {
  if (!homeRadar || !awayRadar) {
    return <NoData />;
  }

  const indicators = [
    { key: 'offense', name: '进攻' },
    { key: 'defense', name: '防守' },
    { key: 'depth', name: '阵容深度' },
    { key: 'inside', name: '内线' },
    { key: 'form', name: '状态' },
  ];

  const getVal = (r: BasketballRadarData, k: string) => {
    const val = (r as unknown as Record<string, number | undefined>)[k];
    return val && val > 0 ? val : 0;
  };

  const option: EChartsOption = {
    tooltip: { trigger: 'item' },
    legend: {
      bottom: 0,
      textStyle: { color: '#737373', fontSize: 11 },
      data: [homeTeam, awayTeam],
    },
    radar: {
      indicator: indicators.map((i) => ({ name: i.name })),
      center: ['50%', '45%'],
      radius: '60%',
      axisName: { color: '#737373', fontSize: 12 },
      splitLine: { lineStyle: { color: '#e0e0e0' } },
      splitArea: {
        show: true,
        areaStyle: { color: ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.03)'] },
      },
      axisLine: { lineStyle: { color: '#e0e0e0' } },
    },
    series: [
      {
        type: 'radar',
        lineStyle: { width: 2 },
        data: [
          {
            name: homeTeam,
            value: indicators.map((i) => getVal(homeRadar, i.key)),
            areaStyle: { color: 'rgba(220, 38, 38, 0.15)' },
            itemStyle: { color: '#dc2626' },
            lineStyle: { color: '#dc2626' },
          },
          {
            name: awayTeam,
            value: indicators.map((i) => getVal(awayRadar, i.key)),
            areaStyle: { color: 'rgba(37, 99, 235, 0.15)' },
            itemStyle: { color: '#2563eb' },
            lineStyle: { color: '#2563eb' },
          },
        ],
      },
    ],
  };

  return (
    <div>
      <ReactECharts option={option} className="h-[280px] w-full" />
      <p className="text-[10px] text-center text-[var(--muted-foreground)] md:text-muted-foreground -mt-2">
        模型评级，仅供参考（5维度：进攻/防守/深度/内线/状态）
      </p>
    </div>
  );
}

function RecentResultsSection({
  homeTeam,
  awayTeam,
  homeGames,
  awayGames,
}: {
  homeTeam: string;
  awayTeam: string;
  homeGames?: string | null;
  awayGames?: string | null;
}) {
  const homeStr = homeGames ?? '';
  const awayStr = awayGames ?? '';

  if (homeStr.length === 0 && awayStr.length === 0) {
    return <NoData />;
  }

  const renderList = (formStr: string, team: string, side: 'home' | 'away') => {
    if (formStr.length === 0) {
      return (
        <div>
          <div className={`text-xs font-medium mb-2 ${side === 'home' ? 'text-home-win' : 'text-away-win'}`}>
            {team}
          </div>
          <NoData text="暂无近期战绩" />
        </div>
      );
    }
    return (
      <div>
        <div className={`text-xs font-medium mb-2 ${side === 'home' ? 'text-home-win' : 'text-away-win'}`}>
          {team} 近期
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {formStr.split('').map((ch, i) => {
            const isWin = ch === '胜' || ch === 'W';
            return (
              <div
                key={i}
                className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold ${
                  isWin
                    ? 'text-white bg-home-win'
                    : 'text-white bg-away-win'
                }`}
              >
                {isWin ? '胜' : '负'}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {renderList(homeStr, homeTeam, 'home')}
      {renderList(awayStr, awayTeam, 'away')}
    </div>
  );
}

function H2HSection({ h2h }: { h2h?: BasketballH2HGame[] | null }) {
  const list = h2h ?? [];
  if (list.length === 0) {
    return (
      <div className="text-center py-4 text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
        暂无可靠近期交锋比分
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {list.map((g, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--secondary)] md:bg-background/50 text-sm text-[var(--foreground)] md:inherit"
        >
          <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground w-14">{g.date || '—'}</div>
          <div className="flex-1 text-center">
            <span className="font-medium">{g.homeTeam}</span>
            <span className="mx-2 font-mono font-bold tabular-nums">
              {g.homeScore}-{g.awayScore}
            </span>
            <span className="font-medium">{g.awayTeam}</span>
          </div>
          {g.note && (
            <div className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground w-20 text-right truncate">
              {g.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DeepAnalysisTab({ match }: DeepAnalysisTabProps) {
  const hasKeyPlayers = (match.homeKeyPlayers?.length ?? 0) > 0 || (match.awayKeyPlayers?.length ?? 0) > 0;
  const hasTeamProfile = (() => {
    const p = match.homeTeamProfile;
    const a = match.awayTeamProfile;
    const hasP = p && (p.homeRecord || p.awayRecord || p.winRate || p.pointsPerGame);
    const hasA = a && (a.homeRecord || a.awayRecord || a.winRate || a.pointsPerGame);
    return !!(hasP || hasA);
  })();
  const hasRadar = (() => {
    const hr = match.homeRadar;
    const ar = match.awayRadar;
    if (!hr || !ar) return false;
    const vals = [hr.offense, hr.defense, hr.depth, hr.inside, hr.form, ar.offense, ar.defense, ar.depth, ar.inside, ar.form];
    return vals.some((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  })();
  const hasForm = !!(match.homeRecentForm && match.homeRecentForm.length > 0) || !!(match.awayRecentForm && match.awayRecentForm.length > 0);
  const hasH2H = (match.h2hHistory?.filter((g) => g.homeScore && g.awayScore)?.length ?? 0) > 0;
  const allEmpty = !hasKeyPlayers && !hasTeamProfile && !hasRadar && !hasForm && !hasH2H;

  if (allEmpty) {
    return (
      <div className="rounded-xl p-6 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm text-center">
        <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground">暂无可靠数据</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hasKeyPlayers && (
        <SectionCard
          icon={Users}
          title="关键球员"
          subtitle="场均数据（来源：联赛官方统计）"
        >
          <KeyPlayersSection
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homePlayers={match.homeKeyPlayers ?? []}
            awayPlayers={match.awayKeyPlayers ?? []}
          />
        </SectionCard>
      )}

      {hasTeamProfile && (
        <SectionCard
          icon={Trophy}
          title="球队战绩 / 战意"
          subtitle="赛季战绩、主客场、战意与关键信息"
        >
          <TeamProfileSection
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homeProfile={match.homeTeamProfile}
            awayProfile={match.awayTeamProfile}
          />
        </SectionCard>
      )}

      {hasRadar && (
        <SectionCard
          icon={BarChart3}
          title="球队实力雷达图"
          subtitle="5维度综合对比"
        >
          <RadarSection
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homeRadar={match.homeRadar}
            awayRadar={match.awayRadar}
          />
        </SectionCard>
      )}

      {hasForm && (
        <SectionCard
          icon={Activity}
          title="近期确认赛果"
          subtitle="有日期来源的近期比赛"
        >
          <RecentResultsSection
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homeGames={match.homeRecentForm}
            awayGames={match.awayRecentForm}
          />
        </SectionCard>
      )}

      {hasH2H && (
        <SectionCard
          icon={History}
          title="历史交锋 H2H"
          subtitle="两队近年直接对话记录"
        >
          <H2HSection h2h={match.h2hHistory} />
        </SectionCard>
      )}
    </div>
  );
}
