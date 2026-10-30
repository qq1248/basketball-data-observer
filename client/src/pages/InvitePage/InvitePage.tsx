import { useState, useEffect } from 'react';
import {
  Copy,
  Check,
  Gift,
  Users,
  Calendar,
  Trophy,
  ChevronRight,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';

// 邀请码功能已停用，原 invitationsApi 调用已下线
const invitationsApi = {
  getInfo: async (): Promise<InviteInfoResponse> => {
    throw new Error('邀请码功能已停用');
  },
  getRewards: async (_page: number, _pageSize: number) => ({ items: [] as InviteRewardItem[], total: 0, page: 1, pageSize: 20 }),
  bindCode: async (_code: string) => ({ success: false, message: '邀请码功能已停用' }),
};
// 邀请码功能已停用，类型本地化保留（原 shared 中已移除）
interface InviteInfoResponse {
  inviteCode: string;
  inviteUrl: string;
  inviteCount: number;
  rewardBalance: number;
  totalReward: number;
  totalVipDays: number;
  currentTier: number;
  nextTierCount: number;
  nextTierDays: number;
  tierProgress: number;
  invitedByCode?: string;
  claimedTiers: string[];
  rewards: InviteRewardItem[];
}

interface InviteRewardItem {
  id: string;
  inviteeName: string;
  amount: number;
  reward: number;
  rewardDays: number;
  rewardType: 'cash' | 'member_days' | 'tier_bonus';
  status: string;
  tierType?: string;
  createdAt: string;
}

const TIER_REWARDS = [
  { count: 3, days: 7, name: 'tier3', label: '邀请3人' },
  { count: 5, days: 30, name: 'tier5', label: '邀请5人' },
];

const REWARD_TYPE_LABEL: Record<string, string> = {
  cash: '权益金',
  member_days: '会员时长',
  tier_bonus: '成长权益',
};

const formatDateTime = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return isoStr;
  }
};

