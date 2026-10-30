import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { CHANGELOG, CURRENT_VERSION } from '@client/src/utils/changelog';

const STORAGE_KEY = 'changelog_last_seen_version';
const SINGLETON_FLAG = '__va_open__';

function acquireSingleton(): boolean {
  const w = globalThis as typeof globalThis & { [SINGLETON_FLAG]?: boolean };
  if (w[SINGLETON_FLAG]) return false;
  w[SINGLETON_FLAG] = true;
  return true;
}

function releaseSingleton(): void {
  const w = globalThis as typeof globalThis & { [SINGLETON_FLAG]?: boolean };
  w[SINGLETON_FLAG] = false;
}

export function VersionAnnouncement() {
  const [open, setOpen] = useState(false);
  const [hasSingleton, setHasSingleton] = useState(false);

  useEffect(() => {
    const ok = acquireSingleton();
    if (!ok) return;
    setHasSingleton(true);
    try {
      const lastSeen = localStorage.getItem(STORAGE_KEY);
      if (lastSeen !== CURRENT_VERSION) {
        setOpen(true);
      }
    } catch {
      // localStorage not available, skip
    }
    return () => {
      releaseSingleton();
      setHasSingleton(false);
    };
  }, []);

  const handleClose = () => {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const latest = CHANGELOG[0];
  if (!latest || !hasSingleton) return null;

  const displayItems = latest.items.slice(0, 3).map((item: string) =>
    item.length > 50 ? item.slice(0, 48) + '…' : item
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen: boolean) => {
      if (!nextOpen) handleClose();
    }}>
      <DialogContent
        className={
          // 移动端：底部弹层 bottom sheet
          // 桌面端：居中弹窗
          // max-h 双写：vh 兜底（微信X5不支持dvh），dvh 增强（现代浏览器地址栏变化时更准）
          // 正文区 bottom 预留 pb-20（≈80px），保证最后一条内容不被固定按钮挡住
          'fixed inset-x-0 bottom-0 sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 '
          + 'w-full sm:w-[92vw] sm:max-w-md '
          + 'max-h-[80vh] max-h-[92dvh] sm:max-h-[80vh] sm:max-h-[85dvh] '
          + 'rounded-t-2xl sm:rounded-lg '
          + 'overflow-hidden flex flex-col p-0 gap-0 border-t-0 sm:border '
          + 'pb-20 sm:pb-0'
        }
        showCloseButton={false}
      >
        <div className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold text-foreground">
            新版本 {latest.version} 已更新
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            发布日期：{latest.date}
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full">
          <ul className="space-y-2.5 py-1">
            {displayItems.map((item: string, idx: number) => (
              <li key={idx} className="flex gap-2 text-sm text-foreground/90 leading-relaxed">
                <span className="flex-shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 固定在视口底部的按钮区 — 不依赖 dvh，微信X5也能保证可见 */}
        <div
          className="fixed inset-x-0 bottom-0 z-[60] bg-background border-t border-border px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] flex justify-center sm:static sm:z-auto sm:bg-transparent sm:border-0 sm:px-5 sm:py-3 sm:border-t sm:border-border"
        >
          <Button
            onClick={handleClose}
            className="h-12 px-8 text-base min-w-[160px] justify-center"
          >
            知道了
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
