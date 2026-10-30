import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, desc, count, and, gt, gte, lt } from 'drizzle-orm';
import { invitations, members } from '@server/database/schema';

// 邀请码功能已停用，类型定义本地化（原 @shared/api.interface.ts 中已移除）
export interface InviteInfoResponse {
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

export interface InviteRewardItem {
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

export interface InviteRewardListResponse {
  items: InviteRewardItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BindInviteCodeRequest {
  inviteCode: string;
}

export interface BindInviteCodeResponse {
  success: boolean;
  message: string;
  rewardDays?: number;
}

const REFERRAL_VIP_DAYS = 3;
const REFEREE_VIP_DAYS = 5;

const TIER_REWARDS = [
  { count: 3, days: 7, name: 'tier3' },
  { count: 5, days: 30, name: 'tier5' },
];

const LEVEL_ORDER: Record<string, number> = {
  free: 0,
  monthly: 1,
  yearly: 2,
  vip: 3,
};

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getInviteInfo(userId: string): Promise<InviteInfoResponse> {
    try {
      const memberResult = await this.db
        .select()
        .from(members)
        .where(sql`(${members.userId}).user_id = ${userId}`)
        .limit(1);

      let inviteCode: string;
      let rewardBalance = 0;
      let totalVipDays = 0;
      let claimedTiers: string[] = [];
      let invitedByCode: string | undefined;

      if (memberResult.length === 0 || !memberResult[0].inviteCode) {
        inviteCode = await this.generateInviteCode();
        if (memberResult.length === 0) {
          await this.db.insert(members).values({
            userId: sql`ROW(${userId})::user_profile`,
            inviteCode,
          });
        } else {
          await this.db
            .update(members)
            .set({ inviteCode })
            .where(sql`(${members.userId}).user_id = ${userId}`);
        }
      } else {
        inviteCode = memberResult[0].inviteCode!;
        rewardBalance = Number(memberResult[0].rewardBalance) || 0;
        totalVipDays = memberResult[0].totalInviteDays || 0;
        claimedTiers = memberResult[0].inviteRewardTiers || [];
        invitedByCode = memberResult[0].invitedBy || undefined;
      }

      const countResult = await this.db
        .select({ value: count() })
        .from(invitations)
        .where(and(
          sql`(${invitations.inviterId}).user_id = ${userId}`,
          eq(invitations.status, 'completed'),
        ));

      const inviteCount = Number(countResult[0]?.value) || 0;

      const sumResult = await this.db
        .select({
          total: sql<number>`sum(${invitations.rewardAmount})`,
        })
        .from(invitations)
        .where(and(
          sql`(${invitations.inviterId}).user_id = ${userId}`,
          eq(invitations.status, 'completed'),
        ));

      const totalReward = Number(sumResult[0]?.total) || 0;

      const { currentTier, nextTierCount, nextTierDays, tierProgress } =
        this.calculateTierProgress(inviteCount, claimedTiers);

      const recentRewards = await this.db
        .select()
        .from(invitations)
        .where(sql`(${invitations.inviterId}).user_id = ${userId}`)
        .orderBy(desc(invitations.createdAt))
        .limit(20);

      const rewards: InviteRewardItem[] = recentRewards.map((row) => this.toRewardItem(row));

      return {
        inviteCode,
        inviteUrl: `/app/app_17e50w9zycw?invite_code=${inviteCode}`,
        inviteCount,
        rewardBalance,
        totalReward,
        totalVipDays,
        currentTier,
        nextTierCount,
        nextTierDays,
        tierProgress,
        invitedByCode,
        claimedTiers,
        rewards,
      };
    } catch (error) {
      this.logger.error(`getInviteInfo failed: ${JSON.stringify(error)}`);
      throw error;
    }
  }