const InvitePage = () => {
  const [info, setInfo] = useState<InviteInfoResponse | null>(null);
  const [rewards, setRewards] = useState<InviteRewardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bindCode, setBindCode] = useState('');
  const [bindLoading, setBindLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 20;

  const loadInfo = async () => {
    try {
      setLoading(true);
      const data = await invitationsApi.getInfo();
      setInfo(data);
      setRewards(data.rewards || []);
      setHasMore((data.rewards?.length || 0) >= pageSize);
    } catch (error) {
      logger.error('加载邀请信息失败', error);
      toast.error('加载邀请信息失败');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreRewards = async () => {
    if (rewardsLoading || !hasMore) return;
    try {
      setRewardsLoading(true);
      const nextPage = page + 1;
      const data = await invitationsApi.getRewards(nextPage, pageSize);
      setRewards((prev) => [...prev, ...data.items]);
      setPage(nextPage);
      setHasMore(nextPage * pageSize < data.total);
    } catch (error) {
      logger.error('加载更多权益记录失败', error);
    } finally {
      setRewardsLoading(false);
    }
  };

  useEffect(() => {
    loadInfo();
  }, []);

  const handleCopy = async () => {
    if (!info?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(info.inviteCode);
      setCopied(true);
      toast.success('邀请码已复制');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error('复制失败', error);
      toast.error('复制失败，请手动复制');
    }
  };

  const handleBind = async () => {
    if (!bindCode.trim()) {
      toast.error('请输入邀请码');
      return;
    }
    try {
      setBindLoading(true);
      const result = await invitationsApi.bindCode(bindCode.trim().toUpperCase());
      if (result.success) {
        toast.success(result.message);
        setBindCode('');
        loadInfo();
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      const msg = err?.response?.data?.message || '绑定失败';
      toast.error(msg);
    } finally {
      setBindLoading(false);
    }
  };

  const showBindSection = !info?.invitedByCode;

  if (loading && !info) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#1A0000] to-[#030712] text-white">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-12 md:py-16">
          <div className="eyebrow eyebrow-line text-[#E9967A] mb-4">
            REFERRAL PROGRAM
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-3">
            邀请好友
          </h1>
          <p className="text-white/60 text-lg max-w-xl">
            分享你的专属邀请码，好友注册后双方均可获得会员时长奖励，邀请越多成长权益越多。
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 -mt-8 space-y-6">
        {/* 我的邀请码 */}
        <section className="bg-white rounded-2xl shadow-lg shadow-black/5 p-6 md:p-8 emphasis-bar">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-nebula-crimson" />
            </div>
            <div>
              <h2 className="text-xl font-bold">我的邀请码</h2>
              <p className="text-sm text-muted-foreground">分享给好友，双方都能获得成长权益</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
            <div className="flex-1 bg-gray-50 border border-border rounded-xl px-5 py-4 flex items-center justify-between">
              <span className="font-mono text-2xl md:text-3xl font-black tracking-widest text-nebula-crimson">
                {info?.inviteCode}
              </span>
            </div>
            <Button
              onClick={handleCopy}
              variant="default"
              className="h-14 px-8 bg-nebula-crimson hover:bg-[#6B0000] text-white font-semibold rounded-xl transition-all"
            >
              {copied ? (
                <>
                  <Check className="w-5 h-5 mr-2" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5 mr-2" />
                  复制邀请码
                </>
              )}
            </Button>
          </div>
        </section>

        {/* 邀请统计 */}
        <section className="grid grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white rounded-2xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-nebula-crimson" />
              </div>
              <span className="text-muted-foreground text-sm">已邀请人数</span>
            </div>
            <div className="text-4xl font-black text-foreground tracking-tight">
              {info?.inviteCount || 0}
              <span className="text-lg font-normal text-muted-foreground ml-1">人</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-nebula-crimson" />
              </div>
              <span className="text-muted-foreground text-sm">累计奖励时长</span>
            </div>
            <div className="text-4xl font-black text-foreground tracking-tight">
              {info?.totalVipDays || 0}
              <span className="text-lg font-normal text-muted-foreground ml-1">天</span>
            </div>
          </div>
        </section>

        {/* 成长权益进度 */}
        <section className="bg-white rounded-2xl shadow-sm p-6 md:p-8 border border-border">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-nebula-crimson" />
            </div>
            <div>
              <h2 className="text-xl font-bold">成长权益</h2>
              <p className="text-sm text-muted-foreground">邀请越多，成长权益越多</p>
            </div>
          </div>

          <div className="space-y-5">
            {TIER_REWARDS.map((tier, index) => {
              const isClaimed = info?.claimedTiers?.includes(tier.name);
              const inviteCount = info?.inviteCount || 0;
              const prevCount = index > 0 ? TIER_REWARDS[index - 1].count : 0;
              const progress = isClaimed
                ? 100
                : Math.min(
                    100,
                    Math.max(
                      0,
                      ((inviteCount - prevCount) / (tier.count - prevCount)) * 100,
                    ),
                  );
              const currentInTier = inviteCount >= tier.count;

              return (
                <div
                  key={tier.name}
                  className={`relative rounded-xl p-5 border transition-all duration-300 ${
                    isClaimed
                      ? 'border-nebula-crimson/30 bg-nebula-crimson/5'
                      : 'border-border bg-gray-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                          isClaimed
                            ? 'bg-nebula-crimson text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {isClaimed ? <Check className="w-4 h-4" /> : index + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">
                          {tier.label}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          奖励 <span className="text-nebula-crimson font-bold">{tier.days}</span> 天VIP
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-nebula-crimson">
                        {Math.min(inviteCount, tier.count)}
                        <span className="text-sm font-normal text-muted-foreground">
                          /{tier.count}
                        </span>
                      </div>
                      {isClaimed ? (
                        <div className="text-xs text-nebula-crimson font-semibold">
                          已领取
                        </div>
                      ) : currentInTier ? (
                        <div className="text-xs text-green-600 font-semibold">
                          已达成
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          还差 {tier.count - inviteCount} 人
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-red-900 to-nebula-crimson rounded-full transition-all duration-[1500ms] ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 输入邀请码 */}
        {showBindSection && (
          <section className="bg-white rounded-2xl shadow-sm p-6 md:p-8 border border-border">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
                <Gift className="w-5 h-5 text-nebula-crimson" />
              </div>
              <div>
                <h2 className="text-xl font-bold">输入邀请码</h2>
                <p className="text-sm text-muted-foreground">
                  你还没有邀请人，输入邀请码可立即获得 5 天VIP奖励
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                value={bindCode}
                onChange={(e) => setBindCode(e.target.value.toUpperCase())}
                placeholder="请输入邀请码"
                className="h-12 text-lg font-mono tracking-widest uppercase"
                maxLength={20}
              />
              <Button
                onClick={handleBind}
                disabled={bindLoading || !bindCode.trim()}
                className="h-12 px-8 bg-nebula-crimson hover:bg-[#6B0000] text-white font-semibold rounded-xl transition-all"
              >
                {bindLoading ? '绑定中...' : (
                  <>
                    立即绑定
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </section>
        )}

        {/* 邀请记录 */}
        <section className="bg-white rounded-2xl shadow-sm p-6 md:p-8 border border-border">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
                <Gift className="w-5 h-5 text-nebula-crimson" />
              </div>
              <div>
                <h2 className="text-xl font-bold">邀请记录</h2>
                <p className="text-sm text-muted-foreground">查看所有邀请奖励明细</p>
              </div>
            </div>
          </div>

          {rewards.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                <Gift className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-muted-foreground">暂无邀请记录</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                快去分享你的邀请码吧
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {rewards.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-4 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center flex-shrink-0">
                      {item.rewardType === 'tier_bonus' ? (
                        <Trophy className="w-5 h-5 text-nebula-crimson" />
                      ) : (
                        <Users className="w-5 h-5 text-nebula-crimson" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {item.inviteeName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                        <span className="mx-1.5">·</span>
                        {REWARD_TYPE_LABEL[item.rewardType] || item.rewardType}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="font-bold text-nebula-crimson">
                      +{item.rewardDays} 天
                    </div>
                    <div className="text-xs text-muted-foreground">{item.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && rewards.length > 0 && (
            <div className="mt-6 text-center">
              <Button
                onClick={loadMoreRewards}
                variant="outline"
                disabled={rewardsLoading}
                className="w-full sm:w-auto"
              >
                {rewardsLoading ? '加载中...' : (
                  <>
                    加载更多
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default InvitePage;
