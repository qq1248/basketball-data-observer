import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  TeamItem,
  TeamSearchResponse,
  TeamProfileResponse,
} from '@shared/api.interface';

export interface SearchTeamsParams {
  keyword?: string;
  league?: string;
  page?: number;
  pageSize?: number;
}

export async function searchTeams(
  params: SearchTeamsParams = {},
): Promise<TeamSearchResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (params.keyword) queryParams.set('keyword', params.keyword);
    if (params.league) queryParams.set('league', params.league);
    if (params.page !== undefined) queryParams.set('page', String(params.page));
    if (params.pageSize !== undefined)
      queryParams.set('pageSize', String(params.pageSize));
    const url = `/api/teams${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('搜索球队失败', error);
    throw error;
  }
}

export async function getTeamDetail(id: string): Promise<{ team: TeamItem }> {
  try {
    const response = await axiosForBackend({
      url: `/api/teams/${id}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取球队详情失败', error);
    throw error;
  }
}

export async function getTeamByName(name: string): Promise<{ team: TeamItem }> {
  try {
    const response = await axiosForBackend({
      url: `/api/teams/by-name/${encodeURIComponent(name)}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('按名称获取球队失败', error);
    throw error;
  }
}

export async function getTeamProfile(
  teamName: string,
  sport: 'football' | 'basketball' = 'football',
  opponent?: string,
): Promise<TeamProfileResponse> {
  try {
    const params = new URLSearchParams();
    params.set('sport', sport);
    if (opponent) params.set('opponent', opponent);
    const url = `/api/teams/profile/${encodeURIComponent(teamName)}?${params.toString()}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取球队档案数据失败', error);
    throw error;
  }
}
