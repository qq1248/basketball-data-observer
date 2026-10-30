import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// 赛事编号展示
// ---------------------------------------------------------------------------

const SOURCE_LABEL_MAP: Record<string, string> = {
  sporttery: '竞彩官方',
  qiumibao: '球美宝',
  beidan: '北单',
};

/**
 * 格式化赛事编号徽章文案
 * - "周日002" 类竞彩格式 → 原样保留
 * - beidan 北单格式 "beidan-日期-序号" → 显示 "北单XXX"（取最后一组数字）
 * - 其他含数字且数字≥3位 → 取数字后三位
 * - 非编号格式 → source 映射中文名
 * - 空值 → 空字符串
 */
export function formatMatchNoBadge(matchNo: string | undefined, source?: string): string {
  if (!matchNo) return '';
  // 竞彩编号格式：周X + 3位数字
  if (/^周[一二三四五六日]\d{3}$/.test(matchNo)) {
    return matchNo;
  }
  // 北单编号：beidan-26105-343 → 北单343
  if (source === 'beidan' || matchNo.startsWith('beidan-')) {
    const parts = matchNo.split('-');
    const lastNum = parts[parts.length - 1];
    if (/^\d+$/.test(lastNum)) {
      return `北单${lastNum}`;
    }
    return '北单';
  }
  // 如果 matchNo 包含至少3位数字，取数字后三位
  const digits = matchNo.match(/\d+/);
  if (digits && digits[0].length >= 3) {
    return digits[0].slice(-3);
  }
  // 非编号格式 → source 映射
  if (source && SOURCE_LABEL_MAP[source]) {
    return SOURCE_LABEL_MAP[source];
  }
  return '外部数据';
}

/**
 * 判断 matchNo 是否为竞彩官方编号（带星期文字）
 */
export function isOfficialMatchNo(matchNo: string | undefined): boolean {
  if (!matchNo) return false;
  return /^周[一二三四五六日]\d{3}$/.test(matchNo);
}

export function formatMatchSourceBadge(source: string | undefined): string {
  if (!source) return '';
  return SOURCE_LABEL_MAP[source] || source;
}

// ---------------------------------------------------------------------------
// 联赛名 hash → 稳定颜色
// ---------------------------------------------------------------------------

// 深红→鲑橙 5 段序列 + 若干辅助色，保持深红星云风格不引入其他色相
const LEAGUE_COLOR_PALETTE = [
  '#8B0000', // nebula-crimson
  '#A52A2A',
  '#B22222',
  '#CD5C5C',
  '#DC143C',
  '#E9967A',
  '#FFA07A',
  '#F08080',
  '#FA8072',
  '#FF7F50',
  '#FF6347',
  '#DB7093',
  '#BC8F8F',
  '#A0522D',
  '#CD853F',
  '#D2691E',
];

/**
 * 根据联赛名生成一个稳定的颜色值（从深红→鲑橙调色板中取）
 */
export function getLeagueColor(league: string): string {
  if (!league) return LEAGUE_COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < league.length; i++) {
    hash = (hash * 31 + league.charCodeAt(i)) >>> 0;
  }
  return LEAGUE_COLOR_PALETTE[hash % LEAGUE_COLOR_PALETTE.length];
}

// ---------------------------------------------------------------------------
// 倒计时计算（基于传入的 now 时间戳，避免每卡片单独 setInterval）
// ---------------------------------------------------------------------------

export type CountdownState =
  | { status: 'upcoming'; text: string; isUrgent: boolean }
  | { status: 'live'; text: string; isUrgent: boolean }
  | { status: 'finished'; text: string; isUrgent: boolean }
  | { status: 'suspended'; text: string; isUrgent: boolean };

/**
 * 计算距开赛的倒计时展示
 * - 距开赛 > 5 分钟：显示 "距开始 HH:mm"
 * - 距开赛 ≤ 5 分钟 或 已过但未开赛：显示 "已停售"
 * - 进行中：显示 "进行中"
 * - 已结束：显示 "已结束"
 */
export function getCountdownState(
  kickoffTime: string,
  matchStatus: string,
  nowTimestamp: number,
): CountdownState {
  if (matchStatus === 'live') {
    return { status: 'live', text: '进行中', isUrgent: true };
  }
  if (matchStatus === 'finished' || matchStatus === 'finished_pending' || matchStatus === 'result_pending' || matchStatus === 'pending_verify') {
    return { status: 'finished', text: '已结束', isUrgent: false };
  }
  if (matchStatus === 'cancelled') {
    return { status: 'suspended', text: '已取消', isUrgent: false };
  }

  const kickoffMs = new Date(kickoffTime).getTime();
  const diffMs = kickoffMs - nowTimestamp;

  // 距开赛 ≤ 5 分钟或已过 → 已停售
  if (diffMs <= 5 * 60 * 1000) {
    return { status: 'suspended', text: '已停售', isUrgent: false };
  }

  const totalMin = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const text = `距开始 ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  const isUrgent = diffMs < 30 * 60 * 1000; // <30 分钟标红

  return { status: 'upcoming', text, isUrgent };
}

/**
 * Hook：父级统一维护 now 时间戳，每 60 秒刷新一次
 * 避免每张卡片单独跑 setInterval
 */
export function useMinuteTicker(): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}
