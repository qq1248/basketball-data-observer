import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { users } from '@server/database/schema';
import { eq, sql, count } from 'drizzle-orm';
import * as crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;
const SALT_LEN = 16;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_FAILURES = 5;
const FAILURE_RESET_MS = 15 * 60 * 1000;

const REGISTER_RATE_WINDOW_MS = 60 * 1000;
const REGISTER_RATE_MAX = 10;

const SITE_OWNER_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || '';

interface FailureRecord {
  count: number;
  lastFailureAt: number;
}

interface AuthUser {
  userId: string;
  email: string;
  emailVerified: boolean;
  role: string;
  status: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly failureMap = new Map<string, FailureRecord>();
  private readonly registerRateMap = new Map<string, { count: number; windowStart: number }>();

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async onModuleInit(): Promise<void> {
    void this.seedDefaultAdminIfEmpty();
  }

  /**
   * 用户种子逻辑（幂等且非破坏，双重保护）：
   * - 第一道：users 表非空时直接 return，完全跳过
   * - 第二道：即使空表也用 ON CONFLICT DO NOTHING，绝不覆盖任何已有账号密码
   * - 任何情况下都不会 UPDATE 或 DELETE 已存在的用户，不会重置任何人的密码
   * - 环境变量 ADMIN_EMAIL/ADMIN_PASSWORD 也仅在空表时生效，已有用户时完全跳过
   */
  private async seedDefaultAdminIfEmpty(): Promise<void> {
    try {
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(users);

      if (count > 0) {
        this.logger.log(
          `[seed] users 表已有 ${count} 个用户，跳过种子初始化（第一道：非空即跳过）`,
        );
        return;
      }

      const envAdminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
      const envAdminPassword = process.env.ADMIN_PASSWORD;

      let seedEmail: string;
      let seedPassword: string;
      if (envAdminEmail && envAdminPassword) {
        seedEmail = envAdminEmail;
        seedPassword = envAdminPassword;
        this.logger.log(`[seed] 空表检测通过，使用环境变量管理员账号: ${seedEmail}`);
      } else {
        seedEmail = SITE_OWNER_EMAIL;
        seedPassword = ADMIN_DEFAULT_PASSWORD;
        this.logger.log(`[seed] 空表检测通过，使用内置默认管理员账号: ${seedEmail}`);
      }

      const passwordHash = this.hashPassword(seedPassword);
      const result = await this.db
        .insert(users)
        .values({
          email: seedEmail,
          passwordHash,
          emailVerified: true,
          role: 'admin',
          status: 'active',
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });

      if (result.length > 0) {
        this.logger.log(`[seed] 默认管理员创建成功: ${seedEmail}`);
      } else {
        this.logger.log(
          `[seed] 邮箱 ${seedEmail} 已存在，跳过插入（第二道：ON CONFLICT DO NOTHING 保护生效）`,
        );
      }
    } catch (err) {
      this.logger.error('用户种子初始化失败', err as Error);
    }
  }

