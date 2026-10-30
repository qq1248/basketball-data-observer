import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { FollowedTeamListResponse, FollowedTeamItem } from '@shared/api.interface';

export async function getFollowedTeams(): Promise<FollowedTeamListResponse> {
  const res = await axiosForBackend.get('/api/followed-teams');
  return res.data;
}

export async function addFollowedTeam(teamName: string, teamLogo?: string): Promise<FollowedTeamItem> {
  const res = await axiosForBackend.post('/api/followed-teams', { teamName, teamLogo });
  return res.data;
}

export async function removeFollowedTeam(teamName: string): Promise<{ success: boolean }> {
  const res = await axiosForBackend.delete(`/api/followed-teams/${teamName}`);
  return res.data;
}

export async function checkFollowed(teamName: string): Promise<{ followed: boolean }> {
  const res = await axiosForBackend.get(`/api/followed-teams/check/${teamName}`);
  return res.data;
}
