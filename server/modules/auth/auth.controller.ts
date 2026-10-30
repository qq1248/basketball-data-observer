import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

const COOKIE_NAME = 'app_session';
const COOKIE_PATH = '/';
const COOKIE_SAME_SITE = 'lax' as const;
const IS_PROD = process.env.NODE_ENV === 'production';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private getClientIp(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    return req.ip || 'unknown';
  }

  private setSessionCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: COOKIE_SAME_SITE,
      path: COOKIE_PATH,
      secure: IS_PROD,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private clearSessionCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: COOKIE_SAME_SITE,
      path: COOKIE_PATH,
      secure: IS_PROD,
    });
  }

  private getTokenFromCookie(req: Request): string | null {
    const token = req.cookies?.[COOKIE_NAME];
    return token || null;
  }

  @Post('register')
  async register(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = body;
    const ip = this.getClientIp(req);
    const { user, token } = await this.authService.register(email, password, ip);
    this.setSessionCookie(res, token);
    return {
      user: {
        id: user.userId,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
      },
    };
  }

  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = body;
    const ip = this.getClientIp(req);
    const { user, token } = await this.authService.login(email, password, ip);
    this.setSessionCookie(res, token);
    return {
      user: {
        id: user.userId,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
      },
    };
  }

  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.getTokenFromCookie(req);
    if (token) {
      const payload = await this.authService.verifyToken(token);
      if (payload) {
        await this.authService.logout(payload.userId);
      }
    }
    this.clearSessionCookie(res);
    return { success: true };
  }

  @Get('me')
  async me(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.getTokenFromCookie(req);

    if (token) {
      const payload = await this.authService.verifyToken(token);
      if (payload) {
        await this.authService.updateLastActive(payload.userId);
        return {
          user: {
            id: payload.userId,
            email: payload.email,
            role: payload.role,
          },
        };
      }
    }

    const ssoResult = await this.authService.ssoBridge(req);
    if (ssoResult) {
      this.setSessionCookie(res, ssoResult.token);
      return {
        user: {
          id: ssoResult.user.userId,
          email: ssoResult.user.email,
          role: ssoResult.user.role,
        },
      };
    }

    throw new UnauthorizedException('未登录');
  }

  @Post('change-password')
  async changePassword(
    @Req() req: Request,
    @Body() body: { currentPassword: string; newPassword: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.getTokenFromCookie(req);
    if (!token) {
      throw new UnauthorizedException('未登录');
    }
    const payload = await this.authService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('未登录');
    }
    const { currentPassword, newPassword } = body || {};
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('参数不完整');
    }
    await this.authService.changePassword(payload.userId, currentPassword, newPassword);

    const newToken = this.authService.generateSessionToken();
    await this.authService.rotateSessionToken(payload.userId, newToken);
    this.setSessionCookie(res, newToken);
    return { success: true };
  }
}