  private calculateTierProgress(
    inviteCount: number,
    claimedTiers: string[],
  ): { currentTier: number; nextTierCount: number; nextTierDays: number; tierProgress: number } {
    let currentTier = 0;
    let nextTierIndex = 0;

    for (let i = 0; i < TIER_REWARDS.length; i++) {
      if (inviteCount >= TIER_REWARDS[i].count) {
        currentTier = i + 1;
        nextTierIndex = i + 1;
      }
    }

    if (nextTierIndex >= TIER_REWARDS.length) {
      return { currentTier, nextTierCount: 0, nextTierDays: 0, tierProgress: 100 };
    }

    const nextTier = TIER_REWARDS[nextTierIndex];
    const prevCount = nextTierIndex > 0 ? TIER_REWARDS[nextTierIndex - 1].count : 0;
    const progress = Math.min(
      100,
      Math.max(0, ((inviteCount - prevCount) / (nextTier.count - prevCount)) * 100),
    );

    return {
      currentTier,
      nextTierCount: nextTier.count - inviteCount,
      nextTierDays: nextTier.days,
      tierProgress: Math.round(progress),
    };
  }

  async generateInviteCode(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      let suffix = '';
      for (let i = 0; i < 6; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      code = suffix;

      const existing = await this.db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.inviteCode, code))
        .limit(1);

      if (existing.length === 0) {
        return code;
      }
      attempts++;
    }

    throw new ConflictException('生成邀请码失败，请稍后重试');
  }

  async getRewards(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: InviteRewardItem[]; total: number }> {
    try {
      const offset = (page - 1) * pageSize;

      const [countResult, rows] = await Promise.all([
        this.db
          .select({ value: count() })
          .from(invitations)
          .where(sql`(${invitations.inviterId}).user_id = ${userId}`),
        this.db
          .select()
          .from(invitations)
          .where(sql`(${invitations.inviterId}).user_id = ${userId}`)
          .orderBy(desc(invitations.createdAt))
          .limit(pageSize)
          .offset(offset),
      ]);

      const total = Number(countResult[0]?.value) || 0;
      const items: InviteRewardItem[] = rows.map((row) => this.toRewardItem(row));

      return { items, total };
    } catch (error) {
      this.logger.error(`getRewards failed: ${JSON.stringify(error)}`);
      throw error;
    }
  }

