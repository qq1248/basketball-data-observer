import { useEffect, useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import type { VersionResponse } from '@shared/api.interface';

const READ_VERSION_KEY = 'readVersion';
const SINGLETON_FLAG = '__vum_open__';

function acquireVumSingleton(): boolean {
  const w = globalThis as typeof globalThis & { [SINGLETON_FLAG]?: boolean };
  if (w[SINGLETON_FLAG]) return false;
  w[SINGLETON_FLAG] = true;
  return true;
}

function releaseVumSingleton(): void {
  const w = globalThis as typeof globalThis & { [SINGLETON_FLAG]?: boolean };
  w[SINGLETON_FLAG] = false;
}

interface VersionUpdateModalProps {
  hasNewVersion: boolean;
  newVersion: VersionResponse | null;
  onApply: () => void;
  onClose: () => void;
}

function formatBuildTime(isoTime: string): string {
  try {
    const date: Date = new Date(isoTime);
    const year: number = date.getFullYear();
    const month: string = String(date.getMonth() + 1).padStart(2, '0');
    const day: string = String(date.getDate()).padStart(2, '0');
    const hours: string = String(date.getHours()).padStart(2, '0');
    const minutes: string = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return isoTime;
  }
}

const VersionUpdateModal = ({
  hasNewVersion,
  newVersion,
  onApply,
  onClose,
}: VersionUpdateModalProps) => {
  const [open, setOpen] = useState<boolean>(false);
  const [hasSingleton, setHasSingleton] = useState(false);

  useEffect(() => {
    const ok = acquireVumSingleton();
    if (!ok) return;
    setHasSingleton(true);
    return () => {
      releaseVumSingleton();
      setHasSingleton(false);
    };
  }, []);

  useEffect(() => {
    if (!hasNewVersion || !newVersion) {
      setOpen(false);
      return;
    }

    const readVersion: string | null = localStorage.getItem(READ_VERSION_KEY);
    // 版本号变更后首次弹一次
    if (readVersion !== newVersion.version) {
      setOpen(true);
      logger.info(`[version] 首次弹出更新公告：v${newVersion.version}`);
    }
  }, [hasNewVersion, newVersion]);

  const handleClose = (): void => {
    if (newVersion) {
      localStorage.setItem(READ_VERSION_KEY, newVersion.version);
      logger.info(`[version] 用户关闭更新公告，已记录 readVersion=${newVersion.version}`);
    }
    setOpen(false);
    onClose();
  };

  const handleApply = (): void => {
    if (newVersion) {
      localStorage.setItem(READ_VERSION_KEY, newVersion.version);
    }
    setOpen(false);
    onApply();
  };

  if (!newVersion || !hasSingleton) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => {
      if (!isOpen) handleClose();
    }}>
      <DialogContent className="rounded-2xl border-0 p-0 max-w-md">
        <div className="p-6">
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl font-bold text-foreground">
              🎉 新版本 v{newVersion.version} 已上线
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              构建时间：{formatBuildTime(newVersion.buildTime)}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-2">
            <h4 className="text-sm font-semibold text-foreground">更新内容</h4>
            <ul className="space-y-2">
              {newVersion.changelog.map((item: string, index: number) => (
                <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-success mt-1.5 flex-shrink-0" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2 sm:justify-between px-6 pb-6 pt-0">
          <Button
            variant="outline"
            className="flex-1 border-primary/30 text-primary hover:bg-primary/5"
            onClick={handleClose}
          >
            稍后再说
          </Button>
          <Button
            variant="destructive"
            className="flex-1 bg-destructive text-destructive-foreground"
            onClick={handleApply}
          >
            立即更新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VersionUpdateModal;