  hashPassword(password: string): string {
    const salt = crypto.randomBytes(SALT_LEN);
    const derivedKey = crypto.scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS) as Buffer;
    const params = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`;
    return `$scrypt$${params}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
  }

  verifyPassword(password: string, hash: string): boolean {
    try {
      const parts = hash.split('$');
      if (parts.length !== 5 || parts[1] !== 'scrypt') return false;

      const salt = Buffer.from(parts[3], 'base64');
      const storedHash = Buffer.from(parts[4], 'base64');

      const paramStr = parts[2];
      const paramPairs = paramStr.split(',');
      const params: Record<string, number> = {};
      for (const pair of paramPairs) {
        const [k, v] = pair.split('=');
        params[k] = parseInt(v, 10);
      }

      const derivedKey = crypto.scryptSync(password, salt, KEYLEN, {
        N: params.N,
        r: params.r,
        p: params.p,
      }) as Buffer;

      if (derivedKey.length !== storedHash.length) return false;
      return crypto.timingSafeEqual(derivedKey, storedHash);
    } catch {
      return false;
    }
  }

  generateSessionToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  generateRandomPassword(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyz';
    const upperChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '';
    const all = chars + upperChars + digits + symbols;
    const len = 12;
    const buf = crypto.randomBytes(len);
    const arr: string[] = [];
    arr.push(chars[buf[0] % chars.length]);
    arr.push(upperChars[buf[1] % upperChars.length]);
    arr.push(digits[buf[2] % digits.length]);
    for (let i = 3; i < len; i++) {
      arr.push(all[buf[i] % all.length]);
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = crypto.randomBytes(1)[0] % (i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr.join('');
  }

  validatePasswordStrength(password: string): string | null {
    if (typeof password !== 'string') return '密码不能为空';
    if (password.length < 8) return '密码长度至少为 8 位';
    if (!/[a-zA-Z]/.test(password)) return '密码必须包含字母';
    if (!/\d/.test(password)) return '密码必须包含数字';
    return null;
  }

  async verifyToken(token: string): Promise<{ userId: string; email: string; role: string } | null> {
    if (!token) return null;

    try {
      const result = await this.db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          status: users.status,
          lastActiveAt: users.lastActiveAt,
        })
        .from(users)
        .where(eq(users.sessionToken, token))
        .limit(1);

      const user = result[0];
      if (!user || user.status !== 'active') return null;

      const expiresAt = user.lastActiveAt
        ? new Date(user.lastActiveAt).getTime() + TOKEN_TTL_MS
        : 0;
      if (Date.now() > expiresAt) return null;

      return { userId: user.id, email: user.email, role: user.role };
    } catch (err) {
      this.logger.warn('session token 验证失败', err as Error);
      return null;
    }
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const record = this.failureMap.get(ip);

    if (!record) return true;
    if (now - record.lastFailureAt > FAILURE_RESET_MS) {
      this.failureMap.delete(ip);
      return true;
    }
    return record.count < MAX_FAILURES;
  }

  private recordFailure(ip: string): void {
    const now = Date.now();
    const existing = this.failureMap.get(ip);
    if (existing && now - existing.lastFailureAt > FAILURE_RESET_MS) {
      this.failureMap.set(ip, { count: 1, lastFailureAt: now });
    } else if (existing) {
      existing.count += 1;
      existing.lastFailureAt = now;
    } else {
      this.failureMap.set(ip, { count: 1, lastFailureAt: now });
    }
  }

  private resetFailures(ip: string): void {
    this.failureMap.delete(ip);
  }

  private checkRegisterRate(ip: string): boolean {
    const now = Date.now();
    const record = this.registerRateMap.get(ip);
    if (!record || now - record.windowStart > REGISTER_RATE_WINDOW_MS) {
      this.registerRateMap.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (record.count >= REGISTER_RATE_MAX) return false;
    record.count += 1;
    return true;
  }

  async register(emailRaw: string, password: string, ip: string): Promise<{ user: AuthUser; token: string }> {
    if (!this.checkRegisterRate(ip)) {
      throw new BadRequestException('注册请求过于频繁，请稍后再试');
    }

    const email = emailRaw.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    if (password.length < 8) {
      throw new BadRequestException('密码长度至少为 8 位');
    }

    const passwordHash = this.hashPassword(password);
    const sessionToken = this.generateSessionToken();

    try {
      const [result] = await this.db
        .insert(users)
        .values({
          email,
          passwordHash,
          role: 'user',
          status: 'active',
          sessionToken,
          lastActiveAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          emailVerified: users.emailVerified,
          role: users.role,
          status: users.status,
        });

      if (!result) {
        throw new ConflictException('注册失败');
      }

      this.logger.log(`用户注册成功: ${result.id}`);

      return {
        user: {
          userId: result.id,
          email: result.email,
          emailVerified: result.emailVerified,
          role: result.role,
          status: result.status,
        },
        token: sessionToken,
      };
    } catch (error) {
      const code = this.extractErrorCode(error);
      if (code === '23505') {
        throw new ConflictException('该邮箱已被注册');
      }
      this.logger.error('注册失败', error as Error);
      throw error;
    }
  }

  async login(
    emailRaw: string,
    password: string,
    ip: string,
  ): Promise<{ user: AuthUser; token: string }> {
    if (!this.checkRateLimit(ip)) {
      throw new UnauthorizedException('登录失败次数过多，请 15 分钟后再试');
    }

    const genericError = '邮箱或密码错误';
    if (!emailRaw || typeof emailRaw !== 'string') {
      throw new BadRequestException('邮箱不能为空');
    }
    const email = emailRaw.toLowerCase().trim();

    const result = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = result[0];

    if (!user) {
      this.recordFailure(ip);
      throw new UnauthorizedException(genericError);
    }

    if (user.status !== 'active') {
      this.recordFailure(ip);
      throw new UnauthorizedException(genericError);
    }

    const valid = this.verifyPassword(password, user.passwordHash);
    if (!valid) {
      this.recordFailure(ip);
      throw new UnauthorizedException(genericError);
    }

    this.resetFailures(ip);

    const sessionToken = this.generateSessionToken();
    const now = new Date();

    await this.db
      .update(users)
      .set({
        sessionToken,
        lastLoginAt: now,
        lastActiveAt: now,
      })
      .where(eq(users.id, user.id));

    return {
      user: {
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        status: user.status,
      },
      token: sessionToken,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const result = await this.db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = result[0];
    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (!user.passwordHash) {
      throw new BadRequestException('该账号为快捷登录账号，无需设置密码');
    }

    const valid = this.verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('当前密码不正确');
    }

    const strengthErr = this.validatePasswordStrength(newPassword);
    if (strengthErr) {
      throw new BadRequestException(strengthErr);
    }

    const passwordHash = this.hashPassword(newPassword);
    const sessionToken = this.generateSessionToken();

    await this.db
      .update(users)
      .set({ passwordHash, sessionToken })
      .where(eq(users.id, userId));
  }

  async logout(userId: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({ sessionToken: null })
        .where(eq(users.id, userId));
    } catch (err) {
      this.logger.warn('logout 清除 session token 失败', err as Error);
    }
  }

  async rotateSessionToken(userId: string, newToken: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({ sessionToken: newToken, lastActiveAt: new Date() })
        .where(eq(users.id, userId));
    } catch (err) {
      this.logger.warn('rotate session token 失败', err as Error);
    }
  }

  async updateLastActive(userId: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, userId));
    } catch (err) {
      this.logger.warn('更新 lastActiveAt 失败', err as Error);
    }
  }

  private extractErrorCode(error: unknown): string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
      const { code, cause } = current as { code?: unknown; cause?: unknown };
      if (typeof code === 'string') return code;
      current = cause;
    }
    return undefined;
  }

  /**
   * 平台 SSO 桥接：当请求携带平台登录态（req.userContext.userId）时，
   * 在自建 users 表中 upsert 一个平台用户账号并签发 app_session token。
   * 没有平台登录态时返回 null。
   */
  async ssoBridge(req: { userContext?: { userId?: string; userName?: string } }): Promise<{ user: AuthUser; token: string } | null> {
    const platformUserId = req.userContext?.userId;
    if (!platformUserId) {
      return null;
    }

    const email = `platform_${platformUserId}@sso.local`;
    const sessionToken = this.generateSessionToken();
    const now = new Date();

    try {
      // 先查是否已有该平台用户
      const existing = await this.db
        .select({
          id: users.id,
          email: users.email,
          emailVerified: users.emailVerified,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing.length > 0) {
        const user = existing[0];
        if (user.status !== 'active') {
          return null;
        }
        let finalRole = user.role;
        if (user.role !== 'admin') {
          const adminCount = await this.db
            .select({ count: count() })
            .from(users)
            .where(eq(users.role, 'admin'));
          const totalAdmins = Number(adminCount[0]?.count ?? 0);
          if (totalAdmins === 0) {
            await this.db
              .update(users)
              .set({ role: 'admin' })
              .where(eq(users.id, user.id));
            finalRole = 'admin';
            this.logger.log(`首个平台 SSO 用户自动提升为 admin: ${user.id}`);
          }
        }
        await this.db
          .update(users)
          .set({ sessionToken, lastActiveAt: now })
          .where(eq(users.id, user.id));

        this.logger.log(`平台 SSO 用户登录: ${user.id}`);
        return {
          user: {
            userId: user.id,
            email: user.email,
            emailVerified: user.emailVerified,
            role: finalRole,
            status: user.status,
          },
          token: sessionToken,
        };
      }

      const adminCount = await this.db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'admin'));
      const totalAdmins = Number(adminCount[0]?.count ?? 0);
      const initialRole = totalAdmins === 0 ? 'admin' : 'user';

      // 新建平台用户账号
      const passwordHash = this.hashPassword(crypto.randomBytes(32).toString('base64'));
      const [result] = await this.db
        .insert(users)
        .values({
          email,
          passwordHash,
          emailVerified: true,
          role: initialRole,
          status: 'active',
          sessionToken,
          lastActiveAt: now,
        })
        .returning({
          id: users.id,
          email: users.email,
          emailVerified: users.emailVerified,
          role: users.role,
          status: users.status,
        });

      if (!result) {
        return null;
      }

      this.logger.log(`平台 SSO 用户注册并登录: ${result.id}`);
      return {
        user: {
          userId: result.id,
          email: result.email,
          emailVerified: result.emailVerified,
          role: result.role,
          status: result.status,
        },
        token: sessionToken,
      };
    } catch (error) {
      const code = this.extractErrorCode(error);
      if (code === '23505') {
        // 并发插入冲突，重试查询
        try {
          const retry = await this.db
            .select({
              id: users.id,
              email: users.email,
              emailVerified: users.emailVerified,
              role: users.role,
              status: users.status,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          if (retry.length > 0 && retry[0].status === 'active') {
            await this.db
              .update(users)
              .set({ sessionToken, lastActiveAt: now })
              .where(eq(users.id, retry[0].id));
            return {
              user: {
                userId: retry[0].id,
                email: retry[0].email,
                emailVerified: retry[0].emailVerified,
                role: retry[0].role,
                status: retry[0].status,
              },
              token: sessionToken,
            };
          }
        } catch {
          // ignore
        }
      }
      this.logger.warn('平台 SSO 桥接失败', error as Error);
      return null;
    }
  }
}