  async bindInviteCode(
    inviteeUserId: string,
    code: string,
  ): Promise<{ success: boolean; message: string; rewardDays?: number }> {
    return this.db.transaction(async (tx) => {
      const trimmedCode = code.trim().toUpperCase();
      if (!trimmedCode) {
        throw new BadRequestException('邀请码不能为空');
      }

      const inviterResult = await tx
        .select()
        .from(members)
        .where(eq(members.inviteCode, trimmedCode))
        .limit(1);

      if (inviterResult.length === 0) {
        throw new BadRequestException('邀请码无效');
      }

      const inviter = inviterResult[0];
      const inviterIdStr = String(inviter.userId);

      if (inviterIdStr === inviteeUserId) {
        throw new BadRequestException('不能使用自己的邀请码');
      }

      const existingBind = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(sql`(${invitations.inviteeId}).user_id = ${inviteeUserId}`)
        .limit(1);

      if (existingBind.length > 0) {
        throw new ConflictException('您已绑定过邀请码');
      }

      let inviteeMember = await tx
        .select()
        .from(members)
        .where(sql`(${members.userId}).user_id = ${inviteeUserId}`)
        .limit(1);

      let inviteeCode: string;
      if (inviteeMember.length === 0 || !inviteeMember[0].inviteCode) {
        inviteeCode = await this.generateInviteCodeWithTx(tx);
        if (inviteeMember.length === 0) {
          await tx.insert(members).values({
            userId: sql`ROW(${inviteeUserId})::user_profile`,
            inviteCode: inviteeCode,
            invitedBy: trimmedCode,
          });
        } else {
          await tx
            .update(members)
            .set({ inviteCode: inviteeCode, invitedBy: trimmedCode })
            .where(sql`(${members.userId}).user_id = ${inviteeUserId}`);
        }
      } else {
        inviteeCode = inviteeMember[0].inviteCode!;
        await tx
          .update(members)
          .set({ invitedBy: trimmedCode })
          .where(sql`(${members.userId}).user_id = ${inviteeUserId}`);
      }

      await this.addVipDaysWithTx(tx, inviteeUserId, REFEREE_VIP_DAYS);

      await tx.insert(invitations).values({
        inviterId: inviter.userId,
        inviteeId: sql`ROW(${inviteeUserId})::user_profile`,
        inviteCode: trimmedCode,
        status: 'completed',
        rewardAmount: '0',
        rewardType: 'member_days',
        rewardDays: REFERRAL_VIP_DAYS,
      });

      const result = await this.addVipDaysWithTx(tx, inviterIdStr, REFERRAL_VIP_DAYS);

      const inviteCountRow = await tx
        .select({ value: count() })
        .from(invitations)
        .where(and(
          sql`(${invitations.inviterId}).user_id = ${inviterIdStr}`,
          eq(invitations.status, 'completed'),
          eq(invitations.rewardType, 'member_days'),
        ));

      const inviteCount = Number(inviteCountRow[0]?.value) || 0;

      const currentTiers = (inviter.inviteRewardTiers || []) as string[];
      let tierBonuses: { name: string; days: number }[] = [];

      for (const tier of TIER_REWARDS) {
        if (inviteCount >= tier.count && !currentTiers.includes(tier.name)) {
          tierBonuses.push(tier);
        }
      }

      let totalTierDays = 0;
      const newClaimedTiers = [...currentTiers];
      for (const tier of tierBonuses) {
        totalTierDays += tier.days;
        newClaimedTiers.push(tier.name);

        await tx.insert(invitations).values({
          inviterId: inviter.userId,
          inviteCode: trimmedCode,
          status: 'completed',
          rewardAmount: '0',
          rewardType: 'tier_bonus',
          rewardDays: tier.days,
          tierType: tier.name,
        });
      }

      if (totalTierDays > 0) {
        await this.addVipDaysWithTx(tx, inviterIdStr, totalTierDays);
        await tx
          .update(members)
          .set({
            inviteRewardTiers: newClaimedTiers as unknown as string[],
            totalInviteDays: (inviter.totalInviteDays || 0) + REFERRAL_VIP_DAYS + totalTierDays,
          })
          .where(sql`(${members.userId}).user_id = ${inviterIdStr}`);
      } else {
        await tx
          .update(members)
          .set({
            totalInviteDays: (inviter.totalInviteDays || 0) + REFERRAL_VIP_DAYS,
          })
          .where(sql`(${members.userId}).user_id = ${inviterIdStr}`);
      }

      return {
        success: true,
        message: `邀请码绑定成功！获得${REFEREE_VIP_DAYS}天VIP会员`,
        rewardDays: REFEREE_VIP_DAYS,
      };
    });
  }

  async grantRefereeVipDays(userId: string): Promise<number> {
    const memberResult = await this.db
      .select()
      .from(members)
      .where(sql`(${members.userId}).user_id = ${userId}`)
      .limit(1);

    if (memberResult.length === 0) return 0;
    if (!memberResult[0].invitedBy) return 0;

    const existingReward = await this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(
        sql`(${invitations.inviteeId}).user_id = ${userId}`,
        eq(invitations.rewardType, 'referee_bonus'),
      ))
      .limit(1);

    if (existingReward.length > 0) return 0;

