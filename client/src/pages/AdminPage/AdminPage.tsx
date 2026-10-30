import { useState, useEffect } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Calendar,
  X,
  Check,
  Trophy,
  Users,
  Activity,
  Upload,
  FileJson,
  Info,
  BarChart3,
  Eye,
  Zap,
  Timer,
  Loader2,
  AlertCircle,
  Wifi,
  Clock,
  Database,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Target,
  Dumbbell,
  Globe,
  UserPlus,
  Search,
   ChevronLeft,
   ChevronRight,
   MessageSquare,
   Send,
   Headphones,
    ClipboardList,
     Settings2,
     Cpu,
     PlayCircle,
     ShieldCheck,
   } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { Textarea } from '@client/src/components/ui/textarea';
import { Switch } from '@client/src/components/ui/switch';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@client/src/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@client/src/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@client/src/components/ui/table';
import { Badge } from '@client/src/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@client/src/components/ui/sheet';
import { matchesApi, statisticsApi, syncApi, adminApi, supportApi } from '@client/src/api';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { formatBeijingTimeShort, formatLocalTimeShort } from '@client/src/utils/format';
import { formatMatchSourceBadge } from '@client/src/utils/match-card-enhance';
import type {
   MatchItem,
   CreateMatchRequest,
   MatchStatsResponse,
   SyncHealthResponse,
   AdminUserItem,
   AdminStatsResponse,
   SupportTicketListItem,
   SupportTicketWithMessages,
   SupportStatsResponse,
   AdminBasketballMatchListItem,
   AdminBasketballMatchDetail,
   AdminAuditLogItem,
   AdminSyncConfigResponse,
   AdminSyncConfigSource,
   DataSourceSettingsResponse,
 } from '@shared/api.interface';

const DIRECTION_OPTIONS = ['主胜', '平', '客胜', '观望'];
const DATA_SOURCE_LABELS: Record<string, string> = {
  espn: 'ESPN',
  sina: '新浪足彩伤停',
  sporttery: '竞彩官方',
  qiumibao: '球探网',
};
const SPORT_LABELS: Record<string, string> = {
  football: '足球',
  basketball: '篮球',
};
const STATUS_OPTIONS = [
  { value: 'upcoming', label: '未开赛' },
  { value: 'finished', label: '已完赛' },
  { value: 'cancelled', label: '已取消' },
];

const DIRECTION_STYLES: Record<string, string> = {
  主胜: 'text-home-win',
  平: 'text-draw',
  客胜: 'text-away-win',
  观望: 'text-muted-foreground',
};

const STATUS_BADGE: Record<string, string> = {
  upcoming: 'bg-muted text-muted-foreground',
  live: 'bg-home-win/20 text-home-win animate-pulse',
  finished: 'bg-foreground/10 text-foreground',
  cancelled: 'bg-destructive/20 text-destructive',
};

const SOURCE_TAG_CLASS: Record<string, string> = {
  sporttery: 'bg-primary/10 text-primary border border-primary/20',
  qiumibao: 'bg-muted text-muted-foreground border border-border',
  beidan: 'bg-accent/15 text-accent border border-accent/25',
};

function buildDuplicateMatchNoSet<T extends { matchNo: string }>(items: T[]): Set<string> {
  const count = new Map<string, number>();
  for (const item of items) {
    count.set(item.matchNo, (count.get(item.matchNo) || 0) + 1);
  }
  const dup = new Set<string>();
  for (const [no, c] of count) {
    if (c > 1) dup.add(no);
  }
  return dup;
}

function MatchNoCell({
  matchNo,
  source,
  league,
  isDuplicate,
}: {
  matchNo: string;
  source?: string;
  league?: string;
  isDuplicate: boolean;
}) {
  const sourceLabel = formatMatchSourceBadge(source);
  const tagClass = source && SOURCE_TAG_CLASS[source]
    ? SOURCE_TAG_CLASS[source]
    : 'bg-muted text-muted-foreground border border-border';
  return (
    <div className="flex flex-col gap-1 min-w-[110px]">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs font-semibold text-foreground">
          {matchNo}
        </span>
        {isDuplicate && (
          <span className="inline-flex items-center rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive border border-destructive/20 uppercase tracking-wider">
            多源重号
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {sourceLabel && (
          <span className={`inline-flex items-center rounded px-1 py-0 text-[10px] font-medium ${tagClass}`}>
            {sourceLabel}
          </span>
        )}
        {league && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]" title={league}>
            {league}
          </span>
        )}
      </div>
    </div>
  );
}

interface MatchFormData {
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  homeWinProb: string;
  drawProb: string;
  awayWinProb: string;
  predictionDirection: string;
  handicap: string;
  handicapRecommendation: string;
  confidence: string;
  lowConfidence: boolean;
  intel: string;
  modelRules: string;
  matchDate: string;
  overUnder: string;
  overProb: string;
  underProb: string;
  totalGoals: string;
  mostLikelyScore: string;
  scoreProbs: string;
  matchStatus: string;
  homeScore: string;
  awayScore: string;
}

interface OddsFormData {
  matchId: string;
  oddsType: string;
  isInitial: string;
  bookmaker: string;
  homeValue: string;
  drawValue: string;
  awayValue: string;
  handicapValue: string;
  totalLine: string;
  overValue: string;
  underValue: string;
  snapshotTime: string;
}

const getTodayStr = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function SourceStatusRow({
  label,
  enabled,
  success,
  lastSyncAt,
  extra,
}: {
  label: string;
  enabled: boolean;
  success: boolean;
  lastSyncAt: string | null;
  extra?: string;
}) {
  if (!enabled) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
        <XCircle className="w-3.5 h-3.5" />
        <span>{label}（未启用）</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      {success ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-home-win flex-shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {lastSyncAt ? `最近同步 ${formatBeijingTimeShort(lastSyncAt)}` : '暂无同步记录'}
          {extra && ` · ${extra}`}
        </div>
      </div>
    </div>
  );
}

const formatKickoffInput = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  } catch {
    return '';
  }
};

const formatKickoffDisplay = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  } catch {
    return isoStr;
  }
};

const formatDateTimeInput = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
};

const defaultMatchForm: MatchFormData = {
  matchNo: '',
  league: '',
  homeTeam: '',
  awayTeam: '',
  kickoffTime: '',
  homeWinProb: '0',
  drawProb: '0',
  awayWinProb: '0',
  predictionDirection: '观望',
  handicap: '0',
  handicapRecommendation: '',
  confidence: '0',
  lowConfidence: false,
  intel: '',
  modelRules: '',
  matchDate: getTodayStr(),
  overUnder: '2.5',
  overProb: '50',
  underProb: '50',
  totalGoals: '2.5',
  mostLikelyScore: '',
  scoreProbs: '',
  matchStatus: 'upcoming',
  homeScore: '',
  awayScore: '',
};

const defaultOddsForm: OddsFormData = {
  matchId: '',
  oddsType: '1x2',
  isInitial: 'initial',
  bookmaker: '官方数据源',
  homeValue: '',
  drawValue: '',
  awayValue: '',
  handicapValue: '0',
  totalLine: '2.5',
  overValue: '',
  underValue: '',
  snapshotTime: formatDateTimeInput(new Date().toISOString()),
};

