import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { FavoriteListResponse, FavoriteItem, SportType } from '@shared/api.interface';

export async function getFavorites(sportType?: SportType): Promise<FavoriteListResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (sportType) queryParams.set('sportType', sportType);
    const url = `/api/favorites${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取收藏列表失败', error);
    throw error;
  }
}

export async function addFavorite(matchId: string, sportType?: SportType): Promise<FavoriteItem> {
  try {
    const response = await axiosForBackend({
      url: `/api/favorites/${matchId}`,
      method: 'POST',
      data: { sportType },
    });
    return response.data;
  } catch (error) {
    logger.error('添加收藏失败', error);
    throw error;
  }
}

export async function removeFavorite(matchId: string, sportType?: SportType): Promise<void> {
  try {
    const queryParams = new URLSearchParams();
    if (sportType) queryParams.set('sportType', sportType);
    const url = `/api/favorites/${matchId}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    await axiosForBackend({
      url,
      method: 'DELETE',
    });
  } catch (error) {
    logger.error('取消收藏失败', error);
    throw error;
  }
}