    const result = await this.addVipDays(userId, REFEREE_VIP_DAYS);
    return result.daysAdded;
  }

  private async addVipDaysWithTx(
    tx: PostgresJsDatabase,
    userId: string,
    days: number,
  ): Promise<{ newLevel: string; newExpireAt: Date; daysAdded: number }> {
    const now = new Date();
    const memberResult = await tx
      .select()
      .from(members)
      .where(sql`(${members.userId}).user_id = ${userId}`)
      .limit(1);

    let newLevel: string;
    let newExpireAt: Date;

    if (memberResult.length > 0) {
      const current = memberResult[0];
      const currentExpire = current.expireAt ? new Date(current.expireAt) : null;
      const isActive = currentExpire && currentExpire > now && current.level !== 'free';

      if (isActive) {
        newLevel = current.level === 'free' ? 'vip' : current.level;
        newExpireAt = new Date(currentExpire!.getTime() + days * 24 * 60 * 60 * 1000);
      } else {
        newLevel = 'vip';
        newExpireAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      }

      const currentOrder = LEVEL_ORDER[newLevel] ?? 3;
      if (currentOrder < LEVEL_ORDER['vip']) {
        newLevel = 'vip';
      }

      await tx
        .update(members)
        .set({
          level: newLevel,
          expireAt: newExpireAt,
          updatedAt: now,
        })
        .where(sql`(${members.userId}).user_id = ${userId}`);
    } else {
      newLevel = 'vip';
      newExpireAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const code = await this.generateInviteCodeWithTx(tx);
      await tx.insert(members).values({
        userId: sql`ROW(${userId})::user_profile`,
        level: 'vip',
        expireAt: newExpireAt,
        inviteCode: code,
      });
    }

    return { newLevel, newExpireAt, daysAdded: days };
  }

  private async addVipDays(
    userId: string,
    days: number,
  ): Promise<{ newLevel: string; newExpireAt: Date; daysAdded: number }> {
    return this.addVipDaysWithTx(this.db, userId, days);
  }

  private async generateInviteCodeWithTx(tx: PostgresJsDatabase): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      let suffix = '';
      for (let i = 0; i < 6; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      code = suffix;

      const existing = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.inviteCode, code))
        .limit(1);

      if (existing.length === 0) {
        return code;
      }
      attempts++;
    }

    throw new ConflictException('生成邀请码失败，请稍后重试');
  }

  async claimReward(
    userId: string,
    amount: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!amount || amount <= 0) {
        throw new BadRequestException('抵扣金额必须大于0');
      }

      const memberResult = await this.db
        .select()
        .from(members)
        .where(sql`(${members.userId}).user_id = ${userId}`)
        .limit(1);

      if (memberResult.length === 0) {
        throw new BadRequestException('会员信息不存在');
      }

      const balance = Number(memberResult[0].rewardBalance) || 0;
      if (balance < amount) {
        throw new BadRequestException('奖励余额不足');
      }

      const newBalance = balance - amount;
      await this.db
        .update(members)
        .set({ rewardBalance: String(newBalance) })
        .where(sql`(${members.userId}).user_id = ${userId}`);

      return { success: true, message: `成功抵扣 ${amount} 元` };
    } catch (error) {
      this.logger.error(`claimReward failed: ${JSON.stringify(error)}`);
      throw error;
    }
  }

  async verifyInviteCode(code: string): Promise<{ valid: boolean; inviterName?: string }> {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      return { valid: false };
    }

    const result = await this.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.inviteCode, trimmedCode))
      .limit(1);

    return { valid: result.length > 0 };
  }

  private toRewardItem(row: typeof invitations.$inferSelect): InviteRewardItem {
    const inviteeIdStr = row.inviteeId ? String(row.inviteeId) : '';
    const suffix = inviteeIdStr ? inviteeIdStr.slice(-4) : '****';
    const statusMap: Record<string, string> = {
      pending: '待生效',
      completed: '已到账',
      expired: '已过期',
    };

    const rewardType = row.rewardType || 'cash';
    let displayName = `好友${suffix}`;
    if (rewardType === 'tier_bonus') {
      const tierNames: Record<string, string> = {
        tier3: '阶梯奖励·邀请3人',
        tier5: '阶梯奖励·邀请5人',
      };
      displayName = tierNames[row.tierType || ''] || '阶梯奖励';
    }

    return {
      id: row.id,
      inviteeName: row.inviteeName || displayName,
      amount: Number(row.rewardAmount) || 0,
      reward: Number(row.rewardAmount) || 0,
      rewardDays: row.rewardDays || 0,
      rewardType: (rewardType as 'cash' | 'member_days' | 'tier_bonus'),
      status: statusMap[row.status] || row.status,
      tierType: row.tierType || undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
