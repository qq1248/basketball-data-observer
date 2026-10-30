import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { supportTickets, supportMessages } from '@server/database/schema';
import { eq, and, desc, asc, count, sql, isNull, gt, gte } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  SupportTicket,
  SupportMessage,
  SupportTicketListItem,
  SupportTicketWithMessages,
  SupportTicketListResponse,
  SupportStatsResponse,
} from '@shared/api.interface';

type TicketRow = typeof supportTickets.$inferSelect;
type MessageRow = typeof supportMessages.$inferSelect;

const SET_AUTHORIZED_SQL = sql`SET LOCAL app.support_authorized = 'true'`;
const SET_ADMIN_AUTH_SQL = sql`SET LOCAL app.support_admin = 'true'`;
const buildUserIdSql = (userId: string) => sql`SET LOCAL app.support_user_id = '${sql.raw(userId)}'`;

function extractPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private async withUserAuth<T>(userId: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.transaction(async (tx) => {
          await tx.execute(SET_AUTHORIZED_SQL);
          await tx.execute(buildUserIdSql(userId));
          const verifyResult = await tx.execute(sql<{ val: string }>`SELECT current_setting('app.support_user_id', true) AS val`);
          const verified = Array.isArray(verifyResult) ? verifyResult[0]?.val : (verifyResult as unknown as { val: string })?.val;
          if (verified !== userId) {
            throw new Error(`support_user_id verification failed: expected=${userId}, got=${verified ?? 'NULL'}`);
          }
          return await fn(tx);
        });
      } catch (err) {
        lastError = err;
        const code = extractPostgresErrorCode(err);
        const isRlsError = code === '42501';
        const isVerifyError = err instanceof Error && err.message.includes('verification failed');
        this.logger.warn(
          `support user auth query failed (attempt ${attempt + 1}/3), code=${code ?? 'unknown'}, retrying=${isRlsError || isVerifyError}: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < 2 && (isRlsError || isVerifyError)) continue;
        break;
      }
    }
    throw lastError;
  }

  private async withAdminAuth<T>(fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.transaction(async (tx) => {
          await tx.execute(SET_ADMIN_AUTH_SQL);
          const verifyResult = await tx.execute(sql<{ val: string }>`SELECT current_setting('app.support_admin', true) AS val`);
          const verified = Array.isArray(verifyResult) ? verifyResult[0]?.val : (verifyResult as unknown as { val: string })?.val;
          if (verified !== 'true') {
            throw new Error(`support_admin verification failed: expected=true, got=${verified ?? 'NULL'}`);
          }
          return await fn(tx);
        });
      } catch (err) {
        lastError = err;
        const code = extractPostgresErrorCode(err);
        const isRlsError = code === '42501';
        const isVerifyError = err instanceof Error && err.message.includes('verification failed');
        this.logger.warn(
          `support admin auth query failed (attempt ${attempt + 1}/3), code=${code ?? 'unknown'}, retrying=${isRlsError || isVerifyError}: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < 2 && (isRlsError || isVerifyError)) continue;
        break;
      }
    }
    throw lastError;
  }

  private toTicketDto(row: TicketRow): SupportTicket {
    return {
      id: row.id,
      title: row.title,
      category: row.category as SupportTicket['category'],
      status: row.status as SupportTicket['status'],
      priority: row.priority as SupportTicket['priority'],
      email: row.email ?? undefined,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : undefined,
      unreadByAdmin: row.unreadByAdmin,
      unreadByUser: row.unreadByUser,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toMessageDto(row: MessageRow): SupportMessage {
    return {
      id: row.id,
      ticketId: row.ticketId,
      sender: row.sender as SupportMessage['sender'],
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toListItemDto(row: TicketRow, latestPreview: string | null): SupportTicketListItem {
    const base = this.toTicketDto(row);
    return {
      ...base,
      latestMessagePreview: latestPreview ?? undefined,
    };
  }

  /** 创建工单 + 首条消息 */
  async createTicket(
    userId: string,
    data: { title: string; category: string; email?: string; body: string },
  ): Promise<SupportTicket> {
    const email = data.email?.trim() || null;
    const now = new Date();
    const result = await this.withUserAuth(userId, async (db) => {
      const inserted = await db
        .insert(supportTickets)
        .values({
          userId,
          title: data.title,
          category: data.category,
          email,
          status: 'open',
          priority: 'normal',
          lastMessageAt: now,
          unreadByAdmin: 1,
          unreadByUser: 0,
        })
        .returning();

      const ticketRow: TicketRow = inserted[0];

      await db.insert(supportMessages).values({
        ticketId: ticketRow.id,
        sender: 'user',
        body: data.body,
      });

      return ticketRow;
    });

    return this.toTicketDto(result);
  }

  /** 用户工单列表（按 updated_at DESC，带分页 + latestMessagePreview） */
  async getUserTickets(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<SupportTicketListResponse> {
    const offset = (page - 1) * pageSize;

    const result = await this.withUserAuth(userId, async (db) => {
      const [{ total }] = await db
        .select({ total: count() })
        .from(supportTickets)
        .where(eq(supportTickets.userId, userId));

      const ticketRows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.userId, userId))
        .orderBy(desc(supportTickets.updatedAt))
        .limit(pageSize)
        .offset(offset);

      const items = await this.fillLatestPreviews(db, ticketRows);
      return { items, total };
    });

    return result;
  }

  /** 工单详情 + 消息列表（用户视角，读后置 unreadByUser = 0） */
  async getUserTicketDetail(userId: string, ticketId: string): Promise<SupportTicketWithMessages> {
    const result = await this.withUserAuth(userId, async (db) => {
      const ticketRows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        throw new NotFoundException('工单不存在');
      }
      if (ticket.userId !== userId) {
        throw new ForbiddenException('无权访问该工单');
      }

      let messages = await db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, ticketId))
        .orderBy(asc(supportMessages.createdAt));

      if (messages.length === 0 && ticket.lastMessageAt) {
        messages = await db
          .select()
          .from(supportMessages)
          .where(eq(supportMessages.ticketId, ticketId))
          .orderBy(asc(supportMessages.createdAt));
      }

      if (ticket.unreadByUser > 0) {
        await db
          .update(supportTickets)
          .set({ unreadByUser: 0 })
          .where(eq(supportTickets.id, ticketId));
      }

      return {
        ...this.toTicketDto(ticket),
        messages: messages.map((m: MessageRow) => this.toMessageDto(m)),
      };
    });

    return result;
  }

  /** 用户发消息 */
  async addUserMessage(userId: string, ticketId: string, body: string): Promise<SupportMessage> {
    const now = new Date();
    const result = await this.withUserAuth(userId, async (db) => {
      const ticketRows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        throw new NotFoundException('工单不存在');
      }
      if (ticket.userId !== userId) {
        throw new ForbiddenException('无权操作该工单');
      }

      const setSql = sql`
        last_message_at = ${now.toISOString()}::timestamptz,
        unread_by_admin = unread_by_admin + 1,
        unread_by_user = 0
        ${ticket.status === 'closed' ? sql`, status = 'open'` : sql``}
      `;

      const updateResult = await db.execute(sql`
        UPDATE ${supportTickets}
        SET ${setSql}
        WHERE ${supportTickets.id} = ${ticketId}
        RETURNING *
      `);
      const updatedRows = updateResult as unknown as TicketRow[];
      if (!updatedRows || updatedRows.length === 0) {
        throw new NotFoundException('工单不存在');
      }

      const [message] = await db
        .insert(supportMessages)
        .values({
          ticketId,
          sender: 'user',
          body,
        })
        .returning();

      return message;
    });

    return this.toMessageDto(result);
  }

  // ========== 管理员端 ==========

  /** 管理员工单列表 */
  async getAdminTickets(
    query: { status?: string; page?: number; pageSize?: number },
  ): Promise<SupportTicketListResponse & { total: number }> {
    const status = query.status ?? 'all';
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const result = await this.withAdminAuth(async (db) => {
      const whereStatus = status !== 'all' ? eq(supportTickets.status, status) : undefined;

      const countQuery = whereStatus
        ? db.select({ total: count() }).from(supportTickets).where(whereStatus)
        : db.select({ total: count() }).from(supportTickets);

      const [{ total }] = await countQuery;

      const listQuery = whereStatus
        ? db
            .select()
            .from(supportTickets)
            .where(whereStatus)
            .orderBy(desc(supportTickets.lastMessageAt), desc(supportTickets.createdAt))
            .limit(pageSize)
            .offset(offset)
        : db
            .select()
            .from(supportTickets)
            .orderBy(desc(supportTickets.lastMessageAt), desc(supportTickets.createdAt))
            .limit(pageSize)
            .offset(offset);

      const ticketRows = await listQuery;
      const items = await this.fillLatestPreviews(db, ticketRows);

      const itemsWithUserId = items.map((item, index) => ({
        ...item,
        userId: ticketRows[index].userId,
      }));

      return { items: itemsWithUserId as unknown as SupportTicketListItem[], total };
    });

    return result;
  }

  /** 管理员看工单详情 */
  async getAdminTicketDetail(
    ticketId: string,
  ): Promise<SupportTicketWithMessages & { userId: string }> {
    const result = await this.withAdminAuth(async (db) => {
      const ticketRows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        throw new NotFoundException('工单不存在');
      }

      let messages = await db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, ticketId))
        .orderBy(asc(supportMessages.createdAt));

      if (messages.length === 0 && ticket.lastMessageAt) {
        messages = await db
          .select()
          .from(supportMessages)
          .where(eq(supportMessages.ticketId, ticketId))
          .orderBy(asc(supportMessages.createdAt));
      }

      if (ticket.unreadByAdmin > 0) {
        await db
          .update(supportTickets)
          .set({ unreadByAdmin: 0 })
          .where(eq(supportTickets.id, ticketId));
      }

      return {
        ...this.toTicketDto(ticket),
        userId: ticket.userId,
        messages: messages.map((m: MessageRow) => this.toMessageDto(m)),
      };
    });

    return result;
  }

  /** 管理员回复 */
  async addAdminMessage(
    ticketId: string,
    body: string,
  ): Promise<SupportMessage> {
    const now = new Date();
    const result = await this.withAdminAuth(async (db) => {
      const ticketRows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        throw new NotFoundException('工单不存在');
      }

      const setSql = sql`
        last_message_at = ${now.toISOString()}::timestamptz,
        unread_by_user = unread_by_user + 1,
        unread_by_admin = 0
        ${ticket.status === 'open' ? sql`, status = 'processing'` : sql``}
      `;

      const updateResult = await db.execute(sql`
        UPDATE ${supportTickets}
        SET ${setSql}
        WHERE ${supportTickets.id} = ${ticketId}
        RETURNING *
      `);
      const updatedRows = updateResult as unknown as TicketRow[];
      if (!updatedRows || updatedRows.length === 0) {
        throw new NotFoundException('工单不存在');
      }

      const [message] = await db
        .insert(supportMessages)
        .values({
          ticketId,
          sender: 'admin',
          body,
        })
        .returning();

      return message;
    });

    return this.toMessageDto(result);
  }

  /** 更新工单状态 */
  async updateTicketStatus(
    ticketId: string,
    status: 'open' | 'processing' | 'closed',
  ): Promise<SupportTicket> {
    const result = await this.withAdminAuth(async (db) => {
      const updated = await db
        .update(supportTickets)
        .set({ status })
        .where(eq(supportTickets.id, ticketId))
        .returning();

      if (updated.length === 0) {
        throw new NotFoundException('工单不存在');
      }

      return this.toTicketDto(updated[0]);
    });

    return result;
  }

  /** 更新工单优先级 */
  async updateTicketPriority(
    ticketId: string,
    priority: 'normal' | 'urgent',
  ): Promise<SupportTicket> {
    const result = await this.withAdminAuth(async (db) => {
      const updated = await db
        .update(supportTickets)
        .set({ priority })
        .where(eq(supportTickets.id, ticketId))
        .returning();

      if (updated.length === 0) {
        throw new NotFoundException('工单不存在');
      }

      return this.toTicketDto(updated[0]);
    });

    return result;
  }

  /** 统计小结 */
  async getStats(): Promise<SupportStatsResponse> {
    const result = await this.withAdminAuth(async (db) => {
      const now = new Date();
      const todayStart = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          16,
          0,
          0,
          0,
        ),
      );
      if (now.getUTCHours() < 16) {
        todayStart.setUTCDate(todayStart.getUTCDate() - 1);
      }
      const todayStartIso = todayStart.toISOString();

      const results = await db
        .select({
          status: supportTickets.status,
          count: count(),
        })
        .from(supportTickets)
        .groupBy(supportTickets.status);

      const statusMap: Record<string, number> = {};
      for (const row of results) {
        statusMap[row.status] = Number(row.count);
      }

      const [totalRow] = await db.select({ total: count() }).from(supportTickets);
      const total = Number(totalRow.total);

      const [todayRow] = await db
        .select({ count: count() })
        .from(supportTickets)
        .where(gte(supportTickets.createdAt, todayStart));
      const todayNew = Number(todayRow.count);

      return {
        open: statusMap['open'] ?? 0,
        processing: statusMap['processing'] ?? 0,
        closed: statusMap['closed'] ?? 0,
        todayNew,
        total,
      };
    });

    return result;
  }

  // ========== 内部工具方法 ==========

  /** 批量填充 latestMessagePreview */
  private async fillLatestPreviews(
    db: PostgresJsDatabase,
    ticketRows: TicketRow[],
  ): Promise<SupportTicketListItem[]> {
    if (ticketRows.length === 0) return [];

    const ticketIds = ticketRows.map((t) => t.id);

    const latestMessages = await db.execute<{ ticket_id: string; body: string }>(sql`
      SELECT DISTINCT ON (sm.ticket_id) sm.ticket_id, sm.body
      FROM ${supportMessages} sm
      WHERE sm.ticket_id IN (${sql.join(ticketIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY sm.ticket_id, sm._created_at DESC
    `);

    const previewMap = new Map<string, string>();
    for (const row of latestMessages) {
      const body = row.body;
      previewMap.set(row.ticket_id, body.length > 50 ? body.slice(0, 50) + '...' : body);
    }

    return ticketRows.map((row) =>
      this.toListItemDto(row, previewMap.get(row.id) ?? null),
    );
  }
}