type AdminTab = 'matches' | 'basketball' | 'odds' | 'stats' | 'import' | 'sync' | 'users' | 'audit' | 'prediction' | 'inspection' | 'tasks' | 'monitor' | 'support';

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('matches');

  // === 比赛管理 ===
  const [date, setDate] = useState<string>(getTodayStr());
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [matchForm, setMatchForm] = useState<MatchFormData>(defaultMatchForm);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [scoreDialogOpen, setScoreDialogOpen] = useState(false);
  const [scoreMatchId, setScoreMatchId] = useState<string | null>(null);
  const [scoreMatchName, setScoreMatchName] = useState('');
  const [scoreForm, setScoreForm] = useState({ homeScore: 0, awayScore: 0, matchStatus: 'finished' as string });
  const [scoreSaving, setScoreSaving] = useState(false);

  // === 指数管理 ===
   const [oddsDialogOpen, setOddsDialogOpen] = useState(false);
   const [oddsForm, setOddsForm] = useState<OddsFormData>(defaultOddsForm);
   const [oddsSaving, setOddsSaving] = useState(false);
   const [oddsRecords, setOddsRecords] = useState<any[]>([]);

  // === 平台统计 ===
  const [platformStats, setPlatformStats] = useState<MatchStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // === 批量导入 ===
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // === 同步状态 ===
  const [syncHealth, setSyncHealth] = useState<SyncHealthResponse | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [deepBackfillStatus, setDeepBackfillStatus] = useState<import('@client/src/api/sync').DeepBackfillStatus | null>(null);
  const [deepBackfillPollTimer, setDeepBackfillPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [manualSyncLoading, setManualSyncLoading] = useState(false);

  // === 用户管理 ===
  const [userStats, setUserStats] = useState<AdminStatsResponse | null>(null);
  const [userStatsLoading, setUserStatsLoading] = useState(false);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize] = useState(10);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [confirmUserAction, setConfirmUserAction] = useState<{
    type: 'delete' | 'role';
    user: AdminUserItem | null;
    targetRole?: 'admin' | 'user';
  }>({ type: 'delete', user: null });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
   const [actionLoading, setActionLoading] = useState(false);

   // === 客服工单 ===
   const [adminStats, setAdminStats] = useState<SupportStatsResponse | null>(null);
   const [adminStatsLoading, setAdminStatsLoading] = useState(false);
   const [supportTickets, setSupportTickets] = useState<SupportTicketListItem[]>([]);
   const [supportTotal, setSupportTotal] = useState(0);
   const [supportPage, setSupportPage] = useState(1);
   const [supportPageSize] = useState(10);
   const [supportStatusFilter, setSupportStatusFilter] = useState<'all' | 'open' | 'processing' | 'closed'>('all');
   const [supportLoading, setSupportLoading] = useState(false);
   const [supportError, setSupportError] = useState<string | null>(null);
   const [selectedTicket, setSelectedTicket] = useState<SupportTicketWithMessages | null>(null);
   const [ticketDetailOpen, setTicketDetailOpen] = useState(false);
   const [ticketDetailLoading, setTicketDetailLoading] = useState(false);
   const [replyText, setReplyText] = useState('');
   const [replySending, setReplySending] = useState(false);
   const [ticketActionLoading, setTicketActionLoading] = useState(false);

   // === 篮球比赛管理 ===
   const [bballDate, setBballDate] = useState<string>(getTodayStr());
   const [bballMatches, setBballMatches] = useState<AdminBasketballMatchListItem[]>([]);
   const [bballLoading, setBballLoading] = useState(false);
   const [bballError, setBballError] = useState<string | null>(null);
   const [bballTotal, setBballTotal] = useState(0);
   const [bballPage, setBballPage] = useState(1);
   const [bballPageSize] = useState(20);

   const [bballDialogOpen, setBballDialogOpen] = useState(false);
   const [bballEditingMatchId, setBballEditingMatchId] = useState<string | null>(null);
   const [bballEditingMatch, setBballEditingMatch] = useState<AdminBasketballMatchDetail | null>(null);
   const [bballSaving, setBballSaving] = useState(false);
   const [bballForm, setBballForm] = useState<Record<string, string | boolean>>({});

   const [bballDeleteId, setBballDeleteId] = useState<string | null>(null);
   const [bballDeleting, setBballDeleting] = useState(false);

   const [bballScoreDialogOpen, setBballScoreDialogOpen] = useState(false);
   const [bballScoreMatchId, setBballScoreMatchId] = useState<string | null>(null);
   const [bballScoreMatchName, setBballScoreMatchName] = useState('');
   const [bballScoreForm, setBballScoreForm] = useState({ homeScore: 0, awayScore: 0, matchStatus: 'finished' as string });
   const [bballScoreSaving, setBballScoreSaving] = useState(false);

   // === 审计日志 ===
   const [auditPage, setAuditPage] = useState(1);
   const [auditPageSize] = useState(20);
   const [auditActionType, setAuditActionType] = useState<string>('all');
   const [auditItems, setAuditItems] = useState<AdminAuditLogItem[]>([]);
   const [auditTotal, setAuditTotal] = useState(0);
   const [auditLoading, setAuditLoading] = useState(false);
   const [auditError, setAuditError] = useState<string | null>(null);

   // === 同步配置 ===
   const [syncConfig, setSyncConfig] = useState<AdminSyncConfigResponse | null>(null);
   const [syncConfigLoading, setSyncConfigLoading] = useState(false);

   // === 数据源设置 ===
   const [dataSources, setDataSources] = useState<DataSourceSettingsResponse | null>(null);
   const [dataSourcesLoading, setDataSourcesLoading] = useState(false);
   const [apiSportsKey, setApiSportsKey] = useState('');
   const [theRundownKey, setTheRundownKey] = useState('');
  const [apiSportsSaving, setApiSportsSaving] = useState(false);
  const [theRundownSaving, setTheRundownSaving] = useState(false);
   const [footballDataOrgKey, setFootballDataOrgKey] = useState('');
   const [footballDataOrgSaving, setFootballDataOrgSaving] = useState(false);

   // === 失败任务告警 ===
   const [failedTaskAlert, setFailedTaskAlert] = useState<{
     failedCount: number;
     items: Array<{
       id: string;
       taskName: string;
       trigger: string;
       startedAt: string;
       errorMessage: string | null;
       dataSource: string | null;
     }>;
   } | null>(null);

   // === 预测管理 ===
   const [predictionSport, setPredictionSport] = useState<'football' | 'basketball'>('football');
   const [predictionStatus, setPredictionStatus] = useState<string>('all');
   const [predictionDateFrom, setPredictionDateFrom] = useState<string>('');
   const [predictionDateTo, setPredictionDateTo] = useState<string>('');
   const [predictionLeague, setPredictionLeague] = useState<string>('');
   const [previewResult, setPreviewResult] = useState<{
     total: number;
     sport: string;
   } | null>(null);
   const [previewLoading, setPreviewLoading] = useState(false);
   const [recalcResult, setRecalcResult] = useState<{
     totalScanned: number;
     recalculated: number;
     skippedLocked: number;
     skippedNoData: number;
     predictionsMade: number;
     holds: number;
     durationMs: number;
   } | null>(null);
   const [recalcLoading, setRecalcLoading] = useState(false);
   const [recalcConfirmOpen, setRecalcConfirmOpen] = useState(false);

   // === 数据巡检 ===
   const [inspectionSport, setInspectionSport] = useState<'all' | 'football' | 'basketball'>('all');
   const [inspectionResult, setInspectionResult] = useState<{
     scanTime: string;
     totalScanned: number;
     football: {
       total: number;
       waitCount: number;
       waitRate: number;
       anomalies: Array<{
         id: string;
         matchNo: string;
         league: string;
         homeTeam: string;
         awayTeam: string;
         kickoffTime: string;
         anomalyType: string;
         anomalyDetail: string;
         severity: string;
       }>;
     };
     basketball: {
       total: number;
       waitCount: number;
       waitRate: number;
       anomalies: Array<{
         id: string;
         matchNo: string;
         league: string;
         homeTeam: string;
         awayTeam: string;
         kickoffTime: string;
         anomalyType: string;
         anomalyDetail: string;
         severity: string;
       }>;
     };
   } | null>(null);
   const [inspectionLoading, setInspectionLoading] = useState(false);

   // === V11自动检查 ===
   const [autoCheckLatest, setAutoCheckLatest] = useState<import('@client/src/api/admin').AutoCheckReport | null>(null);
   const [autoCheckHistory, setAutoCheckHistory] = useState<import('@client/src/api/admin').AutoCheckReport[]>([]);
   const [autoCheckTotal, setAutoCheckTotal] = useState(0);
   const [autoCheckPage, setAutoCheckPage] = useState(1);
   const [autoCheckLoading, setAutoCheckLoading] = useState(false);
   const [autoCheckRunning, setAutoCheckRunning] = useState(false);

   // === 竞彩覆盖巡检 ===
   const [coverageResult, setCoverageResult] = useState<import('@client/src/api/admin').SportteryCoverageResult | null>(null);
   const [coverageLoading, setCoverageLoading] = useState(false);

   // === 自动化任务管理 ===
   const [automationTasks, setAutomationTasks] = useState<Array<{
     name: string;
     description: string;
     cron: string;
     trigger: string;
     enabled: boolean;
     isRunning: boolean;
     isPlatformManaged: boolean;
     lastRunAt: string | null;
     lastStatus: string | null;
     lastErrorMessage: string | null;
     lastRecordsUpdated: number | null;
   }>>([]);
   const [automationLoading, setAutomationLoading] = useState(false);

   // === 监控大盘 ===
   const [monitorData, setMonitorData] = useState<{
     syncHealth: Array<{
       taskName: string;
       totalRuns: number;
       successRuns: number;
       failedRuns: number;
       successRate: number;
       lastRunAt: string | null;
       lastStatus: string | null;
     }>;
     dataAccuracy: {
       football: Array<{
         date: string;
         total: number;
         wdwHitRate: number;
         handicapHitRate: number;
         overunderHitRate: number;
       }>;
       basketball: Array<{
         date: string;
         total: number;
         wdwHitRate: number;
         handicapHitRate: number;
         overunderHitRate: number;
       }>;
     };
     dataHealth: {
       footballTotal: number;
       basketballTotal: number;
       footballUpcoming: number;
       basketballUpcoming: number;
       footballLive: number;
       basketballLive: number;
       footballFinished: number;
       basketballFinished: number;
       anomalyCount: number;
       waitRateFootball: number;
       waitRateBasketball: number;
     };
     accuracySummary: {
       football7d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
       football30d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
       basketball7d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
       basketball30d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
     };
     dataSourceStatus: Array<{
       dataSource: string;
       totalRuns: number;
       successRuns: number;
       failedRuns: number;
       successRate: number;
       lastRunAt: string | null;
     }>;
     failedAlerts: Array<{
       id: string;
       taskName: string;
       trigger: string;
       startedAt: string;
       errorMessage: string | null;
       dataSource: string | null;
     }>;
      recentRuns: Array<{
        id: string;
        taskName: string;
        trigger: string;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        durationMs: number | null;
        recordsUpdated: number | null;
        errorMessage: string | null;
      }>;
       engineInfo: {
         version: string;
         versionName: string;
         buildDate: string;
         football: {
           upcomingTotal: number;
           eloCount: number; eloCoverage: number;
           xgCount: number; xgCoverage: number;
           mlCount: number; mlCoverage: number;
         };
         basketball: {
           upcomingTotal: number;
           eloCount: number; eloCoverage: number;
           xgCount: number; xgCoverage: number;
           mlCount: number; mlCoverage: number;
         };
       };
       injuryHealth: {
         footballUpcomingTotal: number;
         footballInjuryCovered: number;
         footballInjuryCoverage: number;
         basketballUpcomingTotal: number;
         basketballInjuryCovered: number;
         basketballInjuryCoverage: number;
         totalReports: number;
         highImpactReports: number;
         mediumImpactReports: number;
         lowImpactReports: number;
         sourceLastSync: Array<{
           dataSource: string;
           sport: string;
           lastSyncAt: string | null;
           hoursSince: number;
           status: 'ok' | 'warn' | 'stale';
         }>;
         missingInjury24h: number;
       };
     } | null>(null);
   const [monitorLoading, setMonitorLoading] = useState(false);
   const [accuracySport, setAccuracySport] = useState<'football' | 'basketball'>('football');
   const [accuracyDays, setAccuracyDays] = useState<'7' | '30'>('7');

   const loadUserStats = async () => {
    setUserStatsLoading(true);
    try {
      const data = await adminApi.getStats();
      setUserStats(data);
    } catch (err) {
      logger.error('加载用户统计失败', err);
    } finally {
      setUserStatsLoading(false);
    }
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const params: {
        page: number;
        pageSize: number;
        search?: string;
        role?: 'admin' | 'user';
      } = { page: userPage, pageSize: userPageSize };
      if (userSearch.trim()) params.search = userSearch.trim();
      if (userRoleFilter !== 'all') params.role = userRoleFilter;
      const data = await adminApi.listUsers(params);
      setUsers(data.items);
      setUsersTotal(data.total);
    } catch (err) {
      setUsersError('加载用户列表失败');
      logger.error('加载用户列表失败', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const handleUserSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserSearch(e.target.value);
  };

  // 防抖搜索
  useEffect(() => {
    if (activeTab !== 'users') return;
    const timer = setTimeout(() => {
      setUserPage(1);
      void loadUsers();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch, userRoleFilter, activeTab]);

  useEffect(() => {
     if (activeTab !== 'users') return;
     void loadUsers();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [userPage]);

   useEffect(() => {
     if (activeTab !== 'support') return;
     setSupportPage(1);
     void loadSupportTickets();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [supportStatusFilter, activeTab]);

   useEffect(() => {
     if (activeTab !== 'support') return;
     void loadSupportTickets();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [supportPage]);

   // 篮球比赛列表加载
   useEffect(() => {
     if (activeTab !== 'basketball') return;
     void loadBballMatches(bballDate);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [activeTab, bballPage]);

   // 审计日志加载
   useEffect(() => {
     if (activeTab !== 'audit') return;
     setAuditPage(1);
     void loadAuditLogs();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [auditActionType, activeTab]);

   useEffect(() => {
     if (activeTab !== 'audit') return;
     void loadAuditLogs();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [auditPage]);

   // 同步配置加载
   useEffect(() => {
     if (activeTab !== 'sync') return;
     void loadSyncConfig();
     void loadDataSources();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [activeTab]);

  const handleRefreshUsers = () => {
    void loadUserStats();
    void loadUsers();
  };

  const handleToggleRole = (user: AdminUserItem) => {
    const targetRole: 'admin' | 'user' = user.role === 'admin' ? 'user' : 'admin';
    setConfirmUserAction({ type: 'role', user, targetRole });
    setConfirmDialogOpen(true);
  };

  const handleDeleteUser = (user: AdminUserItem) => {
    setConfirmUserAction({ type: 'delete', user });
    setConfirmDialogOpen(true);
  };

  const handleConfirmUserAction = async () => {
    if (!confirmUserAction.user) return;
    const { user, type, targetRole } = confirmUserAction;
    setActionLoading(true);
    try {
      if (type === 'delete') {
        await adminApi.deleteUser(user.id);
        toast.success('用户已删除');
      } else if (type === 'role' && targetRole) {
        await adminApi.updateUserRole(user.id, targetRole);
        toast.success(targetRole === 'admin' ? '已设为管理员' : '已取消管理员');
      }
      setConfirmDialogOpen(false);
      void loadUsers();
      void loadUserStats();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '操作失败';
      toast.error(msg);
      logger.error('用户操作失败', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async (user: AdminUserItem) => {
    try {
      const res = await adminApi.resetPassword(user.id);
      toast.success(`密码已重置，新密码：${res.newPassword}（点击复制）`, {
        action: {
          label: '复制',
          onClick: () => {
            navigator.clipboard.writeText(res.newPassword).catch(() => {});
          },
        },
        duration: 8000,
      });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '重置密码失败';
      toast.error(msg);
      logger.error('重置密码失败', err);
    }
  };

  const totalUserPages = Math.max(1, Math.ceil(usersTotal / userPageSize));

   // === 客服工单方法 ===
   const loadAdminStats = async () => {
     setAdminStatsLoading(true);
     try {
       const data = await supportApi.getAdminStats();
       setAdminStats(data);
     } catch (err) {
       logger.error('加载客服统计失败', err);
     } finally {
       setAdminStatsLoading(false);
     }
   };

   const loadSupportTickets = async () => {
     setSupportLoading(true);
     setSupportError(null);
     try {
       const data = await supportApi.getAdminTickets({
         status: supportStatusFilter,
         page: supportPage,
         pageSize: supportPageSize,
       });
       setSupportTickets(data.items);
       setSupportTotal(data.total);
     } catch (err) {
       setSupportError('加载工单列表失败');
       logger.error('加载工单列表失败', err);
     } finally {
       setSupportLoading(false);
     }
   };

   const handleViewTicket = async (ticket: SupportTicketListItem) => {
     setTicketDetailOpen(true);
     setTicketDetailLoading(true);
     setSelectedTicket(null);
     setReplyText('');
       try {
         const data = await supportApi.getAdminTicket(ticket.id);
         const safeData = {
           ...data,
           messages: Array.isArray(data.messages) ? data.messages : [],
         };
         if (safeData.messages.length === 0 && safeData.lastMessageAt) {
           logger.info(`工单 ${ticket.id} 首次返回空消息但 lastMessageAt 存在，重试拉取`);
           const retryData = await supportApi.getAdminTicket(ticket.id);
           safeData.messages = Array.isArray(retryData.messages) ? retryData.messages : [];
         }
         setSelectedTicket(safeData);
        setSupportTickets((prev) =>
          prev.map((t) => (t.id === ticket.id ? { ...t, unreadByAdmin: 0 } : t)),
        );
      } catch (err) {
        logger.error('加载工单详情失败', err);
        toast.error(
          `加载工单详情失败：${(err as any)?.response?.data?.message || (err as Error)?.message || '未知错误'}`,
        );
      } finally {
       setTicketDetailLoading(false);
     }
   };

   const handleAdminReply = async () => {
     if (!selectedTicket || !replyText.trim() || replySending) return;
     setReplySending(true);
     try {
       const msg = await supportApi.adminReply(selectedTicket.id, replyText.trim());
       setSelectedTicket((prev) =>
         prev ? { ...prev, messages: [...prev.messages, msg] } : prev,
       );
       setReplyText('');
     } catch (err: any) {
       const msg = err?.response?.data?.message || err?.message || '回复失败';
       toast.error(msg);
       logger.error('回复失败', err);
     } finally {
       setReplySending(false);
     }
   };

   const handleUpdateStatus = async (status: 'open' | 'processing' | 'closed') => {
     if (!selectedTicket || ticketActionLoading) return;
     setTicketActionLoading(true);
     try {
       const updated = await supportApi.updateTicketStatus(selectedTicket.id, status);
       setSelectedTicket((prev) => (prev ? { ...prev, ...updated } : prev));
       setSupportTickets((prev) =>
         prev.map((t) => (t.id === updated.id ? { ...t, status: updated.status } : t)),
       );
       toast.success(
         status === 'open'
           ? '工单已重新打开'
           : status === 'processing'
             ? '已开始处理'
             : '工单已关闭',
       );
     } catch (err: any) {
       const msg = err?.response?.data?.message || err?.message || '操作失败';
       toast.error(msg);
       logger.error('更新工单状态失败', err);
     } finally {
       setTicketActionLoading(false);
     }
   };

   const handleUpdatePriority = async (priority: 'normal' | 'urgent') => {
     if (!selectedTicket || ticketActionLoading) return;
     setTicketActionLoading(true);
     try {
       const updated = await supportApi.updateTicketPriority(selectedTicket.id, priority);
       setSelectedTicket((prev) => (prev ? { ...prev, ...updated } : prev));
       setSupportTickets((prev) =>
         prev.map((t) => (t.id === updated.id ? { ...t, priority: updated.priority } : t)),
       );
       toast.success(priority === 'urgent' ? '已设为紧急' : '已设为普通');
     } catch (err: any) {
       const msg = err?.response?.data?.message || err?.message || '操作失败';
       toast.error(msg);
       logger.error('更新工单优先级失败', err);
     } finally {
       setTicketActionLoading(false);
     }
   };

   const totalSupportPages = Math.max(1, Math.ceil(supportTotal / supportPageSize));

   const unreadSupportCount = supportTickets.reduce(
     (sum: number, t: SupportTicketListItem) => sum + (t.unreadByAdmin || 0),
     0,
   );

   const STATUS_LABEL: Record<'open' | 'processing' | 'closed', string> = {
     open: '待处理',
     processing: '处理中',
     closed: '已关闭',
   };

   const STATUS_BADGE_SUPPORT: Record<'open' | 'processing' | 'closed', string> = {
     open: 'bg-accent/15 text-accent border border-accent/30',
     processing: 'bg-primary/15 text-primary border border-primary/30',
     closed: 'bg-muted text-muted-foreground border border-border',
   };

    const CATEGORY_BADGE: Record<string, string> = {
      '功能问题': 'bg-primary/10 text-primary border border-primary/20',
      '数据问题': 'bg-accent/10 text-accent border border-accent/20',
      '建议反馈': 'bg-home-win/10 text-home-win border border-home-win/20',
      '其他': 'bg-muted text-muted-foreground border border-border',
    };

   // === 篮球比赛管理方法 ===
   const loadBballMatches = async (dateStr: string) => {
     setBballLoading(true);
     setBballError(null);
     try {
       const data = await adminApi.listBasketballMatches({
         date: dateStr,
         page: bballPage,
         pageSize: bballPageSize,
       });
       setBballMatches(data.items);
       setBballTotal(data.total);
     } catch (err) {
       setBballError('加载篮球比赛列表失败');
       logger.error('加载篮球比赛列表失败', err);
     } finally {
       setBballLoading(false);
     }
   };

   const handleBballDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
     setBballDate(e.target.value);
     setBballPage(1);
     void loadBballMatches(e.target.value);
   };

   const handleBballAddClick = () => {
     setBballEditingMatchId(null);
     setBballEditingMatch(null);
     setBballForm({
       matchNo: '',
       league: '',
       homeTeam: '',
       awayTeam: '',
       kickoffTime: '',
       matchDate: bballDate,
       homeWinProb: '50',
       awayWinProb: '50',
       predictionDirection: '主胜',
       handicap: '0',
       handicapRecommendation: '',
       totalLine: '0',
       confidence: '0',
       intel: '',
       riskWarning: '',
       matchStatus: 'upcoming',
       homeScore: '',
       awayScore: '',
       isNeutral: 'false',
       category: 'official',
       modelRules: '',
       handicapLineNum: '',
       totalLineNum: '',
     });
     setBballDialogOpen(true);
   };

   const handleBballEditClick = async (match: AdminBasketballMatchListItem) => {
     setBballEditingMatchId(match.id);
     try {
       const detail = await adminApi.getBasketballMatch(match.id);
       setBballEditingMatch(detail);
       setBballForm({
         matchNo: detail.matchNo,
         league: detail.league,
         homeTeam: detail.homeTeam,
         awayTeam: detail.awayTeam,
         kickoffTime: formatKickoffInput(detail.kickoffTime),
         matchDate: detail.matchDate,
         homeWinProb: String(detail.homeWinProb ?? 0),
         awayWinProb: String(detail.awayWinProb ?? 0),
         predictionDirection: detail.predictionDirection || '主胜',
         handicap: detail.handicap || '0',
         handicapRecommendation: detail.handicapRecommendation || '',
         totalLine: detail.totalLine || '0',
         confidence: String(detail.confidence ?? 0),
         intel: detail.intel || '',
         riskWarning: detail.riskWarning || '',
         matchStatus: detail.matchStatus || 'upcoming',
         homeScore: detail.homeScore !== null ? String(detail.homeScore) : '',
         awayScore: detail.awayScore !== null ? String(detail.awayScore) : '',
         isNeutral: detail.isNeutral ? 'true' : 'false',
         category: detail.category || 'official',
         modelRules: (detail.modelRules || []).join(', '),
         handicapLineNum: detail.handicapLineNum !== null ? String(detail.handicapLineNum) : '',
         totalLineNum: detail.totalLineNum !== null ? String(detail.totalLineNum) : '',
       });
       setBballDialogOpen(true);
     } catch (err) {
       logger.error('获取篮球比赛详情失败', err);
       toast.error('获取比赛详情失败');
     }
   };

   const handleBballFormChange = (field: string, value: string | boolean) => {
     setBballForm((prev) => ({ ...prev, [field]: value }));
   };

   const handleBballSave = async () => {
     if (!bballForm.homeTeam || !bballForm.awayTeam) {
       toast.error('请填写主客队名称');
       return;
     }
     setBballSaving(true);
     try {
       const kickoffTimeVal = bballForm.kickoffTime as string;
       const matchDateVal = (bballForm.matchDate as string) || bballDate;
       const predictionDirVal = bballForm.predictionDirection as string;
       const handicapVal = bballForm.handicap as string;
       const handicapRecVal = bballForm.handicapRecommendation as string;
       const totalLineVal = bballForm.totalLine as string;
       const intelVal = bballForm.intel as string;
       const riskVal = bballForm.riskWarning as string;
       const statusVal = bballForm.matchStatus as string;
       const categoryVal = bballForm.category as string;
       const modelRulesVal = bballForm.modelRules as string;

       const payload = {
         matchNo: bballForm.matchNo as string,
         league: bballForm.league as string,
         homeTeam: bballForm.homeTeam as string,
         awayTeam: bballForm.awayTeam as string,
         kickoffTime: kickoffTimeVal ? new Date(kickoffTimeVal).toISOString() : undefined,
         matchDate: matchDateVal,
         homeWinProb: Number(bballForm.homeWinProb) || 0,
         awayWinProb: Number(bballForm.awayWinProb) || 0,
         predictionDirection: predictionDirVal,
         handicap: handicapVal,
         handicapRecommendation: handicapRecVal,
         totalLine: totalLineVal,
         confidence: Number(bballForm.confidence) || 0,
         intel: intelVal,
         riskWarning: riskVal,
         matchStatus: statusVal as 'upcoming' | 'live' | 'finished',
         homeScore: bballForm.homeScore !== '' ? Number(bballForm.homeScore) : null,
         awayScore: bballForm.awayScore !== '' ? Number(bballForm.awayScore) : null,
         isNeutral: bballForm.isNeutral === 'true',
         category: categoryVal,
         modelRules: modelRulesVal
           ? modelRulesVal.split(',').map((s) => s.trim()).filter(Boolean)
           : [],
         handicapLineNum: bballForm.handicapLineNum !== '' ? Number(bballForm.handicapLineNum) : null,
         totalLineNum: bballForm.totalLineNum !== '' ? Number(bballForm.totalLineNum) : null,
       };

       if (bballEditingMatchId) {
         await adminApi.updateBasketballMatch(bballEditingMatchId, payload);
         toast.success('篮球比赛已更新');
       } else {
         await adminApi.createBasketballMatch(payload);
         toast.success('篮球比赛已创建');
       }
       setBballDialogOpen(false);
       void loadBballMatches(bballDate);
     } catch (err: unknown) {
       const msg =
         (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
         (err as Error)?.message ||
         '保存失败';
       toast.error(msg);
       logger.error('保存篮球比赛失败', err);
     } finally {
       setBballSaving(false);
     }
   };

   const handleBballDeleteMatch = async () => {
     if (!bballDeleteId) return;
     setBballDeleting(true);
     try {
       await adminApi.deleteBasketballMatch(bballDeleteId);
       setBballDeleteId(null);
       toast.success('比赛已删除');
       void loadBballMatches(bballDate);
     } catch (err) {
       logger.error('删除篮球比赛失败', err);
       toast.error('删除失败');
     } finally {
       setBballDeleting(false);
     }
   };

   const handleBballOpenScoreDialog = (match: AdminBasketballMatchListItem) => {
     setBballScoreMatchId(match.id);
     setBballScoreMatchName(`${match.homeTeam} vs ${match.awayTeam}`);
     setBballScoreForm({
       homeScore: match.homeScore ?? 0,
       awayScore: match.awayScore ?? 0,
       matchStatus: match.matchStatus || 'finished',
     });
     setBballScoreDialogOpen(true);
   };

   const handleBballScoreUpdate = async () => {
     if (!bballScoreMatchId) return;
     setBballScoreSaving(true);
     try {
       await adminApi.updateBasketballScore(
         bballScoreMatchId,
         bballScoreForm.homeScore,
         bballScoreForm.awayScore,
         bballScoreForm.matchStatus,
       );
       toast.success('比分已更新');
       setBballScoreDialogOpen(false);
       void loadBballMatches(bballDate);
     } catch (err) {
       logger.error('更新篮球比分失败', err);
       toast.error('更新失败');
     } finally {
       setBballScoreSaving(false);
     }
   };

   const totalBballPages = Math.max(1, Math.ceil(bballTotal / bballPageSize));

   // === 审计日志方法 ===
   const loadAuditLogs = async () => {
     setAuditLoading(true);
     setAuditError(null);
     try {
       const params: { page: number; pageSize: number; actionType?: string } = {
         page: auditPage,
         pageSize: auditPageSize,
       };
       if (auditActionType !== 'all') {
         params.actionType = auditActionType;
       }
       const data = await adminApi.listAuditLogs(params);
       setAuditItems(data.items);
       setAuditTotal(data.total);
     } catch (err) {
       setAuditError('加载审计日志失败');
       logger.error('加载审计日志失败', err);
     } finally {
       setAuditLoading(false);
     }
   };

   const totalAuditPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));

   const AUDIT_ACTION_LABELS: Record<string, string> = {
     login: '登录',
     create_match: '创建比赛',
     update_match: '更新比赛',
     delete_match: '删除比赛',
     update_user_role: '修改用户角色',
     reset_password: '重置密码',
     delete_user: '删除用户',
     reply_ticket: '回复工单',
     trigger_sync: '触发同步',
   };

   // === 同步配置方法 ===
   const loadSyncConfig = async () => {
     setSyncConfigLoading(true);
     try {
       const data = await adminApi.getSyncConfig();
       setSyncConfig(data);
     } catch (err) {
       logger.error('加载同步配置失败', err);
     } finally {
       setSyncConfigLoading(false);
     }
   };

   const formatInterval = (ms?: number): string => {
     if (!ms) return '—';
     const seconds = Math.floor(ms / 1000);
     if (seconds < 60) return `${seconds}秒`;
     const minutes = Math.floor(seconds / 60);
     if (minutes < 60) return `${minutes}分钟`;
     const hours = Math.floor(minutes / 60);
     return `${hours}小时${minutes % 60}分`;
   };

   const loadSyncHealth = async () => {
    setSyncLoading(true);
    setSyncError(null);
    try {
      const data = await syncApi.getSyncHealth();
      setSyncHealth(data);
    } catch (err) {
      setSyncError('获取同步状态失败');
      logger.error('获取同步状态失败', err);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleDeepBackfill = async () => {
    if (deepBackfillStatus?.status === 'running') return;
    try {
      const data = await syncApi.triggerDeepBackfill();
      if (!data.accepted) {
        toast.error(data.message);
        return;
      }
      toast.success(data.message);
      await pollDeepBackfillStatus();
    } catch (err) {
      logger.error('深度数据回填提交失败', err);
      toast.error('回填提交失败');
    }
  };

  const pollDeepBackfillStatus = async () => {
    if (deepBackfillPollTimer) {
      clearInterval(deepBackfillPollTimer);
    }
    const fetchStatus = async () => {
      try {
        const s = await syncApi.getDeepBackfillStatus();
        setDeepBackfillStatus(s);
        if (s.status === 'done' || s.status === 'error') {
          if (deepBackfillPollTimer) {
            clearInterval(deepBackfillPollTimer);
            setDeepBackfillPollTimer(null);
          }
          if (s.status === 'done') {
            toast.success('深度数据回填完成');
          } else {
            toast.error(`回填失败：${s.errorMessage || '未知错误'}`);
          }
        }
      } catch (err) {
        logger.error('查询回填状态失败', err);
      }
    };
    await fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    setDeepBackfillPollTimer(timer);
  };

  const loadDataSources = async () => {
    setDataSourcesLoading(true);
    try {
      const data = await adminApi.getDataSources();
      setDataSources(data);
    } catch (err) {
      logger.error('加载数据源设置失败', err);
    } finally {
      setDataSourcesLoading(false);
    }
  };

  const handleSaveApiSportsKey = async () => {
    setApiSportsSaving(true);
    try {
      await adminApi.updateApiSportsKey(apiSportsKey);
      toast.success('apiSports Key 已保存，同步已触发');
      setApiSportsKey('');
      setTimeout(() => {
        void loadDataSources();
      }, 2000);
    } catch (err) {
      logger.error('保存apiSports Key失败', err);
      toast.error('保存失败，请稍后重试');
    } finally {
      setApiSportsSaving(false);
    }
  };

  const handleSaveTheRundownKey = async () => {
    setTheRundownSaving(true);
    try {
      await adminApi.updateTheRundownKey(theRundownKey);
      toast.success('TheRundown Key 已保存，同步已触发');
      setTheRundownKey('');
      setTimeout(() => {
        void loadDataSources();
      }, 2000);
    } catch (err) {
      logger.error('保存TheRundown Key失败', err);
      toast.error('保存失败，请稍后重试');
    } finally {
      setTheRundownSaving(false);
    }
  };

  const handleSaveFootballDataOrgKey = async () => {
    setFootballDataOrgSaving(true);
    try {
      await adminApi.updateFootballDataOrgKey(footballDataOrgKey);
      toast.success('football-data.org Key 已保存，同步已触发');
      setFootballDataOrgKey('');
      setTimeout(() => {
        void loadDataSources();
      }, 2000);
    } catch (err) {
      logger.error('保存football-data.org Key失败', err);
      toast.error('保存失败，请稍后重试');
    } finally {
      setFootballDataOrgSaving(false);
    }
  };

  const triggerManualSync = async () => {
    if (manualSyncLoading) return;
    setManualSyncLoading(true);
    try {
      await syncApi.triggerSync();
      toast.success('手动同步已触发');
      setTimeout(() => {
        void loadSyncHealth();
      }, 3000);
    } catch (err) {
      logger.error('手动同步失败', err);
      toast.error('同步触发失败');
    } finally {
      setManualSyncLoading(false);
    }
  };

  const loadMatches = async (targetDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await matchesApi.getMatches({ date: targetDate });
      setMatches(res.items);
    } catch (err) {
      setError('加载比赛列表失败');
      logger.error('加载比赛列表失败', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPlatformStats = async () => {
    setStatsLoading(true);
    try {
      const res = await statisticsApi.getStatsOverview();
      setPlatformStats(res);
    } catch (err) {
      logger.error('加载平台统计失败', err);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    loadMatches(date);
  }, [date]);

  useEffect(() => {
    if (activeTab === 'stats') {
      loadPlatformStats();
    }
    if (activeTab === 'sync') {
      void loadSyncHealth();
    }
    if (activeTab === 'users') {
       void loadUserStats();
       void loadUsers();
     }
      if (activeTab === 'support') {
        void loadAdminStats();
        void loadSupportTickets();
      }
      if (activeTab === 'tasks') {
        void loadAutomationTasks();
      }
      if (activeTab === 'monitor') {
        void loadMonitorOverview();
      }
      if (activeTab === 'inspection') {
        void loadAutoCheckLatest();
        void loadAutoCheckHistory(1);
      }
    }, [activeTab]);

   const loadFailedTasks = async () => {
     try {
       const data = await adminApi.getFailedTasks();
       if (data.failedCount > 0) {
         setFailedTaskAlert(data);
       } else {
         setFailedTaskAlert(null);
       }
     } catch (err) {
       logger.error('加载失败任务告警失败', err);
     }
   };

   // 失败任务告警轮询
   useEffect(() => {
     void loadFailedTasks();
     const timer = setInterval(() => {
       void loadFailedTasks();
     }, 60000);
     return () => clearInterval(timer);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   const handlePreviewRecalc = async () => {
     setPreviewLoading(true);
     setPreviewResult(null);
     try {
       const params: {
         sport: 'football' | 'basketball';
         matchStatus?: string;
         dateFrom?: string;
         dateTo?: string;
         league?: string;
       } = { sport: predictionSport };
       if (predictionStatus !== 'all') params.matchStatus = predictionStatus;
       if (predictionDateFrom) params.dateFrom = predictionDateFrom;
       if (predictionDateTo) params.dateTo = predictionDateTo;
       if (predictionLeague.trim()) params.league = predictionLeague.trim();
       const data = await adminApi.previewRecalc(params);
       setPreviewResult(data);
     } catch (err: any) {
       const msg = err?.response?.data?.error?.message || err?.message || '预览失败';
       toast.error(msg);
       logger.error('预测重算预览失败', err);
     } finally {
       setPreviewLoading(false);
     }
   };

   const handleRecalculate = async () => {
     setRecalcLoading(true);
     setRecalcResult(null);
     setRecalcConfirmOpen(false);
     try {
       const params: {
         sport: 'football' | 'basketball';
         matchStatus?: string;
         dateFrom?: string;
         dateTo?: string;
         league?: string;
       } = { sport: predictionSport };
       if (predictionStatus !== 'all') params.matchStatus = predictionStatus;
       if (predictionDateFrom) params.dateFrom = predictionDateFrom;
       if (predictionDateTo) params.dateTo = predictionDateTo;
       if (predictionLeague.trim()) params.league = predictionLeague.trim();
       const data = await adminApi.recalculatePredictions(params);
       setRecalcResult(data);
       toast.success(`重算完成：已重算 ${data.recalculated} 场`);
     } catch (err: any) {
       const msg = err?.response?.data?.error?.message || err?.message || '重算失败';
       toast.error(msg);
       logger.error('预测重算失败', err);
     } finally {
       setRecalcLoading(false);
     }
   };

    const handleRunInspection = async () => {
      setInspectionLoading(true);
      try {
        const data = await adminApi.runInspection(inspectionSport);
        setInspectionResult(data);
        toast.success('巡检完成');
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message || err?.message || '巡检失败';
        toast.error(msg);
        logger.error('数据巡检失败', err);
      } finally {
        setInspectionLoading(false);
      }
    };

    const handleRunAutoCheck = async () => {
       setAutoCheckRunning(true);
       try {
         const report = await adminApi.runBasketballAutoCheck();
         setAutoCheckLatest(report);
         await loadAutoCheckHistory(1);
         toast.success(`自动检查完成，发现 ${report.totalIssues} 项问题`);
       } catch (err: any) {
         const msg = err?.response?.data?.error?.message || err?.message || '自动检查失败';
         toast.error(msg);
         logger.error('V11自动检查失败', err);
       } finally {
         setAutoCheckRunning(false);
       }
     };

    const handleRunCoverageCheck = async () => {
      setCoverageLoading(true);
      try {
        const data = await adminApi.runSportteryCoverageCheck();
        setCoverageResult(data);
        const total = data.football.totalIssues + data.basketball.totalIssues;
        toast.success(`竞彩覆盖巡检完成，发现 ${total} 项问题`);
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message || err?.message || '巡检失败';
        toast.error(msg);
        logger.error('竞彩覆盖巡检失败', err);
      } finally {
        setCoverageLoading(false);
      }
    };

    const loadAutoCheckLatest = async () => {
      try {
        const report = await adminApi.getLatestAutoCheck();
        setAutoCheckLatest(report);
      } catch (err) {
        logger.error('加载最新自动检查报告失败', err);
      }
    };

    const loadAutoCheckHistory = async (page: number = 1) => {
      setAutoCheckLoading(true);
      try {
        const data = await adminApi.getAutoCheckReports(page, 10);
        setAutoCheckHistory(data.items);
        setAutoCheckTotal(data.total);
        setAutoCheckPage(data.page);
      } catch (err) {
        logger.error('加载自动检查历史失败', err);
      } finally {
        setAutoCheckLoading(false);
      }
    };

   const loadAutomationTasks = async () => {
     setAutomationLoading(true);
     try {
       const data = await adminApi.listAutomationTasks();
       setAutomationTasks(data.items);
     } catch (err: any) {
       const msg = err?.response?.data?.error?.message || err?.message || '加载任务列表失败';
       toast.error(msg);
       logger.error('加载自动化任务失败', err);
     } finally {
       setAutomationLoading(false);
     }
   };

   const handleToggleTask = async (taskName: string, enabled: boolean) => {
     try {
       await adminApi.toggleAutomationTask(taskName, enabled);
       toast.success(enabled ? '任务已启用' : '任务已禁用');
       void loadAutomationTasks();
     } catch (err: any) {
       const msg = err?.response?.data?.error?.message || err?.message || '操作失败';
       toast.error(msg);
       logger.error('切换任务状态失败', err);
       void loadAutomationTasks();
     }
   };

   const loadMonitorOverview = async () => {
     setMonitorLoading(true);
     try {
       const data = await adminApi.getMonitorOverview();
       setMonitorData(data);
     } catch (err: any) {
       const msg = err?.response?.data?.error?.message || err?.message || '加载监控数据失败';
       toast.error(msg);
       logger.error('加载监控大盘失败', err);
     } finally {
       setMonitorLoading(false);
     }
   };

   const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
     setDate(e.target.value);
   };

  // === 比赛 CRUD ===
  const handleAddMatchClick = () => {
    setEditingMatchId(null);
    setMatchForm({ ...defaultMatchForm, matchDate: date });
    setMatchDialogOpen(true);
  };

  const handleEditMatchClick = (match: MatchItem) => {
    setEditingMatchId(match.id);
    setMatchForm({
      matchNo: match.matchNo,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffTime: formatKickoffInput(match.kickoffTime),
      homeWinProb: String(match.homeWinProb),
      drawProb: String(match.drawProb),
      awayWinProb: String(match.awayWinProb),
      predictionDirection: match.predictionDirection,
      handicap: match.handicap,
      handicapRecommendation: match.handicapRecommendation,
      confidence: String(match.confidence),
      lowConfidence: match.lowConfidence,
      intel: match.intel,
      modelRules: (match.modelRules || []).join(','),
      matchDate: match.matchDate,
      overUnder: match.overUnder || '2.5',
      overProb: String(match.overProb ?? 50),
      underProb: String(match.underProb ?? 50),
      totalGoals: String(match.totalGoals ?? 2.5),
      mostLikelyScore: match.mostLikelyScore || '',
      scoreProbs: (match.scoreProbs || []).join(','),
      matchStatus: match.matchStatus || 'upcoming',
      homeScore: match.homeScore !== undefined ? String(match.homeScore) : '',
      awayScore: match.awayScore !== undefined ? String(match.awayScore) : '',
    });
    setMatchDialogOpen(true);
  };

  const handleMatchFormChange = (
    field: keyof MatchFormData,
    value: string | boolean,
  ) => {
    setMatchForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveMatch = async () => {
    if (!matchForm.matchNo || !matchForm.homeTeam || !matchForm.awayTeam) {
      return;
    }
    setSaving(true);
    try {
      const payload: CreateMatchRequest = {
        matchNo: matchForm.matchNo,
        league: matchForm.league,
        homeTeam: matchForm.homeTeam,
        awayTeam: matchForm.awayTeam,
        kickoffTime: matchForm.kickoffTime
          ? new Date(matchForm.kickoffTime).toISOString()
          : '',
        homeWinProb: Number(matchForm.homeWinProb) || 0,
        drawProb: Number(matchForm.drawProb) || 0,
        awayWinProb: Number(matchForm.awayWinProb) || 0,
        predictionDirection: matchForm.predictionDirection,
        handicap: matchForm.handicap,
        handicapRecommendation: matchForm.handicapRecommendation,
        confidence: Number(matchForm.confidence) || 0,
        lowConfidence: matchForm.lowConfidence,
        intel: matchForm.intel,
        modelRules: matchForm.modelRules
          ? matchForm.modelRules.split(',').map((r) => r.trim()).filter(Boolean)
          : [],
        matchDate: matchForm.matchDate,
        overUnder: matchForm.overUnder,
        overProb: Number(matchForm.overProb) || 0,
        underProb: Number(matchForm.underProb) || 0,
        totalGoals: Number(matchForm.totalGoals) || 0,
        mostLikelyScore: matchForm.mostLikelyScore,
        scoreProbs: matchForm.scoreProbs
          ? matchForm.scoreProbs.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        matchStatus: matchForm.matchStatus as any,
        homeScore: matchForm.homeScore ? Number(matchForm.homeScore) : null,
        awayScore: matchForm.awayScore ? Number(matchForm.awayScore) : null,
      };

      if (editingMatchId) {
        await matchesApi.updateMatch(editingMatchId, payload);
      } else {
        await matchesApi.createMatch(payload);
      }
      setMatchDialogOpen(false);
      loadMatches(date);
    } catch (err) {
      logger.error('保存比赛失败', err);
    } finally {
      setSaving(false);
    }
  };

  const handleScoreUpdate = async () => {
    if (!scoreMatchId) return;
    setScoreSaving(true);
    try {
      await matchesApi.updateMatch(scoreMatchId, {
        homeScore: Number(scoreForm.homeScore),
        awayScore: Number(scoreForm.awayScore),
        matchStatus: scoreForm.matchStatus as any,
      });
      toast.success('赛果回填成功');
      setScoreDialogOpen(false);
      loadMatches(date);
    } catch (err) {
      logger.error('回填赛果失败', err);
      toast.error('回填失败');
    } finally {
      setScoreSaving(false);
    }
  };

  const handleOpenScoreDialog = (match: MatchItem) => {
    setScoreMatchId(match.id);
    setScoreMatchName(`${match.homeTeam} vs ${match.awayTeam}`);
    setScoreForm({
      homeScore: match.homeScore ?? 0,
      awayScore: match.awayScore ?? 0,
      matchStatus: match.matchStatus === 'upcoming' ? 'finished' : match.matchStatus,
    });
    setScoreDialogOpen(true);
  };

  const handleDeleteMatch = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await matchesApi.deleteMatch(deleteId);
      setDeleteId(null);
      loadMatches(date);
    } catch (err) {
      logger.error('删除比赛失败', err);
    } finally {
      setDeleting(false);
    }
  };

  // === 指数管理 ===
  const handleAddOddsClick = () => {
    setOddsForm({
      ...defaultOddsForm,
      matchId: matches.length > 0 ? matches[0].id : '',
      snapshotTime: formatDateTimeInput(new Date().toISOString()),
    });
    setOddsDialogOpen(true);
  };

  const handleOddsFormChange = (
    field: keyof OddsFormData,
    value: string,
  ) => {
    setOddsForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveOdds = async () => {
    if (!oddsForm.matchId) return;
    setOddsSaving(true);
    try {
      // 占位 API 调用
      await axiosForBackend({
        url: `/api/matches/${oddsForm.matchId}/odds`,
        method: 'POST',
        data: {
          oddsType: oddsForm.oddsType,
          isInitial: oddsForm.isInitial === 'initial',
          bookmaker: oddsForm.bookmaker,
          homeValue: oddsForm.homeValue ? Number(oddsForm.homeValue) : undefined,
          drawValue: oddsForm.drawValue ? Number(oddsForm.drawValue) : undefined,
          awayValue: oddsForm.awayValue ? Number(oddsForm.awayValue) : undefined,
          handicapValue: oddsForm.handicapValue,
          totalLine: oddsForm.totalLine ? Number(oddsForm.totalLine) : undefined,
          overValue: oddsForm.overValue ? Number(oddsForm.overValue) : undefined,
          underValue: oddsForm.underValue ? Number(oddsForm.underValue) : undefined,
          snapshotTime: new Date(oddsForm.snapshotTime).toISOString(),
        },
      });
      setOddsDialogOpen(false);
    } catch (err) {
       logger.error('保存指数失败', err);
    } finally {
      setOddsSaving(false);
    }
  };

  // === 批量导入 ===
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportResult(null);

    // 读取文件预览
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          setImportPreview(Array.isArray(data) ? data.slice(0, 5) : []);
        } else if (file.name.endsWith('.csv')) {
          // 简单 CSV 解析
          const lines = content.split('\n').filter((l) => l.trim());
          const headers = lines[0].split(',');
          const preview = lines.slice(1, 6).map((line) => {
            const values = line.split(',');
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => {
              obj[h.trim()] = values[i]?.trim() || '';
            });
            return obj;
          });
          setImportPreview(preview);
        }
      } catch (err) {
        logger.error('解析导入文件失败', err);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      // 占位：实际后端导入接口
      setImportResult(
        `导入完成：成功 0 条，失败 0 条（演示模式，接口待接入）`,
      );
    } catch (err) {
      logger.error('批量导入失败', err);
      setImportResult('导入失败，请检查文件格式');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 pb-20 pt-4 md:px-6">
      {/* 顶部标题 */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-foreground">后台管理</h1>
        <p className="mt-1 text-xs text-muted-foreground">
           管理比赛、指数、伤停等数据
        </p>
       </div>

       {/* 失败任务告警条 */}
       {failedTaskAlert && failedTaskAlert.failedCount > 0 && (
         <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
           <div className="flex items-center gap-2">
             <AlertTriangle className="h-5 w-5 flex-shrink-0" />
             <span className="text-sm font-medium">
               有 {failedTaskAlert.failedCount} 个同步任务执行失败
             </span>
           </div>
           <div className="flex items-center gap-3">
             {failedTaskAlert.items[0] && (
               <span className="text-xs text-red-600">
                 最近失败：{failedTaskAlert.items[0].taskName}
               </span>
             )}
             <Button
               variant="destructive"
               size="sm"
               className="h-7 bg-red-600 text-xs hover:bg-red-700"
               onClick={() => setActiveTab('monitor')}
             >
               查看详情
             </Button>
           </div>
         </div>
       )}

       {/* Tab 切换 */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AdminTab)}>
        <TabsList className="w-full flex-wrap h-auto">
          <TabsTrigger value="matches" className="flex-1 min-w-[80px]">
             <Trophy className="h-4 w-4" />
             <span className="hidden sm:inline">比赛管理</span>
             <span className="sm:hidden">比赛</span>
           </TabsTrigger>
           <TabsTrigger value="basketball" className="flex-1 min-w-[80px]">
             <Dumbbell className="h-4 w-4" />
             <span className="hidden sm:inline">篮球比赛</span>
             <span className="sm:hidden">篮球</span>
           </TabsTrigger>
           <TabsTrigger value="odds" className="flex-1 min-w-[80px]">
            <Activity className="h-4 w-4" />
             <span className="hidden sm:inline">指数管理</span>
             <span className="sm:hidden">指数</span>
          </TabsTrigger>
           <TabsTrigger value="stats" className="flex-1 min-w-[80px]">
             <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">数据统计</span>
            <span className="sm:hidden">统计</span>
          </TabsTrigger>
           <TabsTrigger value="import" className="flex-1 min-w-[80px]">
             <Upload className="h-4 w-4" />
             <span className="hidden sm:inline">批量导入</span>
             <span className="sm:hidden">导入</span>
           </TabsTrigger>
           <TabsTrigger value="sync" className="flex-1 min-w-[80px]">
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">同步状态</span>
              <span className="sm:hidden">同步</span>
            </TabsTrigger>
             <TabsTrigger value="users" className="flex-1 min-w-[80px]">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">用户管理</span>
                <span className="sm:hidden">用户</span>
              </TabsTrigger>
             <TabsTrigger value="audit" className="flex-1 min-w-[80px]">
               <ClipboardList className="h-4 w-4" />
               <span className="hidden sm:inline">审计日志</span>
               <span className="sm:hidden">审计</span>
             </TabsTrigger>
             <TabsTrigger value="prediction" className="flex-1 min-w-[80px]">
               <Target className="h-4 w-4" />
               <span className="hidden sm:inline">预测管理</span>
               <span className="sm:hidden">预测</span>
             </TabsTrigger>
             <TabsTrigger value="inspection" className="flex-1 min-w-[80px]">
               <Search className="h-4 w-4" />
               <span className="hidden sm:inline">数据巡检</span>
               <span className="sm:hidden">巡检</span>
             </TabsTrigger>
             <TabsTrigger value="tasks" className="flex-1 min-w-[80px]">
               <Settings2 className="h-4 w-4" />
               <span className="hidden sm:inline">任务管理</span>
               <span className="sm:hidden">任务</span>
             </TabsTrigger>
             <TabsTrigger value="monitor" className="flex-1 min-w-[80px]">
               <BarChart3 className="h-4 w-4" />
               <span className="hidden sm:inline">监控大盘</span>
               <span className="sm:hidden">监控</span>
             </TabsTrigger>
              <TabsTrigger value="support" className="flex-1 min-w-[80px] relative">
               <Headphones className="h-4 w-4" />
               <span className="hidden sm:inline">客服</span>
               <span className="sm:hidden">客服</span>
               {unreadSupportCount > 0 && (
                 <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                   {unreadSupportCount > 99 ? '99+' : unreadSupportCount}
                 </span>
               )}
             </TabsTrigger>
         </TabsList>

        {/* === Tab 1: 比赛数据管理 === */}
        <TabsContent value="matches" className="mt-4">
          {/* 顶部操作栏 */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="match-date" className="text-sm text-muted-foreground">
                  日期
                </Label>
              </div>
              <Input
                id="match-date"
                type="date"
                value={date}
                onChange={handleDateChange}
                className="w-auto"
              />
            </div>
            <Button onClick={handleAddMatchClick} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加比赛
            </Button>
          </div>

          {/* 比赛列表 */}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            {loading && (
              <div className="p-8 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="mt-3 text-sm text-muted-foreground">加载中...</p>
              </div>
            )}

            {!loading && error && (
              <div className="p-8 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => loadMatches(date)}
                >
                  重试
                </Button>
              </div>
            )}

            {!loading && !error && matches.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-sm text-muted-foreground">暂无比赛数据</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleAddMatchClick}
                >
                  添加第一场比赛
                </Button>
              </div>
            )}

            {!loading && !error && matches.length > 0 && (
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="text-muted-foreground">编号</TableHead>
                    <TableHead className="text-muted-foreground">联赛</TableHead>
                    <TableHead className="text-muted-foreground">对阵</TableHead>
                    <TableHead className="text-muted-foreground">时间</TableHead>
                     <TableHead className="text-muted-foreground">分析</TableHead>
                     <TableHead className="text-muted-foreground">参考</TableHead>
                    <TableHead className="text-muted-foreground">状态</TableHead>
                    <TableHead className="text-right text-muted-foreground">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const dupSet = buildDuplicateMatchNoSet(matches);
                    return matches.map((match) => (
                      <TableRow key={match.id}>
                        <TableCell>
                          <MatchNoCell
                            matchNo={match.matchNo}
                            source={match.source}
                            league={match.league}
                            isDuplicate={dupSet.has(match.matchNo)}
                          />
                        </TableCell>
                      <TableCell className="text-sm">{match.league}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {match.homeTeam} vs {match.awayTeam}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatKickoffDisplay(match.kickoffTime)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-sm font-medium ${
                            DIRECTION_STYLES[match.predictionDirection] ??
                            DIRECTION_STYLES['观望']
                          }`}
                        >
                          {match.predictionDirection}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {match.confidence}%
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={STATUS_BADGE[match.matchStatus]}
                        >
                          {STATUS_OPTIONS.find((s) => s.value === match.matchStatus)?.label || match.matchStatus}
                        </Badge>
                      </TableCell>
                       <TableCell className="text-right">
                         <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenScoreDialog(match)}
                              aria-label="回填赛果"
                              className="h-8 w-8"
                              title="回填赛果"
                            >
                              <Trophy className="h-4 w-4 text-accent" />
                            </Button>
                           <Button
                             variant="ghost"
                             size="icon"
                             onClick={() => handleEditMatchClick(match)}
                             aria-label="编辑"
                             className="h-8 w-8"
                           >
                             <Edit2 className="h-4 w-4 text-muted-foreground" />
                           </Button>
                          <AlertDialog
                            open={deleteId === match.id}
                            onOpenChange={(open) => {
                              if (!open) setDeleteId(null);
                            }}
                          >
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteId(match.id)}
                                aria-label="删除"
                                className="h-8 w-8"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="border-border bg-card">
                              <AlertDialogHeader>
                                <AlertDialogTitle>确认删除</AlertDialogTitle>
                                <AlertDialogDescription>
                                  确定要删除比赛「{match.homeTeam} vs {match.awayTeam}」吗？此操作不可撤销。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleting}>
                                  取消
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="border border-destructive-border bg-destructive text-destructive-foreground"
                                  onClick={handleDeleteMatch}
                                  disabled={deleting}
                                >
                                  {deleting ? '删除中...' : '删除'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ));
                })()}
                </TableBody>
              </Table>
            )}
          </div>
         </TabsContent>

         {/* === Tab: 篮球比赛管理 === */}
         <TabsContent value="basketball" className="mt-4">
           {/* 顶部操作栏 */}
           <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
             <div className="flex items-center gap-3">
               <div className="flex items-center gap-2">
                 <Calendar className="h-4 w-4 text-muted-foreground" />
                 <Label htmlFor="bball-date" className="text-sm text-muted-foreground">
                   日期
                 </Label>
               </div>
               <Input
                 id="bball-date"
                 type="date"
                 value={bballDate}
                 onChange={handleBballDateChange}
                 className="w-auto"
               />
             </div>
             <Button onClick={handleBballAddClick} className="gap-1.5">
               <Plus className="h-4 w-4" />
               添加比赛
             </Button>
           </div>

           {/* 篮球比赛列表 */}
           <div className="overflow-x-auto rounded-xl border border-border bg-card">
             {bballLoading && (
               <div className="p-8 text-center">
                 <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                 <p className="mt-3 text-sm text-muted-foreground">加载中...</p>
               </div>
             )}

             {!bballLoading && bballError && (
               <div className="p-8 text-center">
                 <p className="text-sm text-destructive">{bballError}</p>
                 <Button
                   variant="outline"
                   size="sm"
                   className="mt-3"
                   onClick={() => loadBballMatches(bballDate)}
                 >
                   重试
                 </Button>
               </div>
             )}

             {!bballLoading && !bballError && bballMatches.length === 0 && (
               <div className="p-12 text-center">
                 <p className="text-sm text-muted-foreground">暂无篮球比赛数据</p>
                 <Button
                   variant="outline"
                   size="sm"
                   className="mt-3"
                   onClick={handleBballAddClick}
                 >
                   添加第一场比赛
                 </Button>
               </div>
             )}

             {!bballLoading && !bballError && bballMatches.length > 0 && (
               <Table>
                 <TableHeader className="bg-muted">
                   <TableRow>
                     <TableHead className="text-muted-foreground">编号</TableHead>
                     <TableHead className="text-muted-foreground">联赛</TableHead>
                     <TableHead className="text-muted-foreground">对阵</TableHead>
                     <TableHead className="text-muted-foreground">时间</TableHead>
                     <TableHead className="text-muted-foreground">让分盘</TableHead>
                     <TableHead className="text-muted-foreground">总分盘</TableHead>
                     <TableHead className="text-muted-foreground">模型倾向</TableHead>
                     <TableHead className="text-muted-foreground">状态</TableHead>
                     <TableHead className="text-right text-muted-foreground">操作</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                    {(() => {
                      const dupSet = buildDuplicateMatchNoSet(bballMatches);
                      return bballMatches.map((match: AdminBasketballMatchListItem) => (
                        <TableRow key={match.id}>
                          <TableCell>
                            <MatchNoCell
                              matchNo={match.matchNo}
                              source={match.source}
                              league={match.league}
                              isDuplicate={dupSet.has(match.matchNo)}
                            />
                          </TableCell>
                       <TableCell className="text-sm">{match.league}</TableCell>
                       <TableCell className="text-sm font-medium">
                         {match.homeTeam} vs {match.awayTeam}
                       </TableCell>
                       <TableCell className="font-mono text-sm">
                         {formatKickoffDisplay(match.kickoffTime)}
                       </TableCell>
                       <TableCell className="font-mono text-sm">
                         {match.handicap}
                       </TableCell>
                       <TableCell className="font-mono text-sm">
                         {match.totalLine}
                       </TableCell>
                       <TableCell>
                         <span
                           className={`text-sm font-medium ${
                             DIRECTION_STYLES[match.predictionDirection] ??
                             DIRECTION_STYLES['观望']
                           }`}
                         >
                           {match.predictionDirection}
                         </span>
                       </TableCell>
                       <TableCell>
                         <Badge
                           variant="secondary"
                           className={STATUS_BADGE[match.matchStatus] || 'bg-muted text-muted-foreground'}
                         >
                           {STATUS_OPTIONS.find((s) => s.value === match.matchStatus)?.label || match.matchStatus}
                         </Badge>
                       </TableCell>
                       <TableCell className="text-right">
                         <div className="flex justify-end gap-1">
                           <Button
                             variant="ghost"
                             size="icon"
                             onClick={() => handleBballOpenScoreDialog(match)}
                             aria-label="更新比分"
                             className="h-8 w-8"
                             title="更新比分"
                           >
                             <Trophy className="h-4 w-4 text-accent" />
                           </Button>
                           <Button
                             variant="ghost"
                             size="icon"
                             onClick={() => handleBballEditClick(match)}
                             aria-label="编辑"
                             className="h-8 w-8"
                           >
                             <Edit2 className="h-4 w-4 text-muted-foreground" />
                           </Button>
                           <AlertDialog
                             open={bballDeleteId === match.id}
                             onOpenChange={(open) => {
                               if (!open) setBballDeleteId(null);
                             }}
                           >
                             <AlertDialogTrigger asChild>
                               <Button
                                 variant="ghost"
                                 size="icon"
                                 onClick={() => setBballDeleteId(match.id)}
                                 aria-label="删除"
                                 className="h-8 w-8"
                               >
                                 <Trash2 className="h-4 w-4 text-destructive" />
                               </Button>
                             </AlertDialogTrigger>
                             <AlertDialogContent className="border-border bg-card">
                               <AlertDialogHeader>
                                 <AlertDialogTitle>确认删除</AlertDialogTitle>
                                 <AlertDialogDescription>
                                   确定要删除篮球比赛「{match.homeTeam} vs {match.awayTeam}」吗？此操作不可撤销。
                                 </AlertDialogDescription>
                               </AlertDialogHeader>
                               <AlertDialogFooter>
                                 <AlertDialogCancel disabled={bballDeleting}>
                                   取消
                                 </AlertDialogCancel>
                                 <AlertDialogAction
                                   className="border border-destructive-border bg-destructive text-destructive-foreground"
                                   onClick={handleBballDeleteMatch}
                                   disabled={bballDeleting}
                                 >
                                   {bballDeleting ? '删除中...' : '删除'}
                                 </AlertDialogAction>
                               </AlertDialogFooter>
                             </AlertDialogContent>
                           </AlertDialog>
                         </div>
                       </TableCell>
                      </TableRow>
                    ));
                  })()}
                  </TableBody>
               </Table>
             )}
           </div>

           {/* 分页 */}
           {bballTotal > 0 && (
             <div className="mt-3 flex items-center justify-between">
               <span className="text-xs text-muted-foreground">
                 共 {bballTotal} 条，第 {bballPage}/{totalBballPages} 页
               </span>
               <div className="flex items-center gap-1">
                 <Button
                   variant="outline"
                   size="sm"
                   className="h-8 w-8 p-0"
                   onClick={() => setBballPage((p: number) => Math.max(1, p - 1))}
                   disabled={bballPage <= 1 || bballLoading}
                 >
                   <ChevronLeft className="h-4 w-4" />
                 </Button>
                 <Button
                   variant="outline"
                   size="sm"
                   className="h-8 w-8 p-0"
                   onClick={() => setBballPage((p: number) => Math.min(totalBballPages, p + 1))}
                   disabled={bballPage >= totalBballPages || bballLoading}
                 >
                   <ChevronRight className="h-4 w-4" />
                 </Button>
               </div>
             </div>
           )}
         </TabsContent>

          {/* === Tab 2: 指数数据管理 === */}
        <TabsContent value="odds" className="mt-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
               管理比赛指数数据，支持1x2、让分、进球数等类型
            </p>
            <Button onClick={handleAddOddsClick} className="gap-1.5">
              <Plus className="h-4 w-4" />
               录入指数
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Activity className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
               指数数据管理功能
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
               点击上方按钮录入新的指数快照
            </p>
          </div>
        </TabsContent>

        {/* === Tab 3: 数据统计（平台视角） === */}
        <TabsContent value="stats" className="mt-4 space-y-5">
           {statsLoading && (
             <div className="rounded-xl border border-border bg-card p-12 text-center">
               <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
               <p className="mt-3 text-sm text-muted-foreground">统计数据加载中...</p>
             </div>
           )}

           {!statsLoading && !platformStats && (
             <div className="rounded-xl border border-border bg-card p-12 text-center">
               <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
               <p className="mt-3 text-sm text-muted-foreground">统计数据加载失败</p>
             </div>
           )}

           {!statsLoading && platformStats && (<>{
             /* 核心指标卡片 */
           }<div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-ai-section-type="card-stat">
             <div className="rounded-xl border border-border bg-card p-4">
               <div className="flex items-center gap-2 text-xs text-muted-foreground">
                 <Users className="h-3.5 w-3.5" />
                 <span>总比赛场次</span>
               </div>
               <div className="mt-2 text-2xl font-mono font-bold text-foreground">
                 {platformStats.totalMatches.toLocaleString()}
               </div>
             </div>
             <div className="rounded-xl border border-border bg-card p-4">
               <div className="flex items-center gap-2 text-xs text-muted-foreground">
                 <Eye className="h-3.5 w-3.5" />
                  <span>已完赛场次</span>
               </div>
               <div className="mt-2 text-2xl font-mono font-bold text-foreground">
                 {platformStats.finishedMatches.toLocaleString()}
               </div>
             </div>
             <div className="rounded-xl border border-border bg-card p-4">
               <div className="flex items-center gap-2 text-xs text-muted-foreground">
                 <Trophy className="h-3.5 w-3.5" />
                   <span>赛果方向准确率</span>
               </div>
               <div className="mt-2 text-2xl font-mono font-bold text-primary">
                 {platformStats.winDrawWinHitRate}%
               </div>
             </div>
             <div className="rounded-xl border border-border bg-card p-4">
               <div className="flex items-center gap-2 text-xs text-muted-foreground">
                 <Zap className="h-3.5 w-3.5" />
                    <span>让分准确率</span>
               </div>
               <div className="mt-2 text-2xl font-mono font-bold text-home-win">
                 {platformStats.handicapHitRate}%
               </div>
             </div>
           </div>

           {/* 联赛准确率排行 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">
                 联赛准确率排行
              </h3>
              <div className="space-y-3">
                {platformStats.byLeague.map((item, idx) => (
                  <div key={item.league} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-mono text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="text-foreground">{item.league}</span>
                      </div>
                      <span className="text-muted-foreground">
                        <span className="font-mono">{item.count}场</span>
                        <span className="mx-1.5 text-muted-foreground/40">|</span>
                        <span className="font-mono text-home-win">
                          {item.hitRate}%
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${item.hitRate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
           </>)}
         </TabsContent>

         {/* === Tab 4: 批量导入 === */}
        <TabsContent value="import" className="mt-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-2 text-base font-semibold text-foreground">
              批量导入比赛数据
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              支持 JSON 和 CSV 格式，文件将根据比赛编号去重更新
            </p>

            {/* 格式说明 */}
            <div className="mb-4 rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Info className="h-4 w-4 text-primary" />
                <span>格式说明</span>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>• JSON 格式：数组形式，每个对象包含比赛字段</li>
                <li>• CSV 格式：第一行为表头，字段名与 API 一致（camelCase）</li>
                <li>• 必填字段：matchNo, league, homeTeam, awayTeam, kickoffTime</li>
                <li>• 已有比赛（matchNo 相同）将被更新，不存在的将新增</li>
              </ul>
            </div>

            {/* 上传区域 */}
            <div className="mb-4">
              <Label className="text-sm text-foreground">选择文件</Label>
              <div className="mt-2">
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 px-6 py-8 transition-colors hover:border-primary/50 hover:bg-muted/40">
                  <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">
                    {importFile ? importFile.name : '点击或拖拽文件到此处'}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    支持 .json 和 .csv 格式
                  </span>
                  <input
                    type="file"
                    accept=".json,.csv"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </label>
              </div>
            </div>

            {/* 预览 */}
            {importPreview.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-sm text-foreground">数据预览（前5条）</Label>
                  <Badge variant="secondary" className="bg-muted text-muted-foreground">
                    {importPreview.length} 条预览
                  </Badge>
                </div>
                <div className="max-h-48 overflow-auto rounded-lg border border-border">
                  <pre className="p-3 text-xs text-muted-foreground">
                    {JSON.stringify(importPreview, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* 导入结果 */}
            {importResult && (
              <div
                className={`mb-4 rounded-lg border p-3 text-sm ${
                  importResult.includes('失败')
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-home-win/30 bg-home-win/10 text-home-win'
                }`}
              >
                {importResult}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <Button
                onClick={handleImport}
                disabled={!importFile || importing}
                className="gap-1.5"
              >
                {importing ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    导入中...
                  </>
                ) : (
                  <>
                    <FileJson className="h-4 w-4" />
                    开始导入
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImportFile(null);
                  setImportPreview([]);
                  setImportResult(null);
                }}
                disabled={importing}
              >
                清除
              </Button>
            </div>
          </div>
         </TabsContent>

         {/* === Tab 5: 同步状态 === */}
         <TabsContent value="sync" className="mt-4 space-y-4">
           <div className="flex items-center justify-between">
             <div className="flex items-center gap-2">
               <Activity className="h-5 w-5 text-primary" />
               <h2 className="text-base font-semibold text-foreground">数据同步状态</h2>
             </div>
             <Button
               variant="outline"
               size="sm"
               onClick={() => void loadSyncHealth()}
               disabled={syncLoading}
             >
               {syncLoading ? (
                 <Loader2 className="h-4 w-4 animate-spin" />
               ) : (
                 <RefreshCw className="h-4 w-4" />
               )}
               <span className="ml-1">刷新</span>
             </Button>
           </div>

           {syncLoading && !syncHealth && (
             <div className="bg-card border border-border rounded-xl p-8 text-center">
               <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
               <p className="text-sm text-muted-foreground">加载中...</p>
             </div>
           )}

           {syncError && !syncHealth && (
             <div className="bg-card border border-destructive/30 rounded-xl p-8 text-center">
               <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
               <p className="text-sm text-destructive font-medium">{syncError}</p>
               <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadSyncHealth()}>
                 重试
               </Button>
             </div>
           )}

           {syncHealth && (
             <>
                {/* 调度器状态 */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">调度器状态</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {syncHealth.schedulerRunning ? (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-home-win opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-home-win" />
                        </span>
                        <span className="text-sm font-medium text-home-win">运行中</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-destructive" />
                        <span className="text-sm font-medium text-destructive">已停止</span>
                      </>
                    )}
                    <span className="text-xs text-muted-foreground ml-2">
                      {syncHealth.source === 'hybrid' ? '混合模式' : syncHealth.source === 'external' ? '外部源' : '官方数据源直连'}
                    </span>
                    <div className="ml-auto">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => void triggerManualSync()}
                        disabled={manualSyncLoading}
                        className="h-7 text-xs"
                      >
                        {manualSyncLoading && (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        )}
                        立即同步
                      </Button>
                    </div>
                  </div>
                </div>

                {/* SYNC_API_TOKEN 未配置提示 */}
                {!syncHealth.syncTokenConfigured && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-amber-800 mb-1">
                          官方数据同步未启用
                        </h3>
                        <p className="text-xs text-amber-700 mb-2">
                           SYNC_API_TOKEN 环境变量未配置，官方数据外部推送接口暂不可用。
                          请在妙搭部署后台 → 环境变量中添加以下变量：
                        </p>
                        <div className="bg-amber-100/60 rounded px-3 py-2 font-mono text-xs text-amber-800">
                          SYNC_API_TOKEN=你的32位以上密钥
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ESPN 实时比分 */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Wifi className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">ESPN 实时比分</h3>
                    <Badge variant="secondary" className="text-[10px] h-5">比分源</Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1">足球节奏</div>
                      <div className="flex items-center gap-2">
                        <Badge className={syncHealth.sources.espnFootball.rhythm === 'live' ? 'bg-destructive text-white' : syncHealth.sources.espnFootball.rhythm === 'upcoming' ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}>
                          {syncHealth.sources.espnFootball.rhythm === 'live' ? `直播 (30s)` : syncHealth.sources.espnFootball.rhythm === 'upcoming' ? `赛前 (5m)` : '空闲 (30m)'}
                        </Badge>
                        <span className="text-muted-foreground/80">{syncHealth.sources.espnFootball.leaguesSynced} 个联赛</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">篮球节奏</div>
                      <div className="flex items-center gap-2">
                        <Badge className={syncHealth.sources.espnBasketball.rhythm === 'live' ? 'bg-destructive text-white' : syncHealth.sources.espnBasketball.rhythm === 'upcoming' ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}>
                          {syncHealth.sources.espnBasketball.rhythm === 'live' ? `直播 (30s)` : syncHealth.sources.espnBasketball.rhythm === 'upcoming' ? `赛前 (5m)` : '空闲 (30m)'}
                        </Badge>
                        <span className="text-muted-foreground/80">{syncHealth.sources.espnBasketball.leaguesSynced} 个联赛</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">足球最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.espnFootball.lastSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.espnFootball.lastSyncAt)
                          : '从未同步'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">篮球最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.espnBasketball.lastSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.espnBasketball.lastSyncAt)
                          : '从未同步'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">足球下次同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.espnFootball.nextSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.espnFootball.nextSyncAt)
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">篮球下次同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.espnBasketball.nextSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.espnBasketball.nextSyncAt)
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">今日同步次数</div>
                      <div className="font-mono text-foreground">
                        ⚽ {syncHealth.espnFootballTodayCount ?? 0} 次 · 🏀 {syncHealth.espnBasketballTodayCount ?? 0} 次
                      </div>
                    </div>
                  </div>
                </div>

                {/* 官方数据源 / 足球二台 数据源卡片 */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* 官方·足球 */}
                  <div className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">官方·足球</h3>
                      <Badge
                        className={
                          syncHealth.sources.sportteryExternal.directStatus === 'auto'
                            ? 'bg-home-win text-white'
                            : 'bg-accent text-white'
                        }
                      >
                        {syncHealth.sources.sportteryExternal.directStatus === 'auto'
                          ? '直连正常'
                          : '外部推送通道'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-muted-foreground mb-1">模式</div>
                        <div className="text-foreground">
                          {syncHealth.sources.sportteryExternal.directStatus === 'auto'
                            ? '自动直连'
                            : '外部推送通道'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">总比赛数</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.footballCount ?? 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">最后推送时间</div>
                        <div className="font-mono text-foreground/80">
                          {syncHealth.sources.sportteryExternal.lastSyncAt
                            ? formatBeijingTimeShort(syncHealth.sources.sportteryExternal.lastSyncAt)
                            : '暂无推送记录'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">今日推送次数</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.sources.sportteryExternal.todayCount ?? 0} 次
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">轮询间隔</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.sources.sportteryExternal.scheduleIntervalLabel ?? '10分钟'}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground mb-1">同步写入</div>
                        <div className={syncHealth.syncTokenConfigured ? 'text-home-win' : 'text-amber-600'}>
                          {syncHealth.syncTokenConfigured ? '已启用' : '未启用（请配置 SYNC_API_TOKEN）'}
                        </div>
                      </div>
                      {syncHealth.sources.sportteryExternal.lastError && (
                        <div className="col-span-2">
                          <div className="text-muted-foreground mb-1">最近错误</div>
                          <div className="text-destructive text-xs font-mono break-all">
                            {syncHealth.sources.sportteryExternal.lastError}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 官方·篮球 */}
                  <div className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Dumbbell className="w-4 h-4 text-accent" />
                      <h3 className="text-sm font-semibold text-foreground">官方·篮球</h3>
                      <Badge
                        className={
                          syncHealth.sources.sportteryExternal.directStatus === 'auto'
                            ? 'bg-home-win text-white'
                            : 'bg-accent text-white'
                        }
                      >
                        {syncHealth.sources.sportteryExternal.directStatus === 'auto'
                          ? '直连正常'
                          : '外部推送通道'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                        <div className="text-muted-foreground mb-1">模式</div>
                        <div className="text-foreground">
                          {syncHealth.sources.sportteryExternal.directStatus === 'auto'
                            ? '自动直连'
                            : '外部推送通道'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">总比赛数</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.basketballCount ?? 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">最后推送时间</div>
                        <div className="font-mono text-foreground/80">
                          {syncHealth.sources.sportteryExternal.lastSyncAt
                            ? formatBeijingTimeShort(syncHealth.sources.sportteryExternal.lastSyncAt)
                            : '暂无推送记录'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">今日推送次数</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.sources.sportteryExternal.todayCount ?? 0} 次
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">轮询间隔</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.sources.sportteryExternal.scheduleIntervalLabel ?? '10分钟'}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground mb-1">同步写入</div>
                        <div className={syncHealth.syncTokenConfigured ? 'text-home-win' : 'text-amber-600'}>
                          {syncHealth.syncTokenConfigured ? '已启用' : '未启用（请配置 SYNC_API_TOKEN）'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 足球二台 */}
                  <div className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Trophy className="w-4 h-4 text-info" />
                      <h3 className="text-sm font-semibold text-foreground">足球二台</h3>
                      <Badge
                        className={
                          syncHealth.sources.beidan.enabled && syncHealth.sources.beidan.success
                            ? 'bg-home-win text-white'
                            : syncHealth.sources.beidan.enabled
                              ? 'bg-accent text-white'
                              : 'bg-muted text-muted-foreground'
                        }
                      >
                        {syncHealth.sources.beidan.enabled && syncHealth.sources.beidan.success
                          ? '已接入'
                          : syncHealth.sources.beidan.enabled
                            ? '接入中'
                            : '未接入'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-muted-foreground mb-1">状态</div>
                        <div className="text-foreground">
                          {syncHealth.sources.beidan.enabled && syncHealth.sources.beidan.success
                            ? '已接入'
                            : syncHealth.sources.beidan.enabled
                              ? '接入中'
                              : '未接入'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">总比赛数</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.beidanCount ?? 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">最后推送时间</div>
                        <div className="font-mono text-foreground/80">
                          {syncHealth.sources.beidan.lastSyncAt
                            ? formatBeijingTimeShort(syncHealth.sources.beidan.lastSyncAt)
                            : '暂无记录'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">今日推送次数</div>
                        <div className="font-mono text-foreground">
                          {syncHealth.sources.beidan.todayCount ?? 0} 次
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground mb-1">同步写入</div>
                        <div className={syncHealth.syncTokenConfigured ? 'text-home-win' : 'text-amber-600'}>
                          {syncHealth.syncTokenConfigured ? '已启用' : '未启用（请配置 SYNC_API_TOKEN）'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* The Odds API */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="w-4 h-4 text-info" />
                    <h3 className="text-sm font-semibold text-foreground">The Odds API（指数）</h3>
                     <Badge variant="secondary" className="text-[10px] h-5">指数源</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1">状态</div>
                      <Badge className={syncHealth.sources.oddsApi.enabled ? 'bg-home-win text-white' : 'bg-muted text-muted-foreground'}>
                        {syncHealth.sources.oddsApi.enabled ? '已启用' : '未配置'}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">节奏</div>
                      <div className="text-foreground">
                        {syncHealth.sources.oddsApi.rhythm === 'pre-match' ? '赛前模式 (15m)' : syncHealth.sources.oddsApi.rhythm === 'daily' ? '每日模式 (1h)' : '空闲 (6h)'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">已同步运动</div>
                      <div className="font-mono text-foreground">{syncHealth.sources.oddsApi.sportsSynced} 个</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.oddsApi.lastSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.oddsApi.lastSyncAt)
                          : '从未'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">下次同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.oddsApi.nextSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.oddsApi.nextSyncAt)
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">今日同步次数</div>
                      <div className="font-mono text-foreground">{syncHealth.oddsApiTodayCount ?? 0} 次</div>
                    </div>
                    {syncHealth.sources.oddsApi.remaining !== null && (
                      <div>
                        <div className="text-muted-foreground mb-1">剩余配额</div>
                        <div className="font-mono text-foreground">{syncHealth.sources.oddsApi.remaining}</div>
                      </div>
                    )}
                      {syncHealth.sources.oddsApi.quotaExhausted && (
                        <div className="col-span-2 mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                          <div className="text-amber-700 text-xs font-medium">
                             ⚠ 指数额度用尽，指数以官方/球美宝为准
                          </div>
                        </div>
                      )}
                      {syncHealth.sources.oddsApi.quotaThrottled && (
                        <div>
                          <div className="text-muted-foreground mb-1">配额状态</div>
                          <div className="text-accent font-medium">限流中</div>
                        </div>
                      )}
                  </div>
                </div>

                {/* 球美宝（比分·赛程） */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-accent" />
                    <h3 className="text-sm font-semibold text-foreground">球美宝（比分·赛程）</h3>
                    <Badge variant="secondary" className="text-[10px] h-5">双源备份</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    {/* 足球状态 */}
                    <div>
                      <div className="text-muted-foreground mb-1">足球状态</div>
                      <div className="flex items-center gap-2">
                        <Badge className={syncHealth.sources.qiumibao.football.success ? 'bg-home-win text-white' : 'bg-destructive text-white'}>
                          {syncHealth.sources.qiumibao.football.success ? '正常' : '异常'}
                        </Badge>
                      </div>
                    </div>
                    {/* 篮球状态 */}
                    <div>
                      <div className="text-muted-foreground mb-1">篮球状态</div>
                      <div className="flex items-center gap-2">
                        <Badge className={syncHealth.sources.qiumibao.basketball.success ? 'bg-home-win text-white' : 'bg-destructive text-white'}>
                          {syncHealth.sources.qiumibao.basketball.success ? '正常' : '异常'}
                        </Badge>
                      </div>
                    </div>
                    {/* 足球节奏 */}
                    <div>
                      <div className="text-muted-foreground mb-1">足球节奏</div>
                      <Badge className={syncHealth.sources.qiumibao.football.rhythm === 'live' ? 'bg-destructive text-white' : syncHealth.sources.qiumibao.football.rhythm === 'upcoming' ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}>
                        {syncHealth.sources.qiumibao.football.rhythm === 'live' ? '直播 (45s)' : syncHealth.sources.qiumibao.football.rhythm === 'upcoming' ? '赛前 (90s)' : '空闲 (5m)'}
                      </Badge>
                    </div>
                    {/* 篮球节奏 */}
                    <div>
                      <div className="text-muted-foreground mb-1">篮球节奏</div>
                      <Badge className={syncHealth.sources.qiumibao.basketball.rhythm === 'live' ? 'bg-destructive text-white' : syncHealth.sources.qiumibao.basketball.rhythm === 'upcoming' ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}>
                        {syncHealth.sources.qiumibao.basketball.rhythm === 'live' ? '直播 (45s)' : syncHealth.sources.qiumibao.basketball.rhythm === 'upcoming' ? '赛前 (90s)' : '空闲 (5m)'}
                      </Badge>
                    </div>
                    {/* 足球最后同步 */}
                    <div>
                      <div className="text-muted-foreground mb-1">足球最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.qiumibao.football.lastSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.qiumibao.football.lastSyncAt)
                          : '从未同步'}
                      </div>
                    </div>
                    {/* 篮球最后同步 */}
                    <div>
                      <div className="text-muted-foreground mb-1">篮球最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.qiumibao.basketball.lastSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.qiumibao.basketball.lastSyncAt)
                          : '从未同步'}
                      </div>
                    </div>
                    {/* 足球今日次数 */}
                    <div>
                      <div className="text-muted-foreground mb-1">足球今日次数</div>
                      <div className="font-mono text-foreground">
                        {syncHealth.sources.qiumibao.football.todayCount ?? 0} 次
                      </div>
                    </div>
                    {/* 篮球今日次数 */}
                    <div>
                      <div className="text-muted-foreground mb-1">篮球今日次数</div>
                      <div className="font-mono text-foreground">
                        {syncHealth.sources.qiumibao.basketball.todayCount ?? 0} 次
                      </div>
                    </div>
                    {/* 赛程最后同步 */}
                    <div className="col-span-2">
                      <div className="text-muted-foreground mb-1">赛程最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.qiumibao.lastScheduleSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.qiumibao.lastScheduleSyncAt)
                          : '从未同步'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* TheSportsDB（全球足球兜底） */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe className="w-4 h-4 text-info" />
                    <h3 className="text-sm font-semibold text-foreground">TheSportsDB（全球足球）</h3>
                    <Badge variant="secondary" className="text-[10px] h-5">兜底源</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1">状态</div>
                      <Badge className={syncHealth.sources.theSportsDb.enabled ? 'bg-home-win text-white' : 'bg-muted text-muted-foreground'}>
                        {syncHealth.sources.theSportsDb.enabled ? '已启用' : '未配置'}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">今日拉取次数</div>
                      <div className="font-mono text-foreground">
                        {syncHealth.sources.theSportsDb.todayCount ?? 0} 次
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">已获取赛事数</div>
                      <div className="font-mono text-foreground">
                        {syncHealth.sources.theSportsDb.fetchedCount ?? 0} 场
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">最后同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.theSportsDb.lastSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.theSportsDb.lastSyncAt)
                          : '从未同步'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">下次同步</div>
                      <div className="font-mono text-foreground/80">
                        {syncHealth.sources.theSportsDb.nextSyncAt
                          ? formatBeijingTimeShort(syncHealth.sources.theSportsDb.nextSyncAt)
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">同步结果</div>
                      <Badge className={syncHealth.sources.theSportsDb.success ? 'bg-home-win text-white' : 'bg-destructive text-white'}>
                        {syncHealth.sources.theSportsDb.success ? '成功' : '失败'}
                      </Badge>
                    </div>
                    {syncHealth.sources.theSportsDb.lastError && (
                      <div className="col-span-2 sm:col-span-3">
                        <div className="text-muted-foreground mb-1">最近错误</div>
                        <div className="text-destructive text-xs font-mono break-all">
                          {syncHealth.sources.theSportsDb.lastError}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

               {/* 今日分布 */}
               {syncHealth.adaptive && (
                 <div className="bg-card border border-border rounded-xl p-4">
                   <h3 className="text-sm font-semibold text-foreground mb-3">今日赛事分布</h3>
                   <div className="grid grid-cols-2 gap-3 text-xs">
                     <div className="text-center p-2 rounded-lg bg-muted/30">
                       <div className="text-muted-foreground mb-1">足球</div>
                       <div className="font-mono">
                         <span className="text-accent font-semibold">{syncHealth.adaptive.todayFbLiveCount}</span>
                         <span className="text-muted-foreground/60"> 直播 / </span>
                         <span className="text-foreground">{syncHealth.adaptive.todayFbUpcomingCount}</span>
                         <span className="text-muted-foreground/60"> 未赛 / </span>
                         <span className="text-home-win">{syncHealth.adaptive.todayFbFinishedCount}</span>
                         <span className="text-muted-foreground/60"> 完赛</span>
                       </div>
                     </div>
                     <div className="text-center p-2 rounded-lg bg-muted/30">
                       <div className="text-muted-foreground mb-1">篮球</div>
                       <div className="font-mono">
                         <span className="text-accent font-semibold">{syncHealth.adaptive.todayBbLiveCount}</span>
                         <span className="text-muted-foreground/60"> 直播 / </span>
                         <span className="text-foreground">{syncHealth.adaptive.todayBbUpcomingCount}</span>
                         <span className="text-muted-foreground/60"> 未赛 / </span>
                         <span className="text-home-win">{syncHealth.adaptive.todayBbFinishedCount}</span>
                         <span className="text-muted-foreground/60"> 完赛</span>
                       </div>
                     </div>
                   </div>
                 </div>
               )}

                {/* 深度数据回填 */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">深度数据回填</h3>
                    <Badge variant="secondary" className="text-[10px] h-5">form/h2h/统计</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    对过去3天+未来7天的比赛，从ESPN补充球队近况、H2H交锋、赛季场均统计等深度数据。
                    已有的数据不会被覆盖。
                  </p>
                    <div className="flex items-center gap-3">
                     <Button
                       variant="default"
                       size="sm"
                       onClick={() => void handleDeepBackfill()}
                       disabled={deepBackfillStatus?.status === 'running'}
                     >
                       {deepBackfillStatus?.status === 'running' ? (
                         <Loader2 className="h-4 w-4 animate-spin mr-1" />
                       ) : (
                         <RefreshCw className="h-4 w-4 mr-1" />
                       )}
                       {deepBackfillStatus?.status === 'running' ? '回填中...' : '立即回填'}
                     </Button>
                     {deepBackfillStatus && deepBackfillStatus.status !== 'idle' && (
                       <div className="text-xs text-muted-foreground">
                         {deepBackfillStatus.status === 'running' && '回填进行中...'}
                         {deepBackfillStatus.status === 'done' && (
                           <>
                             ⚽ 检查{deepBackfillStatus.footballChecked}场/更新{deepBackfillStatus.footballUpdated}场/失败{deepBackfillStatus.footballErrors}场
                             <span className="mx-2">·</span>
                             🏀 检查{deepBackfillStatus.basketballChecked}场/更新{deepBackfillStatus.basketballUpdated}场/失败{deepBackfillStatus.basketballErrors}场
                           </>
                         )}
                         {deepBackfillStatus.status === 'error' && (
                           <span className="text-destructive">失败：{deepBackfillStatus.errorMessage || '未知错误'}</span>
                         )}
                       </div>
                     )}
                   </div>
                 </div>

                 {/* 同步配置 */}
                 <div className="bg-card border border-border rounded-xl p-4">
                   <div className="flex items-center gap-2 mb-3">
                     <Settings2 className="w-4 h-4 text-primary" />
                     <h3 className="text-sm font-semibold text-foreground">同步配置</h3>
                     <Badge variant="secondary" className="text-[10px] h-5">只读</Badge>
                     {syncConfigLoading && (
                       <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />
                     )}
                   </div>

                   {!syncConfig || syncConfig.sources.length === 0 ? (
                     <div className="text-xs text-muted-foreground text-center py-4">
                       暂无同步配置信息
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                       {(() => {
                         const sorted = [...syncConfig.sources].sort((a: AdminSyncConfigSource, b: AdminSyncConfigSource) => {
                           const aCount = a.actualMatchesCount ?? 0;
                           const bCount = b.actualMatchesCount ?? 0;
                           return bCount - aCount;
                         });
                         const maxCount = Math.max(...sorted.map((s: AdminSyncConfigSource) => s.actualMatchesCount ?? 0));
                         const now = Date.now();
                         const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
                         return sorted.map((src: AdminSyncConfigSource) => {
                           const isMainSource = (src.actualMatchesCount ?? 0) > 0 && (src.actualMatchesCount ?? 0) === maxCount;
                           const isEspnStale = src.name === 'ESPN' && src.lastUpdated
                             ? (now - new Date(src.lastUpdated).getTime()) > SEVEN_DAYS_MS
                             : false;
                           return (
                             <div
                               key={src.name}
                               className={`rounded-lg border p-3 ${src.enabled ? 'border-border bg-background' : 'border-border/50 bg-muted/30 opacity-70'}`}
                             >
                               <div className="flex items-center gap-2 mb-2 flex-wrap">
                                 <span className="text-sm font-medium text-foreground">{src.name}</span>
                                 {isMainSource && (
                                   <Badge className="bg-nebula-crimson text-white text-[10px] h-4 border-0">主源</Badge>
                                 )}
                                 <Badge
                                   variant="outline"
                                   className={src.enabled
                                     ? 'border-home-win/30 bg-home-win/10 text-home-win text-[10px] h-4'
                                     : 'border-muted-foreground/30 text-muted-foreground text-[10px] h-4'}
                                 >
                                   {src.enabled ? '启用' : '禁用'}
                                 </Badge>
                               </div>
                               <div className="space-y-1 text-xs">
                                 {src.actualMatchesCount !== undefined && (
                                   <div className="flex justify-between">
                                     <span className="text-muted-foreground">实际贡献</span>
                                     <span className="text-foreground font-mono font-semibold">{src.actualMatchesCount.toLocaleString()} 场</span>
                                   </div>
                                 )}
                                 <div className="flex justify-between">
                                   <span className="text-muted-foreground">类型</span>
                                   <span className="text-foreground font-mono">{src.type}</span>
                                 </div>
                                 {src.intervalLabel && (
                                   <div className="flex justify-between">
                                     <span className="text-muted-foreground">间隔</span>
                                     <span className="text-foreground font-mono">{src.intervalLabel}</span>
                                   </div>
                                 )}
                                 {!src.intervalLabel && src.intervalMs !== undefined && (
                                   <div className="flex justify-between">
                                     <span className="text-muted-foreground">间隔</span>
                                     <span className="text-foreground font-mono">{formatInterval(src.intervalMs)}</span>
                                   </div>
                                 )}
                                 {src.intervals && (
                                   <div className="pt-1 space-y-0.5">
                                     <div className="text-muted-foreground">节奏间隔</div>
                                     <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
                                       <div className="bg-muted/50 rounded px-1.5 py-0.5 text-center">
                                         直播<br/>{formatInterval(src.intervals.live)}
                                       </div>
                                       <div className="bg-muted/50 rounded px-1.5 py-0.5 text-center">
                                         赛前<br/>{formatInterval(src.intervals.upcoming)}
                                       </div>
                                       <div className="bg-muted/50 rounded px-1.5 py-0.5 text-center">
                                         空闲<br/>{formatInterval(src.intervals.idle)}
                                       </div>
                                     </div>
                                   </div>
                                 )}
                                 {src.monthlyQuota !== undefined && (
                                   <div className="flex justify-between">
                                     <span className="text-muted-foreground">月配额</span>
                                     <span className="text-foreground font-mono">{src.monthlyQuota.toLocaleString()}</span>
                                   </div>
                                 )}
                                  {src.dailyQuota !== undefined && (
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">日配额</span>
                                      <span className="text-foreground font-mono">{src.dailyQuota.toLocaleString()}</span>
                                    </div>
                                  )}
                                  {isEspnStale && (
                                    <div className="pt-2 mt-1 text-[11px] text-destructive leading-relaxed flex items-start gap-1">
                                      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                      <span>ESPN 足球源自 9/21 后未更新（疑似停更）</span>
                                    </div>
                                  )}
                                  {src.dataNote && (
                                    <div className="pt-1 text-[11px] text-muted-foreground leading-relaxed">
                                      {src.dataNote}
                                    </div>
                                  )}
                                  {src.note && (
                                    <div className="pt-2 mt-1 border-t border-border/50 text-[11px] text-muted-foreground leading-relaxed">
                                      {src.note}
                                    </div>
                                  )}
                                </div>
                             </div>
                           );
                         });
                       })()}
                     </div>
                   )}
                 </div>

                 {/* 数据源设置 */}
                 <div className="bg-card border border-border rounded-xl p-4">
                   <div className="flex items-center gap-2 mb-4">
                     <Database className="w-4 h-4 text-primary" />
                     <h3 className="text-sm font-semibold text-foreground">数据源设置</h3>
                     <Badge variant="outline" className="text-[10px] h-5">可配置</Badge>
                     {dataSourcesLoading && (
                       <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />
                     )}
                   </div>

                   {!dataSources ? (
                     <div className="text-xs text-muted-foreground text-center py-4">
                       {dataSourcesLoading ? '加载中...' : '暂无数据源信息'}
                     </div>
                   ) : (
                     <div className="space-y-4">
                       {/* apiSports */}
                       <div className="rounded-lg border border-border bg-background p-3">
                         <div className="flex items-center gap-2 mb-2">
                           <span className="text-sm font-medium text-foreground">apiSports</span>
                           <Badge
                             variant="outline"
                             className={dataSources.apiSports.enabled
                               ? 'border-home-win/30 bg-home-win/10 text-home-win text-[10px] h-4'
                               : 'border-muted-foreground/30 text-muted-foreground text-[10px] h-4'}
                           >
                             {dataSources.apiSports.enabled ? '已启用' : '未启用'}
                           </Badge>
                           <Badge variant="secondary" className="text-[10px] h-4 ml-auto">
                             {dataSources.apiSports.configuredSource === 'env' ? '环境变量' : dataSources.apiSports.configuredSource === 'db' ? '后台配置' : '默认兜底'}
                           </Badge>
                         </div>
                         <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                           <div className="flex justify-between">
                             <span className="text-muted-foreground">日配额</span>
                             <span className="text-foreground font-mono">{dataSources.apiSports.dailyQuota}</span>
                           </div>
                           <div className="flex justify-between">
                             <span className="text-muted-foreground">已用</span>
                             <span className="text-foreground font-mono">{dataSources.apiSports.quotaUsed}</span>
                           </div>
                         </div>
                         {dataSources.apiSports.configuredSource !== 'env' && (
                           <div className="flex gap-2">
                             <Input
                               type="password"
                               placeholder={dataSources.apiSports.dbKeySet ? `当前: ${dataSources.apiSports.maskedKey}` : '请输入 apiSports API Key'}
                               value={apiSportsKey}
                               onChange={(e) => setApiSportsKey(e.target.value)}
                               className="h-8 text-xs"
                             />
                             <Button
                               size="sm"
                               className="h-8"
                               onClick={() => void handleSaveApiSportsKey()}
                               disabled={apiSportsSaving || (apiSportsKey.length > 0 && apiSportsKey.length < 8)}
                             >
                               {apiSportsSaving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                               保存
                             </Button>
                           </div>
                         )}
                         {dataSources.apiSports.configuredSource === 'env' && (
                           <p className="text-[11px] text-muted-foreground">已由环境变量配置，后台不可修改</p>
                         )}
                       </div>

                       {/* TheRundown */}
                       <div className="rounded-lg border border-border bg-background p-3">
                         <div className="flex items-center gap-2 mb-2">
                           <span className="text-sm font-medium text-foreground">TheRundown</span>
                           <Badge
                             variant="outline"
                             className={dataSources.theRundown.enabled
                               ? 'border-home-win/30 bg-home-win/10 text-home-win text-[10px] h-4'
                               : 'border-muted-foreground/30 text-muted-foreground text-[10px] h-4'}
                           >
                             {dataSources.theRundown.enabled ? '已启用' : '未启用'}
                           </Badge>
                           <Badge variant="secondary" className="text-[10px] h-4 ml-auto">
                             {dataSources.theRundown.configuredSource === 'env' ? '环境变量' : dataSources.theRundown.configuredSource === 'db' ? '后台配置' : '默认兜底'}
                           </Badge>
                         </div>
                         <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                           <div className="flex justify-between">
                             <span className="text-muted-foreground">OddsAPI耗尽</span>
                             <span className={`font-mono ${dataSources.theRundown.oddsApiQuotaExhausted ? 'text-destructive' : 'text-home-win'}`}>
                               {dataSources.theRundown.oddsApiQuotaExhausted ? '已切换' : '正常'}
                             </span>
                           </div>
                           <div className="flex justify-between">
                             <span className="text-muted-foreground">最近同步</span>
                             <span className="text-foreground font-mono">{dataSources.theRundown.lastSyncAt ? new Date(dataSources.theRundown.lastSyncAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
                           </div>
                         </div>
                         {dataSources.theRundown.configuredSource !== 'env' && (
                           <div className="flex gap-2">
                             <Input
                               type="password"
                               placeholder={dataSources.theRundown.dbKeySet ? `当前: ${dataSources.theRundown.maskedKey}` : '请输入 TheRundown API Key'}
                               value={theRundownKey}
                               onChange={(e) => setTheRundownKey(e.target.value)}
                               className="h-8 text-xs"
                             />
                             <Button
                               size="sm"
                               className="h-8"
                               onClick={() => void handleSaveTheRundownKey()}
                               disabled={theRundownSaving || (theRundownKey.length > 0 && theRundownKey.length < 8)}
                             >
                               {theRundownSaving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                               保存
                             </Button>
                           </div>
                         )}
                          {dataSources.theRundown.configuredSource === 'env' && (
                            <p className="text-[11px] text-muted-foreground">已由环境变量配置，后台不可修改</p>
                          )}
                        </div>

                        {/* football-data.org */}
                        <div className="rounded-lg border border-border bg-background p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-medium text-foreground">football-data.org</span>
                            <Badge
                              variant="outline"
                              className={dataSources.footballDataOrg.enabled
                                ? 'border-home-win/30 bg-home-win/10 text-home-win text-[10px] h-4'
                                : 'border-muted-foreground/30 text-muted-foreground text-[10px] h-4'}
                            >
                              {dataSources.footballDataOrg.enabled ? '已启用' : '未启用（需配置Key）'}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] h-4 ml-auto">
                              {dataSources.footballDataOrg.configuredSource === 'env' ? '环境变量' : dataSources.footballDataOrg.configuredSource === 'db' ? '后台配置' : '未配置'}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">请求数</span>
                              <span className="text-foreground font-mono">{dataSources.footballDataOrg.requestCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">最近同步</span>
                              <span className="text-foreground font-mono">{dataSources.footballDataOrg.lastSyncAt ? new Date(dataSources.footballDataOrg.lastSyncAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">同步状态</span>
                              <span className={`font-mono ${dataSources.footballDataOrg.success ? 'text-home-win' : 'text-destructive'}`}>
                                {dataSources.footballDataOrg.success ? '成功' : '失败'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">今日场次</span>
                              <span className="text-foreground font-mono">{dataSources.footballDataOrg.updated}</span>
                            </div>
                          </div>
                          {dataSources.footballDataOrg.lastError && (
                            <div className="text-[11px] text-destructive mb-3 break-words">
                              错误：{dataSources.footballDataOrg.lastError}
                            </div>
                          )}
                          {dataSources.footballDataOrg.configuredSource !== 'env' && (
                            <div className="flex gap-2">
                              <Input
                                type="password"
                                placeholder={dataSources.footballDataOrg.dbKeySet ? `当前: ${dataSources.footballDataOrg.maskedKey}` : '请输入 football-data.org API Key'}
                                value={footballDataOrgKey}
                                onChange={(e) => setFootballDataOrgKey(e.target.value)}
                                className="h-8 text-xs"
                              />
                              <Button
                                size="sm"
                                className="h-8"
                                onClick={() => void handleSaveFootballDataOrgKey()}
                                disabled={footballDataOrgSaving || (footballDataOrgKey.length > 0 && footballDataOrgKey.length < 8)}
                              >
                                {footballDataOrgSaving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                                保存
                              </Button>
                            </div>
                          )}
                          {dataSources.footballDataOrg.configuredSource === 'env' && (
                            <p className="text-[11px] text-muted-foreground">已由环境变量配置，后台不可修改</p>
                          )}
                        </div>

                        {/* 官方伤病源 */}
                        <div className="rounded-lg border border-border bg-background p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-medium text-foreground">官方伤病源 (ESPN)</span>
                            <Badge
                              variant="outline"
                              className={dataSources.injurySource.enabled
                                ? 'border-home-win/30 bg-home-win/10 text-home-win text-[10px] h-4'
                                : 'border-muted-foreground/30 text-muted-foreground text-[10px] h-4'}
                            >
                              {dataSources.injurySource.enabled ? '已启用' : '未启用'}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">球队数</span>
                              <span className="text-foreground font-mono">{dataSources.injurySource.teamCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">伤病人数</span>
                              <span className="text-foreground font-mono">{dataSources.injurySource.playerCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">同步状态</span>
                              <span className={`font-mono ${dataSources.injurySource.success ? 'text-home-win' : 'text-destructive'}`}>
                                {dataSources.injurySource.success ? '成功' : '失败'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">最近同步</span>
                              <span className="text-foreground font-mono">{dataSources.injurySource.lastSyncAt ? new Date(dataSources.injurySource.lastSyncAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
                            </div>
                          </div>
                          {dataSources.injurySource.lastError && (
                            <div className="text-[11px] text-destructive break-words">
                              警告：{dataSources.injurySource.lastError}
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground mt-2">
                            来源：ESPN NBA + ESPN WNBA 官方伤病数据，每 30 分钟自动同步
                          </p>
                        </div>

                       {/* 其他数据源概览 */}
                       <div className="grid grid-cols-2 gap-3">
                         <div className="rounded-lg border border-border bg-background p-3">
                           <div className="flex items-center gap-2 mb-2">
                             <span className="text-sm font-medium text-foreground">ESPN</span>
                           </div>
                           <div className="space-y-1 text-xs">
                             <div className="flex justify-between">
                               <span className="text-muted-foreground">足球</span>
                               <span className={dataSources.espn.footballEnabled ? 'text-home-win font-mono' : 'text-muted-foreground font-mono'}>
                                 {dataSources.espn.footballEnabled ? '启用' : '禁用'}
                               </span>
                             </div>
                             <div className="flex justify-between">
                               <span className="text-muted-foreground">篮球</span>
                               <span className={dataSources.espn.basketballEnabled ? 'text-home-win font-mono' : 'text-muted-foreground font-mono'}>
                                 {dataSources.espn.basketballEnabled ? '启用' : '禁用'}
                               </span>
                             </div>
                           </div>
                         </div>
                         <div className="rounded-lg border border-border bg-background p-3">
                           <div className="flex items-center gap-2 mb-2">
                             <span className="text-sm font-medium text-foreground">The Odds API</span>
                           </div>
                           <div className="space-y-1 text-xs">
                             <div className="flex justify-between">
                               <span className="text-muted-foreground">状态</span>
                               <span className={dataSources.oddsApi.enabled ? 'text-home-win font-mono' : 'text-muted-foreground font-mono'}>
                                 {dataSources.oddsApi.enabled ? '启用' : '禁用'}
                               </span>
                             </div>
                             <div className="flex justify-between">
                               <span className="text-muted-foreground">剩余</span>
                               <span className="text-foreground font-mono">{dataSources.oddsApi.remaining ?? '—'}</span>
                             </div>
                           </div>
                         </div>
                         <div className="rounded-lg border border-border bg-background p-3">
                           <div className="flex items-center gap-2 mb-2">
                             <span className="text-sm font-medium text-foreground">球美宝</span>
                           </div>
                           <div className="space-y-1 text-xs">
                             <div className="flex justify-between">
                               <span className="text-muted-foreground">足球</span>
                               <span className="text-foreground font-mono">{dataSources.qiumibao.footballCount}场</span>
                             </div>
                             <div className="flex justify-between">
                               <span className="text-muted-foreground">篮球</span>
                               <span className="text-foreground font-mono">{dataSources.qiumibao.basketballCount}场</span>
                             </div>
                           </div>
                         </div>
                          <div className="rounded-lg border border-border bg-background p-3">
                            <div className="flex items-center gap-2 mb-2">
                               <span className="text-sm font-medium text-foreground">足球二台</span>
                            </div>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">状态</span>
                                <span className={dataSources.beidan.enabled ? 'text-home-win font-mono' : 'text-muted-foreground font-mono'}>
                                  {dataSources.beidan.enabled ? '启用' : '禁用'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">今日</span>
                                <span className="text-foreground font-mono">{dataSources.beidan.todayCount}场</span>
                              </div>
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-background p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-medium text-foreground">官方伤病</span>
                            </div>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">状态</span>
                                <span className={dataSources.injurySource.enabled ? 'text-home-win font-mono' : 'text-muted-foreground font-mono'}>
                                  {dataSources.injurySource.enabled ? '启用' : '禁用'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">球队</span>
                                <span className="text-foreground font-mono">{dataSources.injurySource.teamCount}支</span>
                              </div>
                            </div>
                          </div>
                        </div>
                     </div>
                   )}
                 </div>

                 <p className="text-[10px] text-muted-foreground/60 text-center">
                   数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛
               </p>
             </>
           )}
          </TabsContent>

          {/* === Tab 6: 用户管理 === */}
          <TabsContent value="users" className="mt-4 space-y-4">
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-ai-section-type="card-stat">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /><span>总用户数</span></div>
                <div className="mt-2 text-2xl font-mono font-bold text-foreground">{userStatsLoading ? '...' : (userStats?.totalUsers ?? 0).toLocaleString()}</div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><UserPlus className="h-3.5 w-3.5" /><span>今日新增</span></div>
                <div className="mt-2 text-2xl font-mono font-bold text-home-win">{userStatsLoading ? '...' : userStats?.newToday ?? 0}</div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5" /><span>今日活跃</span></div>
                <div className="mt-2 text-2xl font-mono font-bold text-primary">{userStatsLoading ? '...' : userStats?.activeToday ?? 0}</div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Zap className="h-3.5 w-3.5" /><span>当前在线</span></div>
                <div className="mt-2 text-2xl font-mono font-bold text-accent">{userStatsLoading ? '...' : userStats?.onlineNow ?? 0}</div>
              </div>
            </div>

            {/* 筛选行 */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="按邮箱搜索..."
                  value={userSearch}
                  onChange={handleUserSearchChange}
                  className="pl-9"
                />
              </div>
              <Select
                value={userRoleFilter}
                onValueChange={(v) => {
                  setUserRoleFilter(v as 'all' | 'admin' | 'user');
                  setUserPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="角色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                  <SelectItem value="user">普通用户</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshUsers}
                disabled={usersLoading}
              >
                {usersLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-1">刷新</span>
              </Button>
            </div>

            {/* 错误提示 */}
            {usersError && (
              <div className="bg-card border border-destructive/30 rounded-xl p-6 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
                <p className="text-sm text-destructive font-medium">{usersError}</p>
              </div>
            )}

            {/* 桌面端表格 */}
            {!usersError && (
              <div className="hidden md:block rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>邮箱</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>邮箱验证</TableHead>
                      <TableHead>注册时间</TableHead>
                      <TableHead>最近活跃</TableHead>
                      <TableHead className="text-right">收藏</TableHead>
                      <TableHead className="text-right">关注球队</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersLoading && users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                          加载中...
                        </TableCell>
                      </TableRow>
                    ) : users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          暂无用户数据
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((u: AdminUserItem) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-mono text-xs">{u.email}</TableCell>
                          <TableCell>
                            <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                              {u.role === 'admin' ? '管理员' : '普通用户'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {u.emailVerified ? (
                              <span className="flex items-center gap-1 text-xs text-home-win">
                                <Check className="h-3.5 w-3.5" /> 已验证
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <X className="h-3.5 w-3.5" /> 未验证
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {formatBeijingTimeShort(u.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {u.lastActiveAt ? formatBeijingTimeShort(u.lastActiveAt) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">{u.favoritesCount}</TableCell>
                          <TableCell className="text-right text-sm font-mono">{u.followedTeamsCount}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleToggleRole(u)}
                              >
                                {u.role === 'admin' ? '取消管理员' : '设为管理员'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-accent"
                                onClick={() => void handleResetPassword(u)}
                              >
                                重置密码
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive"
                                onClick={() => handleDeleteUser(u)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* 移动端卡片 */}
            {!usersError && (
              <div className="md:hidden space-y-3">
                {usersLoading && users.length === 0 && (
                  <div className="bg-card border border-border rounded-xl p-6 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">加载中...</p>
                  </div>
                )}
                {!usersLoading && users.length === 0 && (
                  <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                    暂无用户数据
                  </div>
                )}
                {users.map((u: AdminUserItem) => (
                  <div key={u.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate font-mono">{u.email}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role === 'admin' ? '管理员' : '普通用户'}</Badge>
                          {u.emailVerified ? (
                            <span className="flex items-center gap-0.5 text-xs text-home-win"><Check className="h-3 w-3" /> 已验证</span>
                          ) : (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><X className="h-3 w-3" /> 未验证</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-muted-foreground">注册时间</div><div className="font-mono text-foreground">{formatBeijingTimeShort(u.createdAt)}</div></div>
                      <div><div className="text-muted-foreground">最近活跃</div><div className="font-mono text-foreground">{u.lastActiveAt ? formatBeijingTimeShort(u.lastActiveAt) : '-'}</div></div>
                      <div><div className="text-muted-foreground">收藏数</div><div className="font-mono text-foreground">{u.favoritesCount}</div></div>
                      <div><div className="text-muted-foreground">关注球队</div><div className="font-mono text-foreground">{u.followedTeamsCount}</div></div>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                      <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => handleToggleRole(u)}>
                        {u.role === 'admin' ? '取消管理员' : '设为管理员'}
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 h-8 text-xs text-accent" onClick={() => void handleResetPassword(u)}>
                        重置密码
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-destructive" onClick={() => handleDeleteUser(u)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 分页 */}
            {usersTotal > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  共 {usersTotal} 条，第 {userPage}/{totalUserPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setUserPage((p: number) => Math.max(1, p - 1))}
                    disabled={userPage <= 1 || usersLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setUserPage((p: number) => Math.min(totalUserPages, p + 1))}
                    disabled={userPage >= totalUserPages || usersLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
           </TabsContent>

           {/* === 审计日志 Tab === */}
           <TabsContent value="audit" className="mt-4 space-y-4">
             <div className="flex flex-wrap items-center justify-between gap-3">
               <div className="flex items-center gap-2">
                 <ClipboardList className="h-5 w-5 text-primary" />
                 <h2 className="text-base font-semibold text-foreground">操作审计日志</h2>
               </div>
               <div className="flex items-center gap-2">
                 <Select
                   value={auditActionType}
                   onValueChange={(v) => setAuditActionType(v)}
                 >
                   <SelectTrigger className="w-[160px]">
                     <SelectValue placeholder="操作类型" />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="all">全部</SelectItem>
                     <SelectItem value="login">登录</SelectItem>
                     <SelectItem value="create_match">创建比赛</SelectItem>
                     <SelectItem value="update_match">更新比赛</SelectItem>
                     <SelectItem value="delete_match">删除比赛</SelectItem>
                     <SelectItem value="update_user_role">修改用户角色</SelectItem>
                     <SelectItem value="reset_password">重置密码</SelectItem>
                     <SelectItem value="delete_user">删除用户</SelectItem>
                     <SelectItem value="reply_ticket">回复工单</SelectItem>
                     <SelectItem value="trigger_sync">触发同步</SelectItem>
                   </SelectContent>
                 </Select>
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => {
                     setAuditPage(1);
                     void loadAuditLogs();
                   }}
                   disabled={auditLoading}
                 >
                   {auditLoading ? (
                     <Loader2 className="h-4 w-4 animate-spin" />
                   ) : (
                     <RefreshCw className="h-4 w-4" />
                   )}
                   <span className="ml-1">刷新</span>
                 </Button>
               </div>
             </div>

             {auditError && (
               <div className="rounded-xl border border-destructive/30 bg-card p-6 text-center">
                 <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-destructive" />
                 <p className="text-sm font-medium text-destructive">{auditError}</p>
               </div>
             )}

             {!auditError && (
               <div className="overflow-hidden rounded-xl border border-border bg-card">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead className="text-muted-foreground">时间</TableHead>
                       <TableHead className="text-muted-foreground">操作人</TableHead>
                       <TableHead className="text-muted-foreground">动作类型</TableHead>
                       <TableHead className="text-muted-foreground">操作对象</TableHead>
                       <TableHead className="text-muted-foreground">结果</TableHead>
                       <TableHead className="text-muted-foreground">详情</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {auditLoading && auditItems.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                           <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                           加载中...
                         </TableCell>
                       </TableRow>
                     ) : auditItems.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                           暂无审计记录
                         </TableCell>
                       </TableRow>
                     ) : (
                       auditItems.map((item: AdminAuditLogItem) => (
                         <TableRow key={item.id}>
                           <TableCell className="font-mono text-xs text-muted-foreground">
                             {formatBeijingTimeShort(item.createdAt)}
                           </TableCell>
                           <TableCell className="text-sm">
                             <div className="font-mono text-xs">{item.operatorEmail || item.operatorId || '系统'}</div>
                             {item.ipAddress && (
                               <div className="text-[10px] text-muted-foreground font-mono">{item.ipAddress}</div>
                             )}
                           </TableCell>
                           <TableCell>
                             <Badge variant="outline" className="border-border text-foreground">
                               {AUDIT_ACTION_LABELS[item.actionType] || item.actionType}
                             </Badge>
                           </TableCell>
                           <TableCell className="text-sm">
                             {item.targetType ? (
                               <div className="text-foreground">
                                 {item.targetType}
                                 {item.targetId && (
                                   <span className="text-muted-foreground font-mono text-xs ml-1">
                                     #{item.targetId.slice(0, 8)}
                                   </span>
                                 )}
                               </div>
                             ) : (
                               <span className="text-muted-foreground">—</span>
                             )}
                           </TableCell>
                           <TableCell>
                             {item.result === 'success' ? (
                               <Badge variant="outline" className="border-home-win/30 bg-home-win/10 text-home-win">
                                 成功
                               </Badge>
                             ) : (
                               <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                                 失败
                               </Badge>
                             )}
                           </TableCell>
                           <TableCell className="text-sm text-muted-foreground max-w-[300px]">
                             <div className="truncate" title={item.detail || item.errorMessage || ''}>
                               {item.detail || item.errorMessage || '—'}
                             </div>
                           </TableCell>
                         </TableRow>
                       ))
                     )}
                   </TableBody>
                 </Table>
               </div>
             )}

             {/* 分页 */}
             {auditTotal > 0 && (
               <div className="flex items-center justify-between">
                 <span className="text-xs text-muted-foreground">
                   共 {auditTotal} 条，第 {auditPage}/{totalAuditPages} 页
                 </span>
                 <div className="flex items-center gap-1">
                   <Button
                     variant="outline"
                     size="sm"
                     className="h-8 w-8 p-0"
                     onClick={() => setAuditPage((p: number) => Math.max(1, p - 1))}
                     disabled={auditPage <= 1 || auditLoading}
                   >
                     <ChevronLeft className="h-4 w-4" />
                   </Button>
                   <Button
                     variant="outline"
                     size="sm"
                     className="h-8 w-8 p-0"
                     onClick={() => setAuditPage((p: number) => Math.min(totalAuditPages, p + 1))}
                     disabled={auditPage >= totalAuditPages || auditLoading}
                   >
                     <ChevronRight className="h-4 w-4" />
                   </Button>
                 </div>
               </div>
             )}
            </TabsContent>

            {/* === Tab: 预测管理 === */}
            <TabsContent value="prediction" className="mt-4 space-y-4">
              {/* 筛选区 */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">运动类型</Label>
                    <Select value={predictionSport} onValueChange={(v: 'football' | 'basketball') => setPredictionSport(v)}>
                      <SelectTrigger className="h-9 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="football">足球</SelectItem>
                        <SelectItem value="basketball">篮球</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">比赛状态</Label>
                    <Select value={predictionStatus} onValueChange={setPredictionStatus}>
                      <SelectTrigger className="h-9 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="upcoming">未开赛</SelectItem>
                        <SelectItem value="live">进行中</SelectItem>
                        <SelectItem value="finished">已完赛</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">开始日期</Label>
                    <Input
                      type="date"
                      value={predictionDateFrom}
                      onChange={(e) => setPredictionDateFrom(e.target.value)}
                      className="h-9 w-40"
                    />
                  </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs text-muted-foreground">结束日期</Label>
                     <Input
                       type="date"
                       value={predictionDateTo}
                       onChange={(e) => setPredictionDateTo(e.target.value)}
                       className="h-9 w-40"
                     />
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-xs text-muted-foreground">联赛关键词</Label>
                     <Input
                       type="text"
                       placeholder="输入联赛关键词如意甲/WNBA"
                       value={predictionLeague}
                       onChange={(e) => setPredictionLeague(e.target.value)}
                       className="h-9 w-52"
                     />
                   </div>
                   <div className="flex items-center gap-2 ml-auto">
                    <Button variant="outline" size="sm" onClick={handlePreviewRecalc} disabled={previewLoading}>
                      {previewLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
                      预览数量
                    </Button>
                    <AlertDialog open={recalcConfirmOpen} onOpenChange={setRecalcConfirmOpen}>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" disabled={recalcLoading}>
                          {recalcLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                          开始重算
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认批量重算预测</AlertDialogTitle>
                          <AlertDialogDescription>
                            此操作将重新计算符合条件的所有比赛的预测结果，可能需要较长时间。是否继续？
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRecalculate} className="bg-destructive hover:bg-destructive/90">
                            确认重算
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>

              {/* 预览结果 */}
              {previewResult && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">预览结果</h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-2" data-ai-section-type="card-stat">
                     <div className="rounded-lg border border-border/50 bg-background p-3">
                       <div className="text-xs text-muted-foreground">总场次</div>
                       <div className="mt-1 text-2xl font-bold text-foreground">{previewResult.total}</div>
                     </div>
                     <div className="rounded-lg border border-border/50 bg-background p-3">
                       <div className="text-xs text-muted-foreground">运动类型</div>
                       <div className="mt-1 text-2xl font-bold text-primary">
                         {previewResult.sport === 'football' ? '足球' : previewResult.sport === 'basketball' ? '篮球' : previewResult.sport}
                       </div>
                     </div>
                   </div>
                </div>
              )}

              {/* 重算结果 */}
              {recalcResult && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">重算结果</h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-ai-section-type="card-stat">
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">总扫描</div>
                      <div className="mt-1 text-2xl font-bold text-foreground">{recalcResult.totalScanned}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">已重算</div>
                      <div className="mt-1 text-2xl font-bold text-emerald-600">{recalcResult.recalculated}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">跳过冻结</div>
                      <div className="mt-1 text-2xl font-bold text-amber-600">{recalcResult.skippedLocked}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">跳过无数据</div>
                      <div className="mt-1 text-2xl font-bold text-muted-foreground">{recalcResult.skippedNoData}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">出方向数</div>
                      <div className="mt-1 text-2xl font-bold text-primary">{recalcResult.predictionsMade}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">观望数</div>
                      <div className="mt-1 text-2xl font-bold text-muted-foreground">{recalcResult.holds}</div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background p-3">
                      <div className="text-xs text-muted-foreground">耗时(ms)</div>
                      <div className="mt-1 text-2xl font-bold font-mono text-foreground">{recalcResult.durationMs}</div>
                    </div>
                  </div>
                </div>
              )}

              {!previewResult && !recalcResult && !previewLoading && !recalcLoading && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
                  <Target className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">设置筛选条件后点击「预览数量」开始</p>
                </div>
              )}
            </TabsContent>

            {/* === Tab: 数据巡检 === */}
            <TabsContent value="inspection" className="mt-4 space-y-4">
              {/* 顶部操作 */}
              <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">巡检范围</Label>
                    <Select value={inspectionSport} onValueChange={(v: 'all' | 'football' | 'basketball') => setInspectionSport(v)}>
                      <SelectTrigger className="h-9 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="football">足球</SelectItem>
                        <SelectItem value="basketball">篮球</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleRunInspection} disabled={inspectionLoading}>
                  {inspectionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  开始巡检
                </Button>
              </div>

              {inspectionLoading && (
                <div className="flex items-center justify-center rounded-xl border border-border bg-card p-12">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">正在巡检数据...</span>
                </div>
              )}

              {inspectionResult && !inspectionLoading && (
                <>
                  {/* 观望率卡片 */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-ai-section-type="card-stat">
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-emerald-600" />
                        <span className="text-sm font-medium text-foreground">足球观望率</span>
                      </div>
                      <div className="mt-3 flex items-baseline gap-3">
                        <span className="text-4xl font-black tracking-tight text-emerald-600">
                          {(inspectionResult.football.waitRate * 100).toFixed(1)}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {inspectionResult.football.waitCount} / {inspectionResult.football.total} 场
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <Dumbbell className="h-5 w-5 text-orange-600" />
                        <span className="text-sm font-medium text-foreground">篮球观望率</span>
                      </div>
                      <div className="mt-3 flex items-baseline gap-3">
                        <span className="text-4xl font-black tracking-tight text-orange-600">
                          {(inspectionResult.basketball.waitRate * 100).toFixed(1)}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {inspectionResult.basketball.waitCount} / {inspectionResult.basketball.total} 场
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 异常列表 */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">异常数据</h3>
                      <Badge variant="outline" className="text-xs">
                        扫描时间: {inspectionResult.scanTime}
                      </Badge>
                    </div>
                    {inspectionResult.football.anomalies.length === 0 && inspectionResult.basketball.anomalies.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10">
                        <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-500" />
                        <p className="text-sm text-muted-foreground">暂无异常数据</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {['football', 'basketball'].map((sport) => {
                          const sportData = sport === 'football' ? inspectionResult.football : inspectionResult.basketball;
                          const sportLabel = sport === 'football' ? '足球' : '篮球';
                          const anomalies = sportData.anomalies;
                          if (anomalies.length === 0) return null;
                          return (
                            <div key={sport}>
                              <div className="mb-2 text-xs font-medium text-muted-foreground">{sportLabel} ({anomalies.length} 项)</div>
                              <div className="overflow-hidden rounded-lg border border-border/50">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/30">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">比赛</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">联赛</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">开赛时间</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">异常类型</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">详情</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">严重程度</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/50">
                                    {anomalies.map((a) => (
                                      <tr key={a.id} className="hover:bg-muted/20">
                                        <td className="px-3 py-2 font-medium text-foreground">
                                          {a.homeTeam} vs {a.awayTeam}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">{a.league}</td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">{a.kickoffTime}</td>
                                        <td className="px-3 py-2 text-xs text-foreground">{a.anomalyType}</td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">{a.anomalyDetail}</td>
                                        <td className="px-3 py-2">
                                          <Badge className={
                                            a.severity === 'critical'
                                              ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                              : a.severity === 'warning'
                                              ? 'bg-orange-100 text-orange-700 hover:bg-orange-100'
                                              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100'
                                          }>
                                            {a.severity === 'critical' ? '严重' : a.severity === 'warning' ? '警告' : '提示'}
                                          </Badge>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {!inspectionResult && !inspectionLoading && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
                  <Search className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">点击「开始巡检」检查异常数据</p>
                </div>
              )}

              {/* === V11 自动检查 === */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">V11 自动检查</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      每次同步后自动运行，覆盖场次完整性、状态流转、节次显示、数据正确性、命中回打、模型基线 6 大类
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={loadAutoCheckLatest} disabled={autoCheckRunning}>
                      <RefreshCw className={`mr-1 h-3.5 w-3.5 ${autoCheckRunning ? 'animate-spin' : ''}`} />
                      刷新
                    </Button>
                    <Button size="sm" onClick={handleRunAutoCheck} disabled={autoCheckRunning}>
                      {autoCheckRunning ? (
                        <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />运行中</>
                      ) : (
                        <><PlayCircle className="mr-1 h-3.5 w-3.5" />立即检查</>
                      )}
                    </Button>
                  </div>
                </div>

                {autoCheckLatest ? (
                  <>
                    {/* 概览卡片 */}
                    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-ai-section-type="card-stat">
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <div className="text-xs text-muted-foreground">检查场次</div>
                        <div className="mt-1 text-xl font-black tracking-tight text-foreground">{autoCheckLatest.totalMatches}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          未赛{autoCheckLatest.upcomingCount} / 进行中{autoCheckLatest.liveCount} / 已完{autoCheckLatest.finishedCount}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <div className="text-xs text-muted-foreground">发现问题</div>
                        <div className={`mt-1 text-xl font-black tracking-tight ${autoCheckLatest.totalIssues > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {autoCheckLatest.totalIssues}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          自动修复{autoCheckLatest.autoFixed} / 需人工{autoCheckLatest.needsManual}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <div className="text-xs text-muted-foreground">触发方式</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {autoCheckLatest.triggerSource === 'sync' ? '同步后自动' : autoCheckLatest.triggerSource === 'manual' ? '手动触发' : autoCheckLatest.triggerSource}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {autoCheckLatest.triggerTask || '—'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <div className="text-xs text-muted-foreground">检查时间</div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {autoCheckLatest.createdAt ? new Date(autoCheckLatest.createdAt).toLocaleString('zh-CN') : '—'}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          耗时 {autoCheckLatest.durationMs}ms
                        </div>
                      </div>
                    </div>

                    {/* 分类汇总 */}
                    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                      {[
                        { label: '场次完整性', key: 'integrity', detail: `${autoCheckLatest.summary.integrity.predicted}/${autoCheckLatest.summary.integrity.total} 已预测，空字段${autoCheckLatest.summary.integrity.emptyFields}，重复${autoCheckLatest.summary.integrity.duplicateMatchNos}` },
                        { label: '状态流转', key: 'status_flow', detail: `已完${autoCheckLatest.summary.statusFlow.finished}，待回打${autoCheckLatest.summary.statusFlow.pendingHit}，卡live${autoCheckLatest.summary.statusFlow.stuckLive}，异常${autoCheckLatest.summary.statusFlow.wrongFinished}` },
                        { label: '节次显示', key: 'period_display', detail: `可靠${autoCheckLatest.summary.periodDisplay.reliable}，推算${autoCheckLatest.summary.periodDisplay.estimated}，误导${autoCheckLatest.summary.periodDisplay.misleading}，加时误判${autoCheckLatest.summary.periodDisplay.otMislabeled}` },
                        { label: '数据正确性', key: 'data_correctness', detail: `有效盘口${autoCheckLatest.summary.dataCorrectness.lineValid}，方向一致${autoCheckLatest.summary.dataCorrectness.directionConsistent}，比分异常${autoCheckLatest.summary.dataCorrectness.scoreAnomalies}` },
                        { label: '命中回打', key: 'hit_backfill', detail: `已回打${autoCheckLatest.summary.hitBackfill.finishedWithHit}，待回打${autoCheckLatest.summary.hitBackfill.finishedMissingHit}，不一致${autoCheckLatest.summary.hitBackfill.hitMismatch}` },
                        { label: '模型基线', key: 'model_baseline', detail: `V11应用${autoCheckLatest.summary.modelBaseline.v11Count}场，空特征${autoCheckLatest.summary.modelBaseline.emptyFeatures}，伤停生效${autoCheckLatest.summary.modelBaseline.injuryAdjustApplied}` },
                      ].map((item) => {
                        const categoryIssues = autoCheckLatest.issues.filter((i) => i.category === item.key);
                        const hasIssues = categoryIssues.length > 0;
                        return (
                          <div key={item.key} className={`rounded-lg border p-3 ${hasIssues ? 'border-red-200 bg-red-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-foreground">{item.label}</span>
                              {hasIssues ? (
                                <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px]">{categoryIssues.length}项</Badge>
                              ) : (
                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">正常</Badge>
                              )}
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{item.detail}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 问题列表 */}
                    {autoCheckLatest.issues.length > 0 && (
                      <div className="overflow-hidden rounded-lg border border-border/50">
                        <div className="bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                          问题明细（{autoCheckLatest.issues.length} 项）
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/20 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">分类</th>
                                <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">比赛</th>
                                <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">详情</th>
                                <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">级别</th>
                                <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">可修复</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {autoCheckLatest.issues.map((issue, idx) => (
                                <tr key={idx} className="hover:bg-muted/20">
                                  <td className="px-3 py-2 text-xs font-medium text-foreground whitespace-nowrap">
                                    {issue.subCategory.replace(/_/g, ' ')}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-foreground">
                                    <div>{issue.homeTeam} vs {issue.awayTeam}</div>
                                    <div className="text-[10px] text-muted-foreground">{issue.league} · {issue.matchNo}</div>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs">{issue.detail}</td>
                                  <td className="px-3 py-2">
                                    <Badge className={
                                      issue.severity === 'high'
                                        ? 'bg-red-100 text-red-700 hover:bg-red-100 text-[10px]'
                                        : issue.severity === 'medium'
                                        ? 'bg-orange-100 text-orange-700 hover:bg-orange-100 text-[10px]'
                                        : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100 text-[10px]'
                                    }>
                                      {issue.severity === 'high' ? '高' : issue.severity === 'medium' ? '中' : '低'}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2 text-xs">
                                    {issue.autoFixable ? (
                                      <span className="text-emerald-600">可自动</span>
                                    ) : (
                                      <span className="text-muted-foreground">需人工</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {autoCheckLatest.issues.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-6">
                        <CheckCircle2 className="mb-2 h-6 w-6 text-emerald-500" />
                        <p className="text-xs text-muted-foreground">全部检查项正常，万无一失</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <ShieldCheck className="mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">加载最新检查报告...</p>
                  </div>
                )}

                {/* 历史记录 */}
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-foreground">检查历史</h4>
                    <span className="text-[10px] text-muted-foreground">共 {autoCheckTotal} 条</span>
                  </div>
                  {autoCheckLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    </div>
                  ) : autoCheckHistory.length === 0 ? (
                    <div className="text-center py-4 text-xs text-muted-foreground">暂无历史记录</div>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {autoCheckHistory.map((r) => (
                        <div
                          key={r.id}
                          className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/30 ${
                            autoCheckLatest?.id === r.id ? 'bg-muted/40' : ''
                          }`}
                          onClick={() => setAutoCheckLatest(r)}
                        >
                          <div className="flex items-center gap-2">
                            <Badge className={
                              r.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]'
                                : 'bg-red-100 text-red-700 hover:bg-red-100 text-[10px]'
                            }>
                              {r.status === 'completed' ? '完成' : '失败'}
                            </Badge>
                            <span className="text-foreground">{r.triggerSource === 'sync' ? '同步触发' : '手动'}</span>
                            <span className="text-muted-foreground">{r.triggerTask || ''}</span>
                          </div>
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>{r.totalMatches}场 · {r.totalIssues}问题</span>
                            <span>{r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* === 竞彩覆盖巡检 === */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">竞彩覆盖巡检</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      检查足球与篮球的竞彩数据覆盖情况，自动修复可识别的问题，标记需人工处理的项
                    </p>
                  </div>
                  <Button size="sm" onClick={handleRunCoverageCheck} disabled={coverageLoading}>
                    {coverageLoading ? (
                      <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />巡检中</>
                    ) : (
                      <><Zap className="mr-1 h-3.5 w-3.5" />立即巡检</>
                    )}
                  </Button>
                </div>

                {coverageLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">正在执行竞彩覆盖巡检...</span>
                  </div>
                )}

                {coverageResult && !coverageLoading && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-ai-section-type="card-stat">
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Trophy className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-foreground">足球</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">问题总数</span>
                          <span className={`text-xl font-black tracking-tight ${coverageResult.football.totalIssues > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {coverageResult.football.totalIssues}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">自动修复</span>
                          <span className="text-sm font-semibold text-emerald-600">{coverageResult.football.autoFixed}</span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">需人工处理</span>
                          <span className="text-sm font-semibold text-amber-600">{coverageResult.football.needsManual}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Dumbbell className="h-4 w-4 text-orange-600" />
                        <span className="text-sm font-semibold text-foreground">篮球</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">问题总数</span>
                          <span className={`text-xl font-black tracking-tight ${coverageResult.basketball.totalIssues > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {coverageResult.basketball.totalIssues}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">自动修复</span>
                          <span className="text-sm font-semibold text-emerald-600">{coverageResult.basketball.autoFixed}</span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">需人工处理</span>
                          <span className="text-sm font-semibold text-amber-600">{coverageResult.basketball.needsManual}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!coverageResult && !coverageLoading && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Target className="mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">点击「立即巡检」检查竞彩数据覆盖情况</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* === Tab: 任务管理 === */}
            <TabsContent value="tasks" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">自动化任务</h3>
                  <Button variant="outline" size="sm" onClick={loadAutomationTasks} disabled={automationLoading}>
                    <RefreshCw className={`mr-1 h-4 w-4 ${automationLoading ? 'animate-spin' : ''}`} />
                    刷新
                  </Button>
                </div>

                {automationLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : automationTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <AlertCircle className="mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">暂无自动化任务</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border/50">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">任务名</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">描述</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Cron</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">触发方式</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">最近运行</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">状态</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">启用</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {automationTasks.map((task) => (
                          <tr key={task.name} className="hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{task.name}</span>
                                {task.isPlatformManaged && (
                                  <Badge variant="secondary" className="text-[10px]">平台托管</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{task.description}</td>
                            <td className="px-4 py-3 font-mono text-xs text-foreground">{task.cron}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{task.trigger}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {task.lastRunAt ? formatBeijingTimeShort(task.lastRunAt) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {task.isRunning ? (
                                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">运行中</Badge>
                              ) : task.lastStatus === 'success' ? (
                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">成功</Badge>
                              ) : task.lastStatus === 'failed' ? (
                                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">失败</Badge>
                              ) : (
                                <Badge variant="outline">未知</Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Switch
                                checked={task.enabled}
                                disabled={task.isPlatformManaged}
                                onCheckedChange={(checked) => handleToggleTask(task.name, checked)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* === Tab: 监控大盘 === */}
            <TabsContent value="monitor" className="mt-4 space-y-4">
              {/* 顶部操作 */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">监控大盘</h3>
                <Button variant="outline" size="sm" onClick={loadMonitorOverview} disabled={monitorLoading}>
                  <RefreshCw className={`mr-1 h-4 w-4 ${monitorLoading ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
              </div>

              {monitorLoading ? (
                <div className="flex items-center justify-center rounded-xl border border-border bg-card p-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : monitorData ? (
                <>
                  {/* 失败告警横幅 */}
                  {monitorData.failedAlerts.length > 0 ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        <h4 className="text-sm font-semibold text-red-800">
                          近24小时任务失败告警 ({monitorData.failedAlerts.length}条)
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {monitorData.failedAlerts.slice(0, 5).map((alert) => (
                          <div key={alert.id} className="flex items-start gap-3 rounded-lg bg-white/60 px-3 py-2 border border-red-100">
                            <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-foreground truncate">{alert.taskName}</span>
                                <span className="text-[10px] text-muted-foreground flex-shrink-0 font-mono">
                                  {formatBeijingTimeShort(alert.startedAt)}
                                </span>
                              </div>
                              <div className="text-[11px] text-red-600/80 mt-0.5 truncate">
                                {alert.errorMessage || '未知错误'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <div>
                          <h4 className="text-sm font-semibold text-emerald-800">运行正常</h4>
                          <p className="text-xs text-emerald-700/70">近24小时无失败任务</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 引擎升级信息 */}
                  {monitorData.engineInfo && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Cpu className="h-4 w-4 text-primary" />
                          <h4 className="text-sm font-semibold text-foreground">引擎版本</h4>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono font-bold text-primary">{monitorData.engineInfo.version}</div>
                          <div className="text-[10px] text-muted-foreground">{monitorData.engineInfo.versionName} · {monitorData.engineInfo.buildDate}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {[
                          { key: 'football', label: '足球', data: monitorData.engineInfo.football },
                          { key: 'basketball', label: '篮球', data: monitorData.engineInfo.basketball },
                        ].map((sport) => (
                          <div key={sport.key} className="space-y-3">
                            <div className="text-xs font-medium text-foreground">{sport.label}（未开场 {sport.data.upcomingTotal} 场）</div>
                            {[
                              { label: 'Elo 评分体系', count: sport.data.eloCount, pct: sport.data.eloCoverage },
                              { label: 'xG 预期进球', count: sport.data.xgCount, pct: sport.data.xgCoverage },
                              { label: 'ML 机器学习', count: sport.data.mlCount, pct: sport.data.mlCoverage },
                            ].map((layer) => (
                              <div key={layer.label}>
                                <div className="flex items-center justify-between text-[11px] mb-1">
                                  <span className="text-muted-foreground">{layer.label}</span>
                                  <span className="font-mono text-foreground">{layer.pct.toFixed(1)}% ({layer.count}场)</span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-border/30 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-primary transition-all duration-500"
                                    style={{ width: `${Math.min(100, layer.pct)}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 text-[10px] text-muted-foreground text-right">基于当前未开场比赛统计</div>
                    </div>
                  )}

                  {/* 数据健康度（足球/篮球两列） */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-ai-section-type="card-stat">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Trophy className="h-4 w-4 text-primary" />
                        <h4 className="text-sm font-semibold text-foreground">足球数据健康</h4>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">总数</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-foreground">{monitorData.dataHealth.footballTotal}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">未开赛</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-blue-600">{monitorData.dataHealth.footballUpcoming}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">进行中</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-amber-600">{monitorData.dataHealth.footballLive}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">已完赛</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-emerald-600">{monitorData.dataHealth.footballFinished}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">异常数</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-destructive">{monitorData.dataHealth.anomalyCount}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">观望率</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-amber-600">{monitorData.dataHealth.waitRateFootball.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Dumbbell className="h-4 w-4 text-primary" />
                        <h4 className="text-sm font-semibold text-foreground">篮球数据健康</h4>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">总数</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-foreground">{monitorData.dataHealth.basketballTotal}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">未开赛</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-blue-600">{monitorData.dataHealth.basketballUpcoming}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">进行中</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-amber-600">{monitorData.dataHealth.basketballLive}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">已完赛</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-emerald-600">{monitorData.dataHealth.basketballFinished}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">异常数</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-destructive">{monitorData.dataHealth.anomalyCount}</div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-background p-2.5 text-center">
                          <div className="text-[10px] text-muted-foreground">观望率</div>
                          <div className="mt-0.5 text-xl font-mono font-bold text-orange-600">{monitorData.dataHealth.waitRateBasketball.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 情报健康度 */}
                  {monitorData.injuryHealth && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4 text-primary" />
                          <h4 className="text-sm font-semibold text-foreground">情报健康度</h4>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          共 {monitorData.injuryHealth.totalReports} 条伤停记录
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {[
                          { key: 'football', label: '足球', upcoming: monitorData.injuryHealth.footballUpcomingTotal, covered: monitorData.injuryHealth.footballInjuryCovered, coverage: monitorData.injuryHealth.footballInjuryCoverage },
                          { key: 'basketball', label: '篮球', upcoming: monitorData.injuryHealth.basketballUpcomingTotal, covered: monitorData.injuryHealth.basketballInjuryCovered, coverage: monitorData.injuryHealth.basketballInjuryCoverage },
                        ].map((sport) => (
                          <div key={sport.key} className="space-y-3">
                            <div className="text-xs font-medium text-foreground">{sport.label}（未开场 {sport.upcoming} 场）</div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="rounded-lg border border-border/50 bg-background p-2 text-center">
                                <div className="text-[10px] text-muted-foreground">伤停覆盖</div>
                                <div className="mt-0.5 text-lg font-mono font-bold text-primary">{sport.coverage.toFixed(1)}%</div>
                              </div>
                              <div className="rounded-lg border border-border/50 bg-background p-2 text-center">
                                <div className="text-[10px] text-muted-foreground">覆盖场次</div>
                                <div className="mt-0.5 text-lg font-mono font-bold text-emerald-600">{sport.covered}</div>
                              </div>
                              <div className="rounded-lg border border-border/50 bg-background p-2 text-center">
                                <div className="text-[10px] text-muted-foreground">24h内缺</div>
                                <div className={`mt-0.5 text-lg font-mono font-bold ${monitorData.injuryHealth.missingInjury24h > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                  {sport.key === 'basketball' ? monitorData.injuryHealth.missingInjury24h : '-'}
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between text-[11px] mb-1">
                                <span className="text-muted-foreground">伤停覆盖率</span>
                                <span className="font-mono text-foreground">{sport.coverage.toFixed(1)}% ({sport.covered}/{sport.upcoming})</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-border/30 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-primary transition-all duration-500"
                                  style={{ width: `${Math.min(100, sport.coverage)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 pt-3 border-t border-border/50">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-foreground">伤停影响分布</div>
                          <div className="text-[10px] text-muted-foreground">
                            高 {monitorData.injuryHealth.highImpactReports} · 中 {monitorData.injuryHealth.mediumImpactReports} · 低 {monitorData.injuryHealth.lowImpactReports}
                          </div>
                        </div>
                        <div className="flex h-2 w-full rounded-full overflow-hidden bg-border/20">
                          {monitorData.injuryHealth.totalReports > 0 && (
                            <>
                              <div
                                className="bg-red-600"
                                style={{ width: `${(monitorData.injuryHealth.highImpactReports / monitorData.injuryHealth.totalReports) * 100}%` }}
                              />
                              <div
                                className="bg-amber-500"
                                style={{ width: `${(monitorData.injuryHealth.mediumImpactReports / monitorData.injuryHealth.totalReports) * 100}%` }}
                              />
                              <div
                                className="bg-emerald-500"
                                style={{ width: `${(monitorData.injuryHealth.lowImpactReports / monitorData.injuryHealth.totalReports) * 100}%` }}
                              />
                            </>
                          )}
                        </div>
                      </div>

                      {monitorData.injuryHealth.sourceLastSync.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-border/50">
                          <div className="text-xs font-medium text-foreground mb-2">数据源最近同步</div>
                          <div className="space-y-1.5">
                            {monitorData.injuryHealth.sourceLastSync.map((s) => (
                              <div key={`${s.sport}-${s.dataSource}`} className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block w-2 h-2 rounded-full ${
                                    s.status === 'ok' ? 'bg-emerald-500' : s.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'
                                  }`} />
                                   <span className="text-foreground">{DATA_SOURCE_LABELS[s.dataSource] || s.dataSource}</span>
                                   <span className="text-muted-foreground">· {SPORT_LABELS[s.sport] || s.sport}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-muted-foreground">{s.hoursSince.toFixed(1)}h 前</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 同步健康 */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="mb-3 text-sm font-semibold text-foreground">同步健康（近 7 天）</h4>
                    <div className="overflow-hidden rounded-lg border border-border/50">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">任务</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">运行次数</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">成功</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">失败</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">成功率</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">最近运行</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {monitorData.syncHealth.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                                暂无同步数据
                              </td>
                            </tr>
                          ) : (
                            monitorData.syncHealth.map((task) => (
                              <tr key={task.taskName} className="hover:bg-muted/20">
                                <td className="px-3 py-2 font-medium text-foreground">{task.taskName}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs">{task.totalRuns}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs text-emerald-600">{task.successRuns}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs text-red-600">{task.failedRuns}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs">
                                  <span className={task.successRate >= 0.95 ? 'text-emerald-600' : task.successRate >= 0.8 ? 'text-amber-600' : 'text-red-600'}>
                                    {(task.successRate * 100).toFixed(1)}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                  {task.lastRunAt ? formatBeijingTimeShort(task.lastRunAt) : '—'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 命中率趋势图 */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <h4 className="text-sm font-semibold text-foreground">命中率趋势</h4>
                      <div className="flex items-center gap-2">
                        <Tabs value={accuracySport} onValueChange={(v) => setAccuracySport(v as 'football' | 'basketball')} className="w-auto">
                          <TabsList className="h-7">
                            <TabsTrigger value="football" className="text-xs px-3 h-7">足球</TabsTrigger>
                            <TabsTrigger value="basketball" className="text-xs px-3 h-7">篮球</TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <Tabs value={accuracyDays} onValueChange={(v) => setAccuracyDays(v as '7' | '30')} className="w-auto">
                          <TabsList className="h-7">
                            <TabsTrigger value="7" className="text-xs px-3 h-7">近7天</TabsTrigger>
                            <TabsTrigger value="30" className="text-xs px-3 h-7">近30天</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                    </div>
                    {(() => {
                      const rawData = monitorData.dataAccuracy[accuracySport];
                      const daysNum = Number(accuracyDays);
                      const chartData = [...rawData].slice(0, daysNum).reverse();
                      const dates = chartData.map((d) => d.date.slice(5));
                      const CRIMSON_SEQ = ['#8B0000', '#A52A2A', '#CD5C5C', '#E9967A', '#FFA07A'];
                      const option: EChartsOption = {
                        tooltip: {
                          trigger: 'axis',
                          backgroundColor: '#1e293b',
                          borderColor: '#334155',
                          textStyle: { color: '#e5e7eb', fontSize: 12 },
                          axisPointer: { type: 'line', lineStyle: { color: '#8B0000', opacity: 0.3 } },
                        },
                        legend: {
                          data: ['胜平负', '让球', '大小球'],
                          top: 0,
                          right: 0,
                          textStyle: { color: '#6b7280', fontSize: 11 },
                          itemWidth: 12,
                          itemHeight: 8,
                        },
                        grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
                        xAxis: {
                          type: 'category',
                          data: dates,
                          axisLine: { lineStyle: { color: '#f3f4f6' } },
                          axisTick: { show: false },
                          axisLabel: {
                            color: '#9ca3af',
                            fontSize: 10,
                            interval: dates.length > 10 ? Math.floor(dates.length / 6) : 0,
                          },
                        },
                        yAxis: {
                          type: 'value',
                          min: 0,
                          max: 100,
                          axisLine: { show: false },
                          axisTick: { show: false },
                          splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } },
                          axisLabel: { color: '#9ca3af', fontSize: 10, formatter: '{value}%' },
                        },
                        series: [
                          {
                            name: '胜平负', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
                            showSymbol: false, lineStyle: { width: 2, color: CRIMSON_SEQ[0] },
                            itemStyle: { color: CRIMSON_SEQ[0] },
                              data: chartData.map((d) => Math.round(d.wdwHitRate * 10) / 10),
                          },
                          {
                            name: '让球', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
                            showSymbol: false, lineStyle: { width: 2, color: CRIMSON_SEQ[1] },
                            itemStyle: { color: CRIMSON_SEQ[1] },
                              data: chartData.map((d) => Math.round(d.handicapHitRate * 10) / 10),
                          },
                          {
                            name: '大小球', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
                            showSymbol: false, lineStyle: { width: 2, color: CRIMSON_SEQ[2] },
                            itemStyle: { color: CRIMSON_SEQ[2] },
                              data: chartData.map((d) => Math.round(d.overunderHitRate * 10) / 10),
                          },
                        ],
                      };
                      const summaryKey = `${accuracySport}${accuracyDays}d` as 'football7d' | 'football30d' | 'basketball7d' | 'basketball30d';
                      const summary = monitorData.accuracySummary[summaryKey];
                      return (
                        <>
                          {chartData.length === 0 ? (
                            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">暂无数据</div>
                          ) : (
                            <ReactECharts option={option} style={{ height: 260 }} opts={{ renderer: 'svg' }} />
                          )}
                          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border/50" data-ai-section-type="card-stat">
                            <div className="text-center">
                              <div className="text-[10px] text-muted-foreground">总场次</div>
                              <div className="mt-0.5 text-lg font-mono font-bold text-foreground">{summary.totalMatches}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-muted-foreground">胜平负</div>
                              <div className="mt-0.5 text-lg font-mono font-bold" style={{ color: CRIMSON_SEQ[0] }}>{summary.wdwHitRate.toFixed(1)}%</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-muted-foreground">让球</div>
                              <div className="mt-0.5 text-lg font-mono font-bold" style={{ color: CRIMSON_SEQ[1] }}>{summary.handicapHitRate.toFixed(1)}%</div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-muted-foreground">大小球</div>
                              <div className="mt-0.5 text-lg font-mono font-bold" style={{ color: CRIMSON_SEQ[2] }}>{summary.overunderHitRate.toFixed(1)}%</div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* 数据源同步状态 */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Database className="h-4 w-4 text-primary" />
                      <h4 className="text-sm font-semibold text-foreground">数据源同步状态（近 7 天）</h4>
                    </div>
                    <div className="space-y-2">
                      {monitorData.dataSourceStatus.length === 0 ? (
                        <div className="py-6 text-center text-xs text-muted-foreground">暂无数据源状态</div>
                      ) : (
                        monitorData.dataSourceStatus.map((ds) => (
                          <div key={ds.dataSource} className="rounded-lg border border-border/50 bg-background p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-medium text-foreground">{ds.dataSource}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                最近同步：{ds.lastRunAt ? formatBeijingTimeShort(ds.lastRunAt) : '—'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-red-900 to-nebula-crimson transition-all duration-500"
                                  style={{ width: `${Math.min(100, ds.successRate)}%` }}
                                />
                              </div>
                              <div className="flex items-center gap-2 text-[11px] font-mono w-36 justify-end">
                                <span className="text-emerald-600">{ds.successRuns}成</span>
                                <span className="text-red-500">{ds.failedRuns}败</span>
                                <span className={ds.successRate >= 0.95 ? 'text-emerald-600' : ds.successRate >= 0.8 ? 'text-amber-600' : 'text-red-600'}>
                                  {(ds.successRate).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 最近运行 */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="mb-3 text-sm font-semibold text-foreground">最近运行（20 条）</h4>
                    <div className="overflow-x-auto rounded-lg border border-border/50">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">任务名</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">触发方式</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">状态</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">开始时间</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">耗时</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">处理数</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">错误信息</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {monitorData.recentRuns.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                                暂无运行记录
                              </td>
                            </tr>
                          ) : (
                            monitorData.recentRuns.map((run) => (
                              <tr key={run.id} className="hover:bg-muted/20">
                                <td className="px-3 py-2 font-medium text-foreground">{run.taskName}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{run.trigger}</td>
                                <td className="px-3 py-2">
                                  {run.status === 'success' ? (
                                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">成功</Badge>
                                  ) : run.status === 'failed' ? (
                                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">失败</Badge>
                                  ) : run.status === 'running' ? (
                                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">运行中</Badge>
                                  ) : (
                                    <Badge variant="outline">{run.status}</Badge>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                  {formatBeijingTimeShort(run.startedAt)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-xs">
                                  {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-xs">
                                  {run.recordsUpdated != null ? run.recordsUpdated : '—'}
                                </td>
                                <td className="px-3 py-2 max-w-[200px] truncate text-xs text-red-600">
                                  {run.errorMessage || '—'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-16 text-center">
                  <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">点击「刷新」加载监控数据</p>
                </div>
              )}
            </TabsContent>

            {/* === Tab 7: 客服工单 === */}
           <TabsContent value="support" className="mt-4 space-y-4">
             {/* 统计卡片 */}
             <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-ai-section-type="card-stat">
               <div className="rounded-xl border border-border bg-card p-4">
                 <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <Clock className="h-3.5 w-3.5 text-accent" />
                   <span>待处理</span>
                 </div>
                 <div className="mt-2 text-2xl font-mono font-bold text-accent">
                   {adminStatsLoading ? '...' : adminStats?.open ?? 0}
                 </div>
               </div>
               <div className="rounded-xl border border-border bg-card p-4">
                 <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <Activity className="h-3.5 w-3.5 text-primary" />
                   <span>处理中</span>
                 </div>
                 <div className="mt-2 text-2xl font-mono font-bold text-primary">
                   {adminStatsLoading ? '...' : adminStats?.processing ?? 0}
                 </div>
               </div>
               <div className="rounded-xl border border-border bg-card p-4">
                 <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                   <span>已关闭</span>
                 </div>
                 <div className="mt-2 text-2xl font-mono font-bold text-muted-foreground">
                   {adminStatsLoading ? '...' : adminStats?.closed ?? 0}
                 </div>
               </div>
               <div className="rounded-xl border border-border bg-card p-4">
                 <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <Zap className="h-3.5 w-3.5 text-home-win" />
                   <span>今日新增</span>
                 </div>
                 <div className="mt-2 text-2xl font-mono font-bold text-home-win">
                   {adminStatsLoading ? '...' : adminStats?.todayNew ?? 0}
                 </div>
               </div>
             </div>

             {/* 筛选行 */}
             <div className="flex flex-wrap items-center justify-between gap-3">
               <Tabs
                 value={supportStatusFilter}
                 onValueChange={(v) =>
                   setSupportStatusFilter(v as 'all' | 'open' | 'processing' | 'closed')
                 }
                 className="w-auto"
               >
                 <TabsList>
                   <TabsTrigger value="all">全部</TabsTrigger>
                   <TabsTrigger value="open">待处理</TabsTrigger>
                   <TabsTrigger value="processing">处理中</TabsTrigger>
                   <TabsTrigger value="closed">已关闭</TabsTrigger>
                 </TabsList>
               </Tabs>
               <Button
                 variant="outline"
                 size="sm"
                 onClick={() => {
                   void loadAdminStats();
                   void loadSupportTickets();
                 }}
                 disabled={supportLoading}
               >
                 {supportLoading ? (
                   <Loader2 className="h-4 w-4 animate-spin" />
                 ) : (
                   <RefreshCw className="h-4 w-4" />
                 )}
                 <span className="ml-1">刷新</span>
               </Button>
             </div>

             {/* 错误提示 */}
             {supportError && (
               <div className="rounded-xl border border-destructive/30 bg-card p-6 text-center">
                 <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-destructive" />
                 <p className="text-sm font-medium text-destructive">{supportError}</p>
               </div>
             )}

             {/* 工单列表 - 桌面端 */}
             {!supportError && (
               <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>工单标题</TableHead>
                       <TableHead>提交人</TableHead>
                       <TableHead>类别</TableHead>
                       <TableHead>状态</TableHead>
                       <TableHead>优先级</TableHead>
                       <TableHead>最近消息</TableHead>
                       <TableHead className="text-center">未读</TableHead>
                       <TableHead className="text-right">操作</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {supportLoading && supportTickets.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                           <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                           加载中...
                         </TableCell>
                       </TableRow>
                     ) : supportTickets.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                           暂无工单
                         </TableCell>
                       </TableRow>
                     ) : (
                       supportTickets.map((ticket) => (
                         <TableRow key={ticket.id}>
                           <TableCell className="max-w-[240px]">
                             <div className="truncate text-sm font-medium text-foreground">
                               {ticket.title}
                             </div>
                           </TableCell>
                           <TableCell className="font-mono text-xs text-muted-foreground">
                             {ticket.email || '-'}
                           </TableCell>
                           <TableCell>
                             <Badge
                               variant="outline"
                               className={CATEGORY_BADGE[ticket.category] || CATEGORY_BADGE['其他']}
                             >
                               {ticket.category}
                             </Badge>
                           </TableCell>
                           <TableCell>
                             <Badge
                               variant="outline"
                               className={STATUS_BADGE_SUPPORT[ticket.status]}
                             >
                               {STATUS_LABEL[ticket.status]}
                             </Badge>
                           </TableCell>
                           <TableCell>
                             {ticket.priority === 'urgent' ? (
                               <Badge
                                 variant="outline"
                                 className="border-destructive/30 bg-destructive/10 text-destructive"
                               >
                                 紧急
                               </Badge>
                             ) : (
                               <Badge variant="outline" className="border-border text-muted-foreground">
                                 普通
                               </Badge>
                             )}
                           </TableCell>
                           <TableCell className="font-mono text-xs text-muted-foreground">
                             {ticket.lastMessageAt
                               ? formatLocalTimeShort(ticket.lastMessageAt)
                               : formatLocalTimeShort(ticket.createdAt)}
                           </TableCell>
                           <TableCell className="text-center">
                             {ticket.unreadByAdmin > 0 ? (
                               <span className="inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                                 {ticket.unreadByAdmin > 99 ? '99+' : ticket.unreadByAdmin}
                               </span>
                             ) : (
                               <span className="text-xs text-muted-foreground/40">—</span>
                             )}
                           </TableCell>
                           <TableCell className="text-right">
                             <Button
                               variant="ghost"
                               size="sm"
                               className="h-7 text-xs"
                               onClick={() => handleViewTicket(ticket)}
                             >
                               <Eye className="mr-1 h-3.5 w-3.5" />
                               查看
                             </Button>
                           </TableCell>
                         </TableRow>
                       ))
                     )}
                   </TableBody>
                 </Table>
               </div>
             )}

             {/* 工单列表 - 移动端卡片 */}
             {!supportError && (
               <div className="space-y-3 md:hidden">
                 {supportLoading && supportTickets.length === 0 && (
                   <div className="rounded-xl border border-border bg-card p-6 text-center">
                     <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                     <p className="text-sm text-muted-foreground">加载中...</p>
                   </div>
                 )}
                 {!supportLoading && supportTickets.length === 0 && (
                   <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                     暂无工单
                   </div>
                 )}
                 {supportTickets.map((ticket) => (
                   <div
                     key={ticket.id}
                     className="space-y-3 rounded-xl border border-border bg-card p-4"
                   >
                     <div className="flex items-start justify-between gap-2">
                       <div className="min-w-0 flex-1">
                         <div className="truncate text-sm font-medium text-foreground">
                           {ticket.title}
                         </div>
                         <div className="mt-1 flex items-center gap-2">
                           <Badge
                             variant="outline"
                             className={STATUS_BADGE_SUPPORT[ticket.status]}
                           >
                             {STATUS_LABEL[ticket.status]}
                           </Badge>
                           {ticket.priority === 'urgent' && (
                             <Badge
                               variant="outline"
                               className="border-destructive/30 bg-destructive/10 text-destructive"
                             >
                               紧急
                             </Badge>
                           )}
                           {ticket.unreadByAdmin > 0 && (
                             <span className="inline-flex min-w-[18px] h-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                               {ticket.unreadByAdmin > 99 ? '99+' : ticket.unreadByAdmin}
                             </span>
                           )}
                         </div>
                       </div>
                     </div>
                     <div className="grid grid-cols-2 gap-2 text-xs">
                       <div>
                         <div className="text-muted-foreground">类别</div>
                         <div className="text-foreground">{ticket.category}</div>
                       </div>
                       <div>
                         <div className="text-muted-foreground">提交人</div>
                         <div className="truncate font-mono text-foreground">
                           {ticket.email || '-'}
                         </div>
                       </div>
                       <div className="col-span-2">
                         <div className="text-muted-foreground">最近消息</div>
                         <div className="font-mono text-foreground">
                           {ticket.lastMessageAt
                             ? formatBeijingTimeShort(ticket.lastMessageAt)
                             : formatBeijingTimeShort(ticket.createdAt)}
                         </div>
                       </div>
                     </div>
                     <Button
                       variant="outline"
                       size="sm"
                       className="w-full"
                       onClick={() => handleViewTicket(ticket)}
                     >
                       <Eye className="mr-1 h-3.5 w-3.5" />
                       查看详情
                     </Button>
                   </div>
                 ))}
               </div>
             )}

             {/* 分页 */}
             {supportTotal > 0 && (
               <div className="flex items-center justify-between">
                 <span className="text-xs text-muted-foreground">
                   共 {supportTotal} 条，第 {supportPage}/{totalSupportPages} 页
                 </span>
                 <div className="flex items-center gap-1">
                   <Button
                     variant="outline"
                     size="sm"
                     className="h-8 w-8 p-0"
                     onClick={() => setSupportPage((p: number) => Math.max(1, p - 1))}
                     disabled={supportPage <= 1 || supportLoading}
                   >
                     <ChevronLeft className="h-4 w-4" />
                   </Button>
                   <Button
                     variant="outline"
                     size="sm"
                     className="h-8 w-8 p-0"
                     onClick={() =>
                       setSupportPage((p: number) => Math.min(totalSupportPages, p + 1))
                     }
                     disabled={supportPage >= totalSupportPages || supportLoading}
                   >
                     <ChevronRight className="h-4 w-4" />
                   </Button>
                 </div>
               </div>
             )}
           </TabsContent>
         </Tabs>

         {/* === 工单详情侧边栏 === */}
         <Sheet open={ticketDetailOpen} onOpenChange={setTicketDetailOpen}>
           <SheetContent side="right" className="w-full p-0 sm:max-w-lg">
             {ticketDetailLoading && !selectedTicket && (
               <div className="flex h-full items-center justify-center p-8">
                 <Loader2 className="h-8 w-8 animate-spin text-primary" />
               </div>
             )}

             {!ticketDetailLoading && !selectedTicket && (
               <div className="flex h-full items-center justify-center p-8 text-center">
                 <div>
                   <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                   <p className="text-sm text-muted-foreground">工单加载失败</p>
                 </div>
               </div>
             )}

             {selectedTicket && (
               <div className="flex h-full flex-col">
                 {/* 顶部 */}
                 <SheetHeader className="border-b border-border px-6 py-4">
                   <div className="flex items-start justify-between gap-2">
                     <div className="min-w-0 flex-1">
                       <SheetTitle className="text-base">{selectedTicket.title}</SheetTitle>
                       <div className="mt-2 flex flex-wrap items-center gap-2">
                         <Badge
                           variant="outline"
                           className={STATUS_BADGE_SUPPORT[selectedTicket.status]}
                         >
                           {STATUS_LABEL[selectedTicket.status]}
                         </Badge>
                         {selectedTicket.priority === 'urgent' ? (
                           <Badge
                             variant="outline"
                             className="border-destructive/30 bg-destructive/10 text-destructive"
                           >
                             紧急
                           </Badge>
                         ) : (
                           <Badge variant="outline" className="border-border text-muted-foreground">
                             普通
                           </Badge>
                         )}
                         <Badge
                           variant="outline"
                           className={
                             CATEGORY_BADGE[selectedTicket.category] || CATEGORY_BADGE['其他']
                           }
                         >
                           {selectedTicket.category}
                         </Badge>
                       </div>
                       <div className="mt-2 text-xs text-muted-foreground">
                         <span>提交人：</span>
                         <span className="font-mono">{selectedTicket.email || '未提供'}</span>
                       </div>
                     </div>
                   </div>

                   {/* 操作按钮组 */}
                   <div className="mt-3 flex flex-wrap gap-2">
                     {selectedTicket.status === 'open' && (
                       <Button
                         size="sm"
                         className="h-7 text-xs"
                         onClick={() => void handleUpdateStatus('processing')}
                         disabled={ticketActionLoading}
                       >
                         开始处理
                       </Button>
                     )}
                     {selectedTicket.status === 'processing' && (
                       <Button
                         size="sm"
                         variant="outline"
                         className="h-7 text-xs"
                         onClick={() => void handleUpdateStatus('closed')}
                         disabled={ticketActionLoading}
                       >
                         关闭工单
                       </Button>
                     )}
                     {selectedTicket.status === 'closed' && (
                       <Button
                         size="sm"
                         variant="outline"
                         className="h-7 text-xs"
                         onClick={() => void handleUpdateStatus('open')}
                         disabled={ticketActionLoading}
                       >
                         重新打开
                       </Button>
                     )}
                     {selectedTicket.priority === 'normal' ? (
                       <Button
                         size="sm"
                         variant="outline"
                         className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                         onClick={() => void handleUpdatePriority('urgent')}
                         disabled={ticketActionLoading}
                       >
                         设为紧急
                       </Button>
                     ) : (
                       <Button
                         size="sm"
                         variant="outline"
                         className="h-7 text-xs"
                         onClick={() => void handleUpdatePriority('normal')}
                         disabled={ticketActionLoading}
                       >
                         设为普通
                       </Button>
                     )}
                   </div>
                 </SheetHeader>

                 {/* 消息列表 */}
                 <div className="flex-1 overflow-y-auto px-4 py-4">
                   {selectedTicket.messages.length === 0 && (
                     <div className="py-8 text-center text-sm text-muted-foreground">
                       暂无消息
                     </div>
                   )}
                   <div className="space-y-3">
                     {selectedTicket.messages.map((msg) => (
                       <div
                         key={msg.id}
                         className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}
                       >
                         <div
                           className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                             msg.sender === 'admin'
                               ? 'bg-primary text-primary-foreground rounded-br-sm'
                               : 'bg-muted text-foreground rounded-bl-sm'
                           }`}
                         >
                           <div className="whitespace-pre-wrap break-words">{msg.body}</div>
                           <div
                             className={`mt-1 text-[10px] font-mono ${
                               msg.sender === 'admin'
                                 ? 'text-primary-foreground/60'
                                 : 'text-muted-foreground'
                             }`}
                           >
                             {formatLocalTimeShort(msg.createdAt)}
                           </div>
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>

                 {/* 底部输入框 */}
                 <div className="border-t border-border p-3">
                   <div className="flex items-end gap-2">
                     <Textarea
                       value={replyText}
                       onChange={(e) => setReplyText(e.target.value)}
                       placeholder="输入回复内容..."
                       rows={2}
                       className="resize-none"
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                           e.preventDefault();
                           void handleAdminReply();
                         }
                       }}
                     />
                     <Button
                       onClick={() => void handleAdminReply()}
                       disabled={!replyText.trim() || replySending}
                       size="icon"
                       className="h-10 w-10 shrink-0"
                     >
                       {replySending ? (
                         <Loader2 className="h-4 w-4 animate-spin" />
                       ) : (
                         <Send className="h-4 w-4" />
                       )}
                     </Button>
                   </div>
                   <p className="mt-1 text-[10px] text-muted-foreground">
                     按 Ctrl/⌘ + Enter 快速发送
                   </p>
                 </div>
               </div>
             )}
           </SheetContent>
         </Sheet>

      {/* === 用户操作确认弹窗 === */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmUserAction.type === 'delete'
                ? '确认删除用户'
                : confirmUserAction.targetRole === 'admin'
                  ? '确认设为管理员'
                  : '确认取消管理员'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmUserAction.type === 'delete'
                ? `确定要删除用户 ${confirmUserAction.user?.email ?? ''} 吗？此操作不可撤销。`
                : confirmUserAction.targetRole === 'admin'
                  ? `确定要将 ${confirmUserAction.user?.email ?? ''} 设为管理员吗？`
                  : `确定要取消 ${confirmUserAction.user?.email ?? ''} 的管理员权限吗？`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmUserAction();
              }}
              disabled={actionLoading}
              className={confirmUserAction.type === 'delete' ? 'bg-destructive hover:bg-destructive/90' : ''}
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmUserAction.type === 'delete' ? '删除' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* === 比赛添加/编辑弹窗 === */}
      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle>{editingMatchId ? '编辑比赛' : '添加比赛'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="matchNo">比赛编号 *</Label>
              <Input
                id="matchNo"
                value={matchForm.matchNo}
                onChange={(e) => handleMatchFormChange('matchNo', e.target.value)}
                placeholder="如 001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="league">联赛</Label>
              <Input
                id="league"
                value={matchForm.league}
                onChange={(e) => handleMatchFormChange('league', e.target.value)}
                placeholder="如 英超"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="homeTeam">主队 *</Label>
              <Input
                id="homeTeam"
                value={matchForm.homeTeam}
                onChange={(e) => handleMatchFormChange('homeTeam', e.target.value)}
                placeholder="主队名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="awayTeam">客队 *</Label>
              <Input
                id="awayTeam"
                value={matchForm.awayTeam}
                onChange={(e) => handleMatchFormChange('awayTeam', e.target.value)}
                placeholder="客队名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kickoffTime">开赛时间</Label>
              <Input
                id="kickoffTime"
                type="datetime-local"
                value={matchForm.kickoffTime}
                onChange={(e) => handleMatchFormChange('kickoffTime', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="matchDate">比赛日期</Label>
              <Input
                id="matchDate"
                type="date"
                value={matchForm.matchDate}
                onChange={(e) => handleMatchFormChange('matchDate', e.target.value)}
              />
            </div>

             {/* 赛果概率 */}
            <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">赛果概率</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="homeWinProb">主胜概率 (%)</Label>
              <Input
                id="homeWinProb"
                type="number"
                value={matchForm.homeWinProb}
                onChange={(e) => handleMatchFormChange('homeWinProb', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawProb">平局概率 (%)</Label>
              <Input
                id="drawProb"
                type="number"
                value={matchForm.drawProb}
                onChange={(e) => handleMatchFormChange('drawProb', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="awayWinProb">客胜概率 (%)</Label>
              <Input
                id="awayWinProb"
                type="number"
                value={matchForm.awayWinProb}
                onChange={(e) => handleMatchFormChange('awayWinProb', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
               <Label htmlFor="predictionDirection">分析方向</Label>
              <Select
                value={matchForm.predictionDirection}
                onValueChange={(val) =>
                  handleMatchFormChange('predictionDirection', val)
                }
              >
                <SelectTrigger className="w-full">
                   <SelectValue placeholder="选择分析方向" />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

             {/* 让分 */}
            <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">让分</span>
            </div>
            <div className="space-y-1.5">
               <Label htmlFor="handicap">让分数</Label>
              <Input
                id="handicap"
                value={matchForm.handicap}
                onChange={(e) => handleMatchFormChange('handicap', e.target.value)}
                placeholder="如 -1, +1, 0"
              />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="handicapRecommendation">让分指数参考</Label>
              <Input
                id="handicapRecommendation"
                value={matchForm.handicapRecommendation}
                onChange={(e) =>
                  handleMatchFormChange('handicapRecommendation', e.target.value)
                }
                  placeholder="让分参考方向"
              />
            </div>

             {/* 参考指数 */}
            <div className="space-y-1.5">
               <Label htmlFor="confidence">参考指数 (%)</Label>
              <Input
                id="confidence"
                type="number"
                value={matchForm.confidence}
                onChange={(e) => handleMatchFormChange('confidence', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
               <Label>低参考</Label>
              <div className="flex h-9 items-center">
                <Switch
                  checked={matchForm.lowConfidence}
                  onCheckedChange={(checked) =>
                    handleMatchFormChange('lowConfidence', checked)
                  }
                />
                <span className="ml-2 text-sm text-muted-foreground">
                  {matchForm.lowConfidence ? '是' : '否'}
                </span>
              </div>
            </div>

             {/* 进球数 */}
            <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">进球数</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="overUnder">指数</Label>
              <Input
                id="overUnder"
                value={matchForm.overUnder}
                onChange={(e) => handleMatchFormChange('overUnder', e.target.value)}
                placeholder="如 2.5"
              />
            </div>
            <div className="space-y-1.5">
               <Label htmlFor="totalGoals">预期进球数</Label>
              <Input
                id="totalGoals"
                type="number"
                step="0.1"
                value={matchForm.totalGoals}
                onChange={(e) => handleMatchFormChange('totalGoals', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
               <Label htmlFor="overProb">进球偏多概率(旧,%) - 建议用四档进球数</Label>
              <Input
                id="overProb"
                type="number"
                value={matchForm.overProb}
                onChange={(e) => handleMatchFormChange('overProb', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
               <Label htmlFor="underProb">进球偏少概率(旧,%) - 建议用四档进球数</Label>
              <Input
                id="underProb"
                type="number"
                value={matchForm.underProb}
                onChange={(e) => handleMatchFormChange('underProb', e.target.value)}
              />
            </div>

            {/* 比分预测 */}
            <div className="col-span-full mt-1 border-t border-border/50 pt-3">
              <span className="text-xs font-medium text-foreground">比分预测</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mostLikelyScore">最可能比分</Label>
              <Input
                id="mostLikelyScore"
                value={matchForm.mostLikelyScore}
                onChange={(e) => handleMatchFormChange('mostLikelyScore', e.target.value)}
                placeholder="如 2-1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scoreProbs">比分概率 (逗号分隔)</Label>
              <Input
                id="scoreProbs"
                value={matchForm.scoreProbs}
                onChange={(e) => handleMatchFormChange('scoreProbs', e.target.value)}
                placeholder="如 2-1:15%, 1-1:12%"
              />
            </div>

            {/* 比赛状态 */}
            <div className="col-span-full mt-1 border-t border-border/50 pt-3">
              <span className="text-xs font-medium text-foreground">比赛状态</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="matchStatus">状态</Label>
              <Select
                value={matchForm.matchStatus}
                onValueChange={(val) => handleMatchFormChange('matchStatus', val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="homeScore">主队比分</Label>
                <Input
                  id="homeScore"
                  type="number"
                  value={matchForm.homeScore}
                  onChange={(e) => handleMatchFormChange('homeScore', e.target.value)}
                  placeholder="-"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="awayScore">客队比分</Label>
                <Input
                  id="awayScore"
                  type="number"
                  value={matchForm.awayScore}
                  onChange={(e) => handleMatchFormChange('awayScore', e.target.value)}
                  placeholder="-"
                />
              </div>
            </div>

            {/* 模型规则 & 情报 */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="modelRules">模型规则 (逗号分隔)</Label>
              <Input
                id="modelRules"
                value={matchForm.modelRules}
                onChange={(e) => handleMatchFormChange('modelRules', e.target.value)}
                placeholder="如 R36,R39,R42"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="intel">情报分析</Label>
              <Textarea
                id="intel"
                value={matchForm.intel}
                onChange={(e) => handleMatchFormChange('intel', e.target.value)}
                placeholder="伤停、状态、H2H等情报分析..."
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={saving}>
                取消
              </Button>
            </DialogClose>
            <Button onClick={handleSaveMatch} disabled={saving}>
              {saving ? '保存中...' : '保存'}
              <Check className="h-4 w-4" />
            </Button>
          </DialogFooter>
         </DialogContent>
       </Dialog>

       {/* === 回填赛果弹窗 === */}
       <Dialog open={scoreDialogOpen} onOpenChange={setScoreDialogOpen}>
         <DialogContent className="border-border bg-card max-w-md">
           <DialogHeader>
             <DialogTitle>回填赛果</DialogTitle>
             <DialogDescription className="text-sm text-muted-foreground">
               {scoreMatchName}
             </DialogDescription>
           </DialogHeader>

           <div className="grid grid-cols-3 gap-4 py-4 items-end">
             <div className="space-y-1.5">
               <Label className="text-xs text-muted-foreground">主队比分</Label>
               <Input
                 type="number"
                 value={scoreForm.homeScore}
                 onChange={(e) => setScoreForm((p) => ({ ...p, homeScore: Number(e.target.value) }))}
                 className="text-center text-xl font-bold"
               />
             </div>
             <div className="text-center text-2xl font-bold text-muted-foreground">-</div>
             <div className="space-y-1.5">
               <Label className="text-xs text-muted-foreground text-right block">客队比分</Label>
               <Input
                 type="number"
                 value={scoreForm.awayScore}
                 onChange={(e) => setScoreForm((p) => ({ ...p, awayScore: Number(e.target.value) }))}
                 className="text-center text-xl font-bold"
               />
             </div>
           </div>

           <div className="space-y-1.5">
             <Label className="text-xs text-muted-foreground">比赛状态</Label>
             <Select
               value={scoreForm.matchStatus}
               onValueChange={(val) => setScoreForm((p) => ({ ...p, matchStatus: val }))}
             >
               <SelectTrigger>
                 <SelectValue />
               </SelectTrigger>
               <SelectContent>
                 {STATUS_OPTIONS.map((opt) => (
                   <SelectItem key={opt.value} value={opt.value}>
                     {opt.label}
                   </SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>

           <DialogFooter className="mt-4">
             <DialogClose asChild>
               <Button variant="outline" disabled={scoreSaving}>
                 取消
               </Button>
             </DialogClose>
             <Button onClick={handleScoreUpdate} disabled={scoreSaving}>
               {scoreSaving ? '回填中...' : '确认回填'}
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>

       {/* === 篮球比赛编辑弹窗 === */}
       <Dialog open={bballDialogOpen} onOpenChange={setBballDialogOpen}>
         <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
           <DialogHeader>
             <DialogTitle>{bballEditingMatchId ? '编辑篮球比赛' : '添加篮球比赛'}</DialogTitle>
           </DialogHeader>

           <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
             <div className="space-y-1.5">
               <Label htmlFor="bball-matchNo">比赛编号</Label>
               <Input
                 id="bball-matchNo"
                 value={String(bballForm.matchNo || '')}
                 onChange={(e) => handleBballFormChange('matchNo', e.target.value)}
                 placeholder="如 301"
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-league">联赛</Label>
               <Input
                 id="bball-league"
                 value={String(bballForm.league || '')}
                 onChange={(e) => handleBballFormChange('league', e.target.value)}
                 placeholder="如 NBA"
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-homeTeam">主队 *</Label>
               <Input
                 id="bball-homeTeam"
                 value={String(bballForm.homeTeam || '')}
                 onChange={(e) => handleBballFormChange('homeTeam', e.target.value)}
                 placeholder="主队名称"
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-awayTeam">客队 *</Label>
               <Input
                 id="bball-awayTeam"
                 value={String(bballForm.awayTeam || '')}
                 onChange={(e) => handleBballFormChange('awayTeam', e.target.value)}
                 placeholder="客队名称"
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-kickoffTime">开赛时间</Label>
               <Input
                 id="bball-kickoffTime"
                 type="datetime-local"
                 value={String(bballForm.kickoffTime || '')}
                 onChange={(e) => handleBballFormChange('kickoffTime', e.target.value)}
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-matchDate">比赛日期</Label>
               <Input
                 id="bball-matchDate"
                 type="date"
                 value={String(bballForm.matchDate || '')}
                 onChange={(e) => handleBballFormChange('matchDate', e.target.value)}
               />
             </div>

             {/* 让分盘 */}
             <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">让分盘</span>
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-handicap">让分盘</Label>
               <Input
                 id="bball-handicap"
                 value={String(bballForm.handicap || '')}
                 onChange={(e) => handleBballFormChange('handicap', e.target.value)}
                 placeholder="如 -5.5"
               />
             </div>
             <div className="space-y-1.5">
                 <Label htmlFor="bball-handicapRecommendation">让分参考（内部字段）</Label>
                <Input
                  id="bball-handicapRecommendation"
                  value={String(bballForm.handicapRecommendation || '')}
                  onChange={(e) => handleBballFormChange('handicapRecommendation', e.target.value)}
                  placeholder="让分主胜/让分客胜（不展示给用户）"
                />
             </div>

             {/* 总分盘 */}
             <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">总分盘</span>
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-totalLine">总分盘</Label>
               <Input
                 id="bball-totalLine"
                 value={String(bballForm.totalLine || '')}
                 onChange={(e) => handleBballFormChange('totalLine', e.target.value)}
                 placeholder="如 215.5"
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-confidence">信心度 (%)</Label>
               <Input
                 id="bball-confidence"
                 type="number"
                 value={String(bballForm.confidence || '0')}
                 onChange={(e) => handleBballFormChange('confidence', e.target.value)}
               />
             </div>

             {/* 概率与方向 */}
             <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">概率与方向</span>
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-homeWinProb">主胜概率 (%)</Label>
               <Input
                 id="bball-homeWinProb"
                 type="number"
                 value={String(bballForm.homeWinProb || '0')}
                 onChange={(e) => handleBballFormChange('homeWinProb', e.target.value)}
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-awayWinProb">客胜概率 (%)</Label>
               <Input
                 id="bball-awayWinProb"
                 type="number"
                 value={String(bballForm.awayWinProb || '0')}
                 onChange={(e) => handleBballFormChange('awayWinProb', e.target.value)}
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-predictionDirection">模型倾向</Label>
               <Select
                 value={String(bballForm.predictionDirection || '主胜')}
                 onValueChange={(val) => handleBballFormChange('predictionDirection', val)}
               >
                 <SelectTrigger id="bball-predictionDirection">
                   <SelectValue placeholder="选择方向" />
                 </SelectTrigger>
                 <SelectContent>
                    <SelectItem value="主胜">主胜</SelectItem>
                    <SelectItem value="客胜">客胜</SelectItem>
                    <SelectItem value="观望">观望</SelectItem>
                 </SelectContent>
               </Select>
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-category">分类</Label>
               <Select
                 value={String(bballForm.category || 'official')}
                 onValueChange={(val) => handleBballFormChange('category', val)}
               >
                 <SelectTrigger id="bball-category">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                    <SelectItem value="official">官方数据源</SelectItem>
                   <SelectItem value="overseas">海外赛事</SelectItem>
                   <SelectItem value="wnba">WNBA</SelectItem>
                 </SelectContent>
               </Select>
             </div>

             {/* 比赛状态 */}
             <div className="col-span-full mt-1 border-t border-border/50 pt-3">
               <span className="text-xs font-medium text-foreground">比赛状态</span>
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="bball-matchStatus">状态</Label>
               <Select
                 value={String(bballForm.matchStatus || 'upcoming')}
                 onValueChange={(val) => handleBballFormChange('matchStatus', val)}
               >
                 <SelectTrigger id="bball-matchStatus">
                   <SelectValue placeholder="选择状态" />
                 </SelectTrigger>
                 <SelectContent>
                   {STATUS_OPTIONS.map((opt) => (
                     <SelectItem key={opt.value} value={opt.value}>
                       {opt.label}
                     </SelectItem>
                   ))}
                   <SelectItem value="live">进行中</SelectItem>
                 </SelectContent>
               </Select>
             </div>
             <div className="grid grid-cols-2 gap-2">
               <div className="space-y-1.5">
                 <Label htmlFor="bball-homeScore">主队得分</Label>
                 <Input
                   id="bball-homeScore"
                   type="number"
                   value={String(bballForm.homeScore ?? '')}
                   onChange={(e) => handleBballFormChange('homeScore', e.target.value)}
                   placeholder="-"
                 />
               </div>
               <div className="space-y-1.5">
                 <Label htmlFor="bball-awayScore">客队得分</Label>
                 <Input
                   id="bball-awayScore"
                   type="number"
                   value={String(bballForm.awayScore ?? '')}
                   onChange={(e) => handleBballFormChange('awayScore', e.target.value)}
                   placeholder="-"
                 />
               </div>
             </div>

             {/* 情报 & 模型规则 */}
             <div className="space-y-1.5 sm:col-span-2">
               <Label htmlFor="bball-modelRules">模型规则 (逗号分隔)</Label>
               <Input
                 id="bball-modelRules"
                 value={String(bballForm.modelRules || '')}
                 onChange={(e) => handleBballFormChange('modelRules', e.target.value)}
                 placeholder="如 R41,R77,R44"
               />
             </div>
             <div className="space-y-1.5 sm:col-span-2">
               <Label htmlFor="bball-intel">情报分析</Label>
               <Textarea
                 id="bball-intel"
                 value={String(bballForm.intel || '')}
                 onChange={(e) => handleBballFormChange('intel', e.target.value)}
                 placeholder="伤停、状态、H2H等情报分析..."
                 rows={3}
               />
             </div>
             <div className="space-y-1.5 sm:col-span-2">
               <Label htmlFor="bball-riskWarning">风险提示</Label>
               <Textarea
                 id="bball-riskWarning"
                 value={String(bballForm.riskWarning || '')}
                 onChange={(e) => handleBballFormChange('riskWarning', e.target.value)}
                 placeholder="风险警告信息..."
                 rows={2}
               />
             </div>
           </div>

           <DialogFooter>
             <DialogClose asChild>
               <Button variant="outline" disabled={bballSaving}>
                 取消
               </Button>
             </DialogClose>
             <Button onClick={handleBballSave} disabled={bballSaving}>
               {bballSaving ? '保存中...' : '保存'}
               <Check className="h-4 w-4" />
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>

       {/* === 篮球比分回填弹窗 === */}
       <Dialog open={bballScoreDialogOpen} onOpenChange={setBballScoreDialogOpen}>
         <DialogContent className="border-border bg-card max-w-md">
           <DialogHeader>
             <DialogTitle>更新比分（篮球）</DialogTitle>
             <DialogDescription className="text-sm text-muted-foreground">
               {bballScoreMatchName}
             </DialogDescription>
           </DialogHeader>

           <div className="grid grid-cols-3 gap-4 py-4 items-end">
             <div className="space-y-1.5">
               <Label className="text-xs text-muted-foreground">主队比分</Label>
               <Input
                 type="number"
                 value={bballScoreForm.homeScore}
                 onChange={(e) => setBballScoreForm((p) => ({ ...p, homeScore: Number(e.target.value) }))}
                 className="text-center text-xl font-bold"
               />
             </div>
             <div className="text-center text-2xl font-bold text-muted-foreground">-</div>
             <div className="space-y-1.5">
               <Label className="text-xs text-muted-foreground text-right block">客队比分</Label>
               <Input
                 type="number"
                 value={bballScoreForm.awayScore}
                 onChange={(e) => setBballScoreForm((p) => ({ ...p, awayScore: Number(e.target.value) }))}
                 className="text-center text-xl font-bold"
               />
             </div>
           </div>

           <div className="space-y-1.5">
             <Label className="text-xs text-muted-foreground">比赛状态</Label>
             <Select
               value={bballScoreForm.matchStatus}
               onValueChange={(val) => setBballScoreForm((p) => ({ ...p, matchStatus: val }))}
             >
               <SelectTrigger>
                 <SelectValue />
               </SelectTrigger>
               <SelectContent>
                 {STATUS_OPTIONS.map((opt) => (
                   <SelectItem key={opt.value} value={opt.value}>
                     {opt.label}
                   </SelectItem>
                 ))}
                 <SelectItem value="live">进行中</SelectItem>
               </SelectContent>
             </Select>
           </div>

           <DialogFooter className="mt-4">
             <DialogClose asChild>
               <Button variant="outline" disabled={bballScoreSaving}>
                 取消
               </Button>
             </DialogClose>
             <Button onClick={handleBballScoreUpdate} disabled={bballScoreSaving}>
               {bballScoreSaving ? '更新中...' : '确认更新'}
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>

        {/* === 指数录入弹窗 === */}
      <Dialog open={oddsDialogOpen} onOpenChange={setOddsDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
          <DialogHeader>
             <DialogTitle>录入指数</DialogTitle>
             <DialogDescription className="text-xs text-muted-foreground">
               添加比赛指数快照
             </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="oddsMatch">选择比赛</Label>
              <Select
                value={oddsForm.matchId}
                onValueChange={(val) => handleOddsFormChange('matchId', val)}
              >
                <SelectTrigger id="oddsMatch">
                  <SelectValue placeholder="选择比赛" />
                </SelectTrigger>
                <SelectContent>
                  {matches.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      [{m.matchNo}] {m.homeTeam} vs {m.awayTeam}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oddsType">指数类型</Label>
              <Select
                value={oddsForm.oddsType}
                onValueChange={(val) => handleOddsFormChange('oddsType', val)}
              >
                <SelectTrigger id="oddsType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                   <SelectItem value="1x2">赛果方向 (1x2)</SelectItem>
                   <SelectItem value="handicap">让分</SelectItem>
                   <SelectItem value="overunder">进球数</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="isInitial">指数类型</Label>
              <Select
                value={oddsForm.isInitial}
                onValueChange={(val) => handleOddsFormChange('isInitial', val)}
              >
                <SelectTrigger id="isInitial">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="initial">初始指数</SelectItem>
                  <SelectItem value="live">即时指数</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bookmaker">数据提供方</Label>
              <Input
                id="bookmaker"
                value={oddsForm.bookmaker}
                onChange={(e) => handleOddsFormChange('bookmaker', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="snapshotTime">快照时间</Label>
              <Input
                id="snapshotTime"
                type="datetime-local"
                value={oddsForm.snapshotTime}
                onChange={(e) => handleOddsFormChange('snapshotTime', e.target.value)}
              />
            </div>

            {oddsForm.oddsType === '1x2' && (
              <>
                <div className="col-span-full mt-1 border-t border-border/50 pt-3">
                   <span className="text-xs font-medium text-foreground">赛果方向指数</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="homeValue">主胜指数</Label>
                  <Input
                    id="homeValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.homeValue}
                    onChange={(e) => handleOddsFormChange('homeValue', e.target.value)}
                    placeholder="如 1.85"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="drawValue">平局指数</Label>
                  <Input
                    id="drawValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.drawValue}
                    onChange={(e) => handleOddsFormChange('drawValue', e.target.value)}
                    placeholder="如 3.40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="awayValue">客胜指数</Label>
                  <Input
                    id="awayValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.awayValue}
                    onChange={(e) => handleOddsFormChange('awayValue', e.target.value)}
                    placeholder="如 4.20"
                  />
                </div>
              </>
            )}

            {oddsForm.oddsType === 'handicap' && (
              <>
                <div className="col-span-full mt-1 border-t border-border/50 pt-3">
                   <span className="text-xs font-medium text-foreground">让分指数</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="handicapValue">让分数</Label>
                  <Input
                    id="handicapValue"
                    value={oddsForm.handicapValue}
                    onChange={(e) => handleOddsFormChange('handicapValue', e.target.value)}
                    placeholder="如 -1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="homeValue">主胜指数</Label>
                  <Input
                    id="homeValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.homeValue}
                    onChange={(e) => handleOddsFormChange('homeValue', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="awayValue">客胜指数</Label>
                  <Input
                    id="awayValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.awayValue}
                    onChange={(e) => handleOddsFormChange('awayValue', e.target.value)}
                  />
                </div>
              </>
            )}

            {oddsForm.oddsType === 'overunder' && (
              <>
                <div className="col-span-full mt-1 border-t border-border/50 pt-3">
                   <span className="text-xs font-medium text-foreground">进球数指数</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="totalLine">指数</Label>
                  <Input
                    id="totalLine"
                    type="number"
                    step="0.25"
                    value={oddsForm.totalLine}
                    onChange={(e) => handleOddsFormChange('totalLine', e.target.value)}
                    placeholder="如 2.5"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="overValue">进球偏多指数(旧)</Label>
                  <Input
                    id="overValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.overValue}
                    onChange={(e) => handleOddsFormChange('overValue', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="underValue">进球偏少指数(旧)</Label>
                  <Input
                    id="underValue"
                    type="number"
                    step="0.01"
                    value={oddsForm.underValue}
                    onChange={(e) => handleOddsFormChange('underValue', e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={oddsSaving}>
                取消
              </Button>
            </DialogClose>
            <Button onClick={handleSaveOdds} disabled={oddsSaving}>
              {oddsSaving ? '保存中...' : '保存'}
              <Check className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPage;
