/**
 * 北京时间 (Asia/Shanghai, UTC+8) 格式化工具
 * 使用 Intl.DateTimeFormat 实现，不手动加 8 小时
 */

export type BeijingTimeFormat =
  | 'datetime'
  | 'time'
  | 'date'
  | 'date-time'
  | 'time-seconds';

/**
 * 把 ISO 字符串格式化为北京时间
 * @param iso ISO 时间字符串
 * @param format 格式
 *   - 'datetime'（默认）: MM-DD HH:mm
 *   - 'time': HH:mm
 *   - 'date': MM月DD日
 *   - 'date-time': MM月DD日 HH:mm
 *   - 'time-seconds': HH:mm:ss
 */
export function formatBeijingTime(
  iso: string | null | undefined,
  format: BeijingTimeFormat = 'datetime',
): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';

    switch (format) {
      case 'time': {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date);
      }
      case 'time-seconds': {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(date);
      }
      case 'date': {
        const parts = new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(date);
        const month = parts.find((p) => p.type === 'month')?.value ?? '';
        const day = parts.find((p) => p.type === 'day')?.value ?? '';
        return `${month}月${day}日`;
      }
      case 'date-time': {
        const parts = new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(date);
        const month = parts.find((p) => p.type === 'month')?.value ?? '';
        const day = parts.find((p) => p.type === 'day')?.value ?? '';
        const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
        const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
        return `${month}月${day}日 ${hour}:${minute}`;
      }
      case 'datetime':
      default: {
        const parts = new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(date);
        const month = parts.find((p) => p.type === 'month')?.value ?? '';
        const day = parts.find((p) => p.type === 'day')?.value ?? '';
        const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
        const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
        return `${month}-${day} ${hour}:${minute}`;
      }
    }
  } catch {
    return '';
  }
}

/**
 * 返回北京时间对应的 Date 对象（通过 UTC 字段读取）
 * 注意：Date 对象本身无时区概念，这里返回的 Date 其 UTC 字段对应北京时间值
 * 例如北京时间 12:00 → 返回的 Date 的 getUTCHours() === 12
 */
export function getBeijingDateObj(iso: string): Date {
  const d = new Date(iso);
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcMs + 8 * 3600 * 1000);
}

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 获取北京时区下的星期几文字（如 "周一"）
 */
export function getBeijingWeekday(iso: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
    }).format(date);
    const map: Record<string, string> = {
      Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三',
      Thu: '周四', Fri: '周五', Sat: '周六',
    };
    return map[weekday] || '';
  } catch {
    return '';
  }
}

/**
 * 判断是否是"今天"（按北京时间）
 */
export function isBeijingToday(iso: string): boolean {
  if (!iso) return false;
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return false;
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date) === fmt.format(now);
  } catch {
    return false;
  }
}

/**
 * 列表卡片开赛时间显示：当天只显示 HH:mm，其他加周X 前缀
 */
export function formatKickoffDisplay(iso: string): string {
  if (!iso) return '';
  const timeStr = formatBeijingTime(iso, 'time');
  if (!timeStr) return '';
  if (isBeijingToday(iso)) return timeStr;
  return `${getBeijingWeekday(iso)} ${timeStr}`;
}

/**
 * 判断是否是北京时间次日凌晨（0-6点），用于在列表上标注"次日"
 */
export function isNextDayEarlyMorning(iso: string): boolean {
  if (!iso) return false;
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(new Date(iso));
    const h = Number(hour);
    return h >= 0 && h < 6;
  } catch {
    return false;
  }
}

/**
 * 相对秒数格式化
 * @param diffSeconds 差值秒数（正数表示过去）
 * @returns 「刚刚」「X秒前」或「更新延迟」
 */
export function formatRelativeSeconds(diffSeconds: number): {
  text: string;
  level: 'fresh' | 'normal' | 'delayed';
} {
  if (diffSeconds < 10) {
    return { text: '刚刚', level: 'fresh' };
  }
  if (diffSeconds <= 120) {
    return { text: `${Math.floor(diffSeconds)}秒前`, level: 'normal' };
  }
  return { text: '更新延迟', level: 'delayed' };
}

/**
 * 格式化比分来源名称
 */
export function formatLiveScoreSource(source: string | null | undefined): string {
  if (!source) return '';
  const s = source.toLowerCase();
  if (s === 'espn') return 'ESPN';
  if (s === 'qiumibao' || s === 'qiumi') return '直播吧';
  return source;
}

/**
 * 格式化倒计时为 HH:MM:SS
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return '00:00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// 避免 WEEKDAY_MAP 未使用告警
void WEEKDAY_MAP;
