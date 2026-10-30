import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { PlayerItem } from '@shared/api.interface';

export async function getPlayersByTeam(teamName: string): Promise<PlayerItem[]> {
  const res = await axiosForBackend.get(`/api/players/team/${encodeURIComponent(teamName)}`);
  return res.data;
}

export async function getPlayerById(id: string): Promise<PlayerItem> {
  const res = await axiosForBackend.get(`/api/players/${id}`);
  return res.data;
}
