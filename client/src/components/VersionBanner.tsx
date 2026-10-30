import { X, RefreshCw } from 'lucide-react';
import type { VersionResponse } from '@shared/api.interface';

interface VersionBannerProps {
  visible: boolean;
  newVersion: VersionResponse | null;
  onApply: () => void;
  onDismiss: () => void;
}

const VersionBanner = ({ visible, newVersion, onApply, onDismiss }: VersionBannerProps) => {
  if (!visible || !newVersion) return null;

  return (
    <div
      data-ai-section-type="button"
      className="relative bg-destructive/10 border-b border-destructive/20 px-3 md:px-4 py-2 flex items-start md:items-center justify-between gap-2 md:gap-3"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-destructive text-xs md:text-sm font-medium leading-snug truncate whitespace-nowrap">
          发现新版本 v{newVersion.version}，点击立即更新
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onApply}
          className="inline-flex items-center gap-1 bg-destructive text-destructive-foreground text-xs font-medium px-3 py-1 rounded-md hover:bg-destructive/90 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          立即更新
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default VersionBanner;
