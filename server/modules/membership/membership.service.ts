import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, and, desc, count, like } from 'drizzle-orm';
import { members, cards, cardOrders, memberSettings } from '@server/database/schema';
import type { CardInfo, MemberInfo, MemberSettings } from '@shared/api.interface';

const LEVEL_ORDER: Record<string, number> = {
  free: 0,
  monthly: 1,
  yearly: 2,
  vip: 3,
};

@Injectable()
export class MembershipService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getMemberInfo(userId: string): Promise<MemberInfo> {
    let result = await this.db
      .select()
      .from(members)
      .where(sql`(${members.userId}).user_id = ${userId}`)
      .limit(1);

    const now = new Date();
    let welcomeGift = false;

    if (result.length === 0) {
      const expireAt = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
      const inserted = await this.db
        .insert(members)
        .values({
          userId: sql`ROW(${userId})::user_profile`,
          level: 'vip',
          expireAt,
          welcomeGiftGiven: true,
        })
        .returning();
      result = inserted;
      welcomeGift = true;
    } else {
      const current = result[0];
      if (!current.welcomeGiftGiven && current.level === 'free') {
        const expireAt = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
        const updated = await this.db
          .update(members)
          .set({
            level: 'vip',
            expireAt,
            welcomeGiftGiven: true,
            updatedAt: now,
          })
          .where(sql`(${members.userId}).user_id = ${userId}`)
          .returning();
        result = updated;
        welcomeGift = true;
      }
    }

    const member = result[0];
    let daysLeft = 0;
    let isActive = false;

