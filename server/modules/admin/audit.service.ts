import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { adminAuditLogs } from '@server/database/schema';

export type AuditActionType =
  | 'login'
  | 'create_match'
  | 'update_match'
  | 'delete_match'
  | 'update_user_role'
  | 'reset_password'
  | 'delete_user'
  | 'reply_ticket'
  | 'trigger_sync'
  | 'update_data_source'
  | 'freeze_prediction'
  | 'unfreeze_prediction';

interface LogActionOptions {
  actionType: AuditActionType;
  targetType?: string;
  targetId?: string;
  detail?: string;
  result?: 'success' | 'failed';
  operatorId?: string;
  operatorEmail?: string;
  ipAddress?: string;
  errorMessage?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async logAction(options: LogActionOptions): Promise<void> {
    try {
      const {
        actionType,
        targetType,
        targetId,
        detail,
        result = 'success',
        operatorId,
        operatorEmail,
        ipAddress,
        errorMessage,
      } = options;

      await this.db.insert(adminAuditLogs).values({
        actionType,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        detail: detail ?? null,
        result,
        operatorId: operatorId ?? null,
        operatorEmail: operatorEmail ?? null,
        ipAddress: ipAddress ?? null,
        errorMessage: errorMessage ?? null,
      });
    } catch (error) {
      // 审计失败不影响主流程，只打日志
      this.logger.error('审计日志写入失败', error instanceof Error ? error.stack : String(error));
    }
  }
}
