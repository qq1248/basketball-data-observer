import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';

export interface ActionSheetItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  items: ActionSheetItem[];
  title?: string;
}

export default function ActionSheet({ open, onClose, items, title }: ActionSheetProps) {
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    // 禁止背景滚动
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // ESC 关闭
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, [open, onClose]);

  const handleItemClick = (item: ActionSheetItem) => {
    try {
      item.onClick();
    } catch (err) {
      logger.error('ActionSheet item click error', err);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 内容 */}
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-2xl animate-slide-up max-h-[80vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title || '操作菜单'}
      >
        {/* 顶部手柄 */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* 标题栏 */}
        {title && (
          <div className="flex items-center justify-between px-5 py-2 border-b border-gray-100">
            <span className="text-sm font-medium text-muted-foreground">{title}</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* 菜单项列表 */}
        <div className="overflow-y-auto [-webkit-overflow-scrolling:touch] flex-1">
          {items.map((item: ActionSheetItem, index: number) => (
            <button
              key={item.key}
              onClick={() => handleItemClick(item)}
              className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors active:bg-gray-100 min-h-[48px] ${
                index < items.length - 1 ? 'border-b border-gray-50' : ''
              } ${
                item.danger
                  ? 'text-destructive hover:bg-destructive/5'
                  : 'text-foreground hover:bg-gray-50'
              }`}
            >
              {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
              <span className="flex-1 text-base font-medium">{item.label}</span>
            </button>
          ))}
        </div>

        {/* 底部安全区 + 取消按钮 */}
        <div className="border-t-4 border-gray-100">
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center px-5 py-3.5 text-foreground font-medium active:bg-gray-100 min-h-[48px] text-base"
          >
            取消
          </button>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </div>
    </div>
  );
}

/**
 * Hook: 为元素添加长按 / 右键触发 ActionSheet 的能力
 * 用法：const { handlers, open, setOpen } = useLongPressAction(500);
 *       在元素上 spread handlers，用 open/setOpen 控制 ActionSheet
 */
export function useLongPressAction(delay = 500) {
  const timerRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const startPress = (callback: () => void) => {
    triggeredRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      triggeredRef.current = true;
      callback();
      // 触觉反馈（如果支持）
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(10);
        } catch {
          // ignore
        }
      }
    }, delay);
  };

  const endPress = () => {
    clearTimer();
  };

  const handleContextMenu = (e: React.MouseEvent, callback: () => void) => {
    e.preventDefault();
    callback();
  };

  return {
    // 移动端长按
    onTouchStart: (callback: () => void) => () => startPress(callback),
    onTouchEnd: endPress,
    onTouchMove: endPress,
    onTouchCancel: endPress,
    // 桌面端右键
    onContextMenu: (callback: () => void) => (e: React.MouseEvent) => handleContextMenu(e, callback),
    // 辅助判断是否刚触发过长按（用于区分 click 与 long-press-end）
    wasTriggered: () => triggeredRef.current,
    resetTriggered: () => {
      triggeredRef.current = false;
    },
  };
}
