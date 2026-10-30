import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, desc } from 'drizzle-orm';
import { paymentOrders, paymentSettings } from '@server/database/schema';
import type {
  PaymentOrderItem,
  CreatePaymentResponse,
  PaymentSettingsResponse,
} from '@shared/api.interface';

const PLAN_PRICES: Record<string, number> = {
  monthly: 39,
  yearly: 299,
  vip: 99,
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getSettings(): Promise<PaymentSettingsResponse> {
    try {
      const result = await this.db
        .select({
          enabled: paymentSettings.enabled,
          provider: paymentSettings.provider,
        })
        .from(paymentSettings)
        .limit(1);

      if (result.length === 0) {
        return { enabled: false, provider: '' };
      }

      return result[0];
    } catch (error) {
      this.logger.error('getSettings error: ' + JSON.stringify(error));
      return { enabled: false, provider: '' };
    }
  }

  async createOrder(
    userId: string,
    plan: 'monthly' | 'yearly' | 'vip',
    payMethod: 'wechat' | 'alipay',
  ): Promise<CreatePaymentResponse> {
    try {
      const settings = await this.getSettings();
      if (!settings.enabled) {
        return {
          success: false,
          orderId: '',
          orderNo: '',
          amount: 0,
          message: '在线支付暂未开通',
        };
      }

      const amount = PLAN_PRICES[plan];
      if (!amount) {
        throw new BadRequestException('无效的套餐类型');
      }

      const orderNo = this.generateOrderNo();

      const payUrl = `https://mock-pay.example.com/${orderNo}`;

      const inserted = await this.db
        .insert(paymentOrders)
        .values({
          orderNo,
          userId: sql`ROW(${userId})::user_profile`,
          plan,
          amount: String(amount),
          payMethod,
          status: 'pending',
          payUrl,
        })
        .returning({ id: paymentOrders.id, orderNo: paymentOrders.orderNo });

      return {
        success: true,
        orderId: inserted[0].id,
        orderNo: inserted[0].orderNo,
        payUrl,
        amount,
      };
    } catch (error) {
      this.logger.error('createOrder error: ' + JSON.stringify(error));
      throw error;
    }
  }

  async queryOrder(orderId: string, userId: string): Promise<PaymentOrderItem> {
    try {
      const result = await this.db
        .select()
        .from(paymentOrders)
        .where(
          sql`${paymentOrders.id} = ${orderId} AND (${paymentOrders.userId}).user_id = ${userId}`,
        )
        .limit(1);

      if (result.length === 0) {
        throw new NotFoundException('订单不存在');
      }

      return this.toOrderItem(result[0]);
    } catch (error) {
      this.logger.error('queryOrder error: ' + JSON.stringify(error));
      throw error;
    }
  }

  async handleCallback(orderNo: string, status: string): Promise<{ success: boolean }> {
    try {
      const orderResult = await this.db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.orderNo, orderNo))
        .limit(1);

      if (orderResult.length === 0) {
        throw new NotFoundException('订单不存在');
      }

      const order = orderResult[0];

      if (order.status === 'paid') {
        return { success: true };
      }

      if (status === 'paid') {
        const now = new Date();
        await this.db
          .update(paymentOrders)
          .set({
            status: 'paid',
            paidAt: now,
            updatedAt: now,
          })
          .where(eq(paymentOrders.id, order.id));
      }

      return { success: true };
    } catch (error) {
      this.logger.error('handleCallback error: ' + JSON.stringify(error));
      return { success: false };
    }
  }

  private generateOrderNo(): string {
    const timestamp = Date.now().toString();
    const random = Math.floor(100000 + Math.random() * 900000).toString();
    return `PAY${timestamp}${random}`;
  }

  private toOrderItem(row: any): PaymentOrderItem {
    return {
      id: row.id,
      orderNo: row.orderNo,
      plan: row.plan,
      amount: Number(row.amount),
      payMethod: row.payMethod,
      status: row.status,
      payUrl: row.payUrl ?? undefined,
      paidAt: row.paidAt ? row.paidAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
