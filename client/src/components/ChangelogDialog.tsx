import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import { CHANGELOG, CURRENT_VERSION } from '@client/src/utils/changelog';

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[92vw] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">
            更新日志
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            当前版本：{CURRENT_VERSION}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          <div className="space-y-5 py-2">
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="space-y-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {entry.version}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.date}
                  </span>
                </div>
                <ul className="space-y-2 pl-1">
                  {entry.items.map((item: string, idx: number) => (
                    <li key={idx} className="flex gap-2 text-sm text-foreground/85 leading-relaxed">
                      <span className="flex-shrink-0 mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/40" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
