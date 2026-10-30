import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { getVersion } from '@client/src/api/version';
import type { VersionResponse } from '@shared/api.interface';

const LAST_SEEN_VERSION_KEY = 'lastSeenVersion';
const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

interface VersionCheckResult {
  hasNewVersion: boolean;
  newVersion: VersionResponse | null;
  currentVersion: VersionResponse | null;
  dismiss: () => void;
  applyUpdate: () => void;
}

export function useVersionCheck(): VersionCheckResult {
  const [currentVersion, setCurrentVersion] = useState<VersionResponse | null>(null);
  const [hasNewVersion, setHasNewVersion] = useState<boolean>(false);
  const [newVersion, setNewVersion] = useState<VersionResponse | null>(null);
  const dismissedRef = useRef<boolean>(false);

  const checkVersion = useCallback(async (): Promise<void> => {
    try {
      const versionData: VersionResponse = await getVersion();
      setCurrentVersion(versionData);

      const lastSeen: string | null = localStorage.getItem(LAST_SEEN_VERSION_KEY);

      // 首次访问：记录当前版本，不提示
      if (!lastSeen) {
        localStorage.setItem(LAST_SEEN_VERSION_KEY, versionData.version);
        logger.info(`[version] 首次访问，记录版本 ${versionData.version}`);
        return;
      }

      // 检测到新版本
      if (lastSeen !== versionData.version) {
        setHasNewVersion(true);
        setNewVersion(versionData);
        dismissedRef.current = false;
        logger.info(`[version] 检测到新版本：${lastSeen} → ${versionData.version}`);
      } else {
        setHasNewVersion(false);
        setNewVersion(null);
      }
    } catch (error: unknown) {
      logger.error('[version] 版本检测失败', error);
    }
  }, []);

  // 启动时立即检测 + 定时轮询
  useEffect(() => {
    checkVersion();
    const timer: ReturnType<typeof setInterval> = setInterval(checkVersion, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkVersion]);

  const dismiss = useCallback((): void => {
    dismissedRef.current = true;
    setHasNewVersion(false);
    if (newVersion) {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, newVersion.version);
      logger.info(`[version] 用户关闭版本提示，已记住版本 ${newVersion.version}`);
    } else {
      logger.info('[version] 用户关闭版本提示（本次会话内不再显示）');
    }
  }, [newVersion]);

  const applyUpdate = useCallback((): void => {
    if (newVersion) {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, newVersion.version);
      logger.info(`[version] 用户确认更新到 ${newVersion.version}，即将刷新`);
    }
    window.location.reload();
  }, [newVersion]);

  const visibleHasNew: boolean = hasNewVersion && !dismissedRef.current;

  return {
    hasNewVersion: visibleHasNew,
    newVersion: visibleHasNew ? newVersion : null,
    currentVersion,
    dismiss,
    applyUpdate,
  };
}