    if (member.expireAt && member.level !== 'free') {
      const expire = new Date(member.expireAt);
      if (expire > now) {
        daysLeft = Math.ceil((expire.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        isActive = true;
      }
    }

    return {
      level: member.level as MemberInfo['level'],
      role: (member.role || 'user') as MemberInfo['role'],
      expireAt: member.expireAt ? new Date(member.expireAt).toISOString() : undefined,
      daysLeft,
      isActive,
      welcomeGift,
    };
  }

  async activateCard(userId: string, code: string): Promise<MemberInfo> {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      throw new BadRequestException('卡密不能为空');
    }

    const cardResult = await this.db
      .select()
      .from(cards)
      .where(eq(cards.code, trimmedCode))
      .limit(1);

    if (cardResult.length === 0) {
      throw new BadRequestException('卡密无效，请检查后重试');
    }

    const card = cardResult[0];
    if (card.status === 'used') {
      throw new ConflictException('该卡密已被使用');
    }

    const cardType = card.cardType;
    const cardDays = card.days;

    const now = new Date();
    const memberResult = await this.db
      .select()
      .from(members)
      .where(sql`(${members.userId}).user_id = ${userId}`)
      .limit(1);

    let newLevel: string = cardType;
    let newExpireAt: Date;

    if (memberResult.length > 0) {
      const current = memberResult[0];
      const currentLevelOrder = LEVEL_ORDER[current.level] ?? 0;
      const newLevelOrder = LEVEL_ORDER[cardType] ?? 1;

      if (newLevelOrder > currentLevelOrder) {
        newLevel = cardType;
        newExpireAt = new Date(now.getTime() + cardDays * 24 * 60 * 60 * 1000);
      } else if (newLevelOrder === currentLevelOrder && current.expireAt && new Date(current.expireAt) > now) {
        newLevel = current.level;
        newExpireAt = new Date(new Date(current.expireAt).getTime() + cardDays * 24 * 60 * 60 * 1000);
      } else {
        newLevel = cardType;
        newExpireAt = new Date(now.getTime() + cardDays * 24 * 60 * 60 * 1000);
      }

      await this.db
        .update(members)
        .set({
          level: newLevel,
          expireAt: newExpireAt,
          updatedAt: now,
        })
        .where(sql`(${members.userId}).user_id = ${userId}`);
    } else {
      newExpireAt = new Date(now.getTime() + cardDays * 24 * 60 * 60 * 1000);
      await this.db.insert(members).values({
        userId: sql`ROW(${userId})::user_profile`,
        level: newLevel,
        expireAt: newExpireAt,
      });
    }

    await this.db
      .update(cards)
      .set({
        status: 'used',
        usedBy: sql`ROW(${userId})::user_profile`,
        usedAt: now,
        updatedAt: now,
      })
      .where(eq(cards.id, card.id));

    await this.db.insert(cardOrders).values({
      userId: sql`ROW(${userId})::user_profile`,
      cardId: card.id,
      amount: card.amount,
      payMethod: 'card',
      status: 'completed',
    });

    const daysLeft = Math.ceil((newExpireAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      level: newLevel as MemberInfo['level'],
      role: (memberResult[0]?.role || 'user') as MemberInfo['role'],
      expireAt: newExpireAt.toISOString(),
      daysLeft,
      isActive: true,
    };
  }

  async listCards(status?: string, page = 1, pageSize = 50): Promise<{ items: CardInfo[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const whereConditions = [];
    if (status) {
      whereConditions.push(eq(cards.status, status));
    }
    const where = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [countResult, items] = await Promise.all([
      this.db.select({ count: count() }).from(cards).where(where as any),
      this.db
        .select({
          id: cards.id,
          code: cards.code,
          cardType: cards.cardType,
          days: cards.days,
          status: cards.status,
          usedBy: sql`(${cards.usedBy}).user_id`,
          usedAt: cards.usedAt,
          amount: cards.amount,
          createdAt: cards.createdAt,
        })
        .from(cards)
        .where(where as any)
        .orderBy(desc(cards.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        amount: item.amount ? Number(item.amount) : 0,
        createdAt: new Date(item.createdAt).toISOString(),
        usedAt: item.usedAt ? new Date(item.usedAt).toISOString() : undefined,
      })),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async batchCreateCards(
    cardType: string,
    days: number,
    count: number,
    amount: number = 0,
    prefix: string = '',
  ): Promise<CardInfo[]> {
    if (count <= 0 || count > 200) {
      throw new BadRequestException('每次生成1-200张卡密');
    }

    const values = [];
    const typePrefix = prefix || this.getTypePrefix(cardType);

    for (let i = 0; i < count; i++) {
      const code = `${typePrefix}${this.randomString(6)}`;
      values.push({
        code,
        cardType,
        days,
        amount,
        status: 'unused',
      });
    }

    const result = await this.db.insert(cards).values(values as any).returning();

    return result.map((item: any) => ({
      id: item.id,
      code: item.code,
      cardType: item.cardType,
      days: item.days,
      status: item.status,
      amount: item.amount ? Number(item.amount) : 0,
      createdAt: new Date(item.createdAt).toISOString(),
    }));
  }

  private getTypePrefix(cardType: string): string {
    switch (cardType) {
      case 'monthly':
        return 'MON';
      case 'yearly':
        return 'YEAR';
      case 'vip':
        return 'VIP';
      default:
        return 'CARD';
    }
  }

  private randomString(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async listMemberUsers(search?: string, page = 1, pageSize = 50): Promise<{ items: any[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const whereConditions = [sql`${members.level} != 'free'`];

    const where = and(...whereConditions);

    const [countResult, items] = await Promise.all([
      this.db.select({ count: count() }).from(members).where(where),
      this.db
        .select({
          id: members.id,
          userId: sql`(${members.userId}).user_id`,
          level: members.level,
          expireAt: members.expireAt,
          createdAt: members.createdAt,
        })
        .from(members)
        .where(where)
        .orderBy(desc(members.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const now = new Date();
    return {
      items: items.map((item: any) => {
        const expire = item.expireAt ? new Date(item.expireAt) : null;
        const daysLeft = expire && expire > now
          ? Math.ceil((expire.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          ...item,
          expireAt: expire ? expire.toISOString() : undefined,
          daysLeft,
          createdAt: new Date(item.createdAt).toISOString(),
        };
      }),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async updateMemberLevel(userId: string, level: string, days: number): Promise<void> {
    if (!(level in LEVEL_ORDER)) {
      throw new BadRequestException('无效的会员等级');
    }

    const now = new Date();
    const expireAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const existing = await this.db
      .select()
      .from(members)
      .where(sql`(${members.userId}).user_id = ${userId}`)
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(members)
        .set({
          level,
          expireAt,
          updatedAt: now,
        })
        .where(sql`(${members.userId}).user_id = ${userId}`);
    } else {
      await this.db.insert(members).values({
        userId: sql`ROW(${userId})::user_profile`,
        level,
        expireAt,
      });
    }
  }

  async getMyCardRecords(userId: string): Promise<CardInfo[]> {
    const result = await this.db
      .select({
        id: cards.id,
        code: cards.code,
        cardType: cards.cardType,
        days: cards.days,
        status: cards.status,
        usedAt: cards.usedAt,
        amount: cards.amount,
        createdAt: cards.createdAt,
      })
      .from(cards)
      .where(sql`(${cards.usedBy}).user_id = ${userId}`)
      .orderBy(desc(cards.usedAt))
      .limit(20);

    return result.map((item: any) => ({
      ...item,
      amount: item.amount ? Number(item.amount) : 0,
      createdAt: new Date(item.createdAt).toISOString(),
      usedAt: item.usedAt ? new Date(item.usedAt).toISOString() : undefined,
    }));
  }

  async getSettings(): Promise<MemberSettings> {
    const result = await this.db.select().from(memberSettings).limit(1);
    if (result.length === 0) {
      return {
        wechatQrUrl: '',
        alipayQrUrl: '',
        customerWechat: '',
        monthlyPrice: 39,
        yearlyPrice: 299,
        vipPrice: 99,
      };
    }
    const row = result[0];
    return {
      wechatQrUrl: row.wechatQrUrl ?? '',
      alipayQrUrl: row.alipayQrUrl ?? '',
      customerWechat: row.customerWechat ?? '',
      monthlyPrice: row.monthlyPrice ? Number(row.monthlyPrice) : 39,
      yearlyPrice: row.yearlyPrice ? Number(row.yearlyPrice) : 299,
      vipPrice: row.vipPrice ? Number(row.vipPrice) : 99,
    };
  }

  async updateSettings(data: Partial<MemberSettings>): Promise<MemberSettings> {
    const existing = await this.db.select().from(memberSettings).limit(1);
    const now = new Date();

    const patch: Record<string, any> = { updatedAt: now };
    if (data.wechatQrUrl !== undefined) patch.wechatQrUrl = data.wechatQrUrl;
    if (data.alipayQrUrl !== undefined) patch.alipayQrUrl = data.alipayQrUrl;
    if (data.customerWechat !== undefined) patch.customerWechat = data.customerWechat;
    if (data.monthlyPrice !== undefined) patch.monthlyPrice = data.monthlyPrice;
    if (data.yearlyPrice !== undefined) patch.yearlyPrice = data.yearlyPrice;
    if (data.vipPrice !== undefined) patch.vipPrice = data.vipPrice;

    if (existing.length > 0) {
      await this.db.update(memberSettings).set(patch).where(eq(memberSettings.id, existing[0].id));
    } else {
      await this.db.insert(memberSettings).values({
        [memberSettings.wechatQrUrl.name]: data.wechatQrUrl ?? '',
        [memberSettings.alipayQrUrl.name]: data.alipayQrUrl ?? '',
        [memberSettings.customerWechat.name]: data.customerWechat ?? '',
        [memberSettings.monthlyPrice.name]: data.monthlyPrice ?? 39,
        [memberSettings.yearlyPrice.name]: data.yearlyPrice ?? 299,
        [memberSettings.vipPrice.name]: data.vipPrice ?? 99,
      } as any);
    }

    return this.getSettings();
  }
}
