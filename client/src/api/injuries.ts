import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  InjuryItem,
  InjuryListResponse,
  MatchInjuriesResponse,
} from '@shared/api.interface';

export async function getMatchInjuries(
  matchId: string,
): Promise<MatchInjuriesResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/injuries/match/${matchId}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取比赛伤停信息失败', error);
    throw error;
  }
}

export interface GetInjuryListParams {
  teamName?: string;
  impactLevel?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function getInjuryList(
  params: GetInjuryListParams = {},
): Promise<InjuryListResponse> {
  try {
    const { teamName, impactLevel, status, page = 1, pageSize = 20 } = params;
    const searchParams = new URLSearchParams();
    if (teamName) searchParams.set('teamName', teamName);
    if (impactLevel) searchParams.set('impactLevel', impactLevel);
    if (status) searchParams.set('status', status);
    searchParams.set('page', String(page));
    searchParams.set('pageSize', String(pageSize));
    const response = await axiosForBackend({
      url: `/api/injuries?${searchParams.toString()}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取伤停列表失败', error);
    throw error;
  }
}

export async function getTeamInjuries(
  teamId: string,
): Promise<{ items: InjuryItem[] }> {
  try {
    const response = await axiosForBackend({
      url: `/api/injuries/team/${teamId}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取球队伤停信息失败', error);
    throw error;
  }
}
