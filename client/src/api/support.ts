import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  SupportTicketListResponse,
  SupportTicketWithMessages,
  SupportStatsResponse,
  SupportMessage,
  SupportTicket,
  CreateSupportTicketRequest,
  CreateSupportMessageRequest,
  UpdateSupportTicketStatusRequest,
  UpdateSupportTicketPriorityRequest,
  AdminSupportTicketListParams,
} from '@shared/api.interface';

export async function getMyTickets(): Promise<SupportTicketListResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/support/tickets',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('getMyTickets failed', error);
    throw error;
  }
}

export async function getTicket(id: string): Promise<SupportTicketWithMessages> {
  try {
    const response = await axiosForBackend({
      url: `/api/support/tickets/${id}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error(`getTicket failed: ${id}`, error);
    throw error;
  }
}

export async function createTicket(
  data: CreateSupportTicketRequest,
): Promise<SupportTicket> {
  try {
    const response = await axiosForBackend({
      url: '/api/support/tickets',
      method: 'POST',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('createTicket failed', error);
    throw error;
  }
}

export async function sendMessage(
  id: string,
  body: string,
): Promise<SupportMessage> {
  try {
    const response = await axiosForBackend({
      url: `/api/support/tickets/${id}/messages`,
      method: 'POST',
      data: { body },
    });
    return response.data;
  } catch (error) {
    logger.error(`sendMessage failed: ${id}`, error);
    throw error;
  }
}

export async function getAdminTickets(
  params?: AdminSupportTicketListParams,
): Promise<SupportTicketListResponse> {
  try {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.page) search.set('page', String(params.page));
    if (params?.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    const response = await axiosForBackend({
      url: `/api/support/admin/tickets${qs ? `?${qs}` : ''}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('getAdminTickets failed', error);
    throw error;
  }
}

export async function getAdminTicket(
  id: string,
): Promise<SupportTicketWithMessages> {
  try {
    const response = await axiosForBackend({
      url: `/api/support/admin/tickets/${id}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error(`getAdminTicket failed: ${id}`, error);
    throw error;
  }
}

export async function adminReply(
  id: string,
  body: string,
): Promise<SupportMessage> {
  try {
    const response = await axiosForBackend({
      url: `/api/support/admin/tickets/${id}/messages`,
      method: 'POST',
      data: { body },
    });
    return response.data;
  } catch (error) {
    logger.error(`adminReply failed: ${id}`, error);
    throw error;
  }
}

export async function updateTicketStatus(
  id: string,
  status: 'open' | 'processing' | 'closed',
): Promise<SupportTicket> {
  try {
    const response = await axiosForBackend({
      url: `/api/support/admin/tickets/${id}/status`,
      method: 'PATCH',
      data: { status },
    });
    return response.data;
  } catch (error) {
    logger.error(`updateTicketStatus failed: ${id}`, error);
    throw error;
  }
}

export async function updateTicketPriority(
  id: string,
  priority: 'normal' | 'urgent',
): Promise<SupportTicket> {
  try {
    const response = await axiosForBackend({
      url: `/api/support/admin/tickets/${id}/priority`,
      method: 'PATCH',
      data: { priority },
    });
    return response.data;
  } catch (error) {
    logger.error(`updateTicketPriority failed: ${id}`, error);
    throw error;
  }
}

export async function getAdminStats(): Promise<SupportStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/support/admin/stats',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('getAdminStats failed', error);
    throw error;
  }
}
