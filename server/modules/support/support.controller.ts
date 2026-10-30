import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupportService } from './support.service';
import { AuthService } from '../auth/auth.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { UpdateTicketPriorityDto } from './dto/update-ticket-priority.dto';
import { AdminListDto } from './dto/admin-list.dto';
import type {
  SupportTicket,
  SupportMessage,
  SupportTicketListItem,
  SupportTicketWithMessages,
  SupportTicketListResponse,
  SupportStatsResponse,
} from '@shared/api.interface';

@Controller('api/support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly authService: AuthService,
  ) {}

  private async requireUser(req: Request): Promise<{ userId: string; email: string; role: string }> {
    const token = req.cookies?.['app_session'];
    if (!token) {
      throw new ForbiddenException('请先登录');
    }
    const payload = await this.authService.verifyToken(token);
    if (!payload) {
      throw new ForbiddenException('登录状态无效，请重新登录');
    }
    return payload;
  }

  private async requireAdmin(req: Request): Promise<{ userId: string; email: string; role: string }> {
    const user = await this.requireUser(req);
    if (user.role !== 'admin') {
      throw new ForbiddenException('需要管理员权限');
    }
    return user;
  }

  // ========== 用户端 ==========

  @Post('tickets')
  async createTicket(
    @Req() req: Request,
    @Body() dto: CreateTicketDto,
  ): Promise<SupportTicket> {
    const { userId, email } = await this.requireUser(req);
    const ticketEmail = dto.email || email;
    return this.supportService.createTicket(userId, { ...dto, email: ticketEmail });
  }

  @Get('tickets')
  async getUserTickets(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<SupportTicketListResponse> {
    const { userId } = await this.requireUser(req);
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    return this.supportService.getUserTickets(userId, pageNum, pageSizeNum);
  }

  @Get('tickets/:id')
  async getUserTicketDetail(
    @Req() req: Request,
    @Param('id') ticketId: string,
  ): Promise<SupportTicketWithMessages> {
    const { userId } = await this.requireUser(req);
    return this.supportService.getUserTicketDetail(userId, ticketId);
  }

  @Post('tickets/:id/messages')
  async addUserMessage(
    @Req() req: Request,
    @Param('id') ticketId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<SupportMessage> {
    const { userId } = await this.requireUser(req);
    return this.supportService.addUserMessage(userId, ticketId, dto.body);
  }

  // ========== 管理员端（静态路由在前，避免与 :id 冲突） ==========

  @Get('admin/stats')
  async getAdminStats(@Req() req: Request): Promise<SupportStatsResponse> {
    await this.requireAdmin(req);
    return this.supportService.getStats();
  }

  @Get('admin/tickets')
  async getAdminTickets(
    @Req() req: Request,
    @Query() query: AdminListDto,
  ): Promise<SupportTicketListResponse> {
    await this.requireAdmin(req);
    return this.supportService.getAdminTickets(query) as Promise<SupportTicketListResponse>;
  }

  @Get('admin/tickets/:id')
  async getAdminTicketDetail(
    @Req() req: Request,
    @Param('id') ticketId: string,
  ): Promise<SupportTicketWithMessages> {
    await this.requireAdmin(req);
    return this.supportService.getAdminTicketDetail(ticketId) as Promise<SupportTicketWithMessages>;
  }

  @Post('admin/tickets/:id/messages')
  async addAdminMessage(
    @Req() req: Request,
    @Param('id') ticketId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<SupportMessage> {
    await this.requireAdmin(req);
    return this.supportService.addAdminMessage(ticketId, dto.body);
  }

  @Patch('admin/tickets/:id/status')
  async updateTicketStatus(
    @Req() req: Request,
    @Param('id') ticketId: string,
    @Body() dto: UpdateTicketStatusDto,
  ): Promise<SupportTicket> {
    await this.requireAdmin(req);
    return this.supportService.updateTicketStatus(ticketId, dto.status);
  }

  @Patch('admin/tickets/:id/priority')
  async updateTicketPriority(
    @Req() req: Request,
    @Param('id') ticketId: string,
    @Body() dto: UpdateTicketPriorityDto,
  ): Promise<SupportTicket> {
    await this.requireAdmin(req);
    return this.supportService.updateTicketPriority(ticketId, dto.priority);
  }
}
