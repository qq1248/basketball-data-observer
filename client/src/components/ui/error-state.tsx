import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  message?: string;
  description?: string;
  onRetry?: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeConfig = {
  sm: {
    wrapper: 'py-6',
    icon: 'w-8 h-8',
    iconWrap: 'w-12 h-12 rounded-xl mb-3',
    title: 'text-sm',
    desc: 'text-xs',
    button: 'sm' as const,
  },
  md: {
    wrapper: 'py-10',
    icon: 'w-10 h-10',
    iconWrap: 'w-14 h-14 rounded-2xl mb-4',
    title: 'text-base',
    desc: 'text-sm',
    button: 'default' as const,
  },
  lg: {
    wrapper: 'py-16',
    icon: 'w-12 h-12',
    iconWrap: 'w-16 h-16 rounded-2xl mb-5',
    title: 'text-lg',
    desc: 'text-sm',
    button: 'default' as const,
  },
};

function ErrorState({
  message = '数据加载失败',
  description,
  onRetry,
  size = 'md',
  className,
}: ErrorStateProps) {
  const config = sizeConfig[size];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-4',
        config.wrapper,
        className,
      )}
      role="alert"
    >
      <div
        className={cn(
          'flex items-center justify-center bg-red-50 shrink-0',
          config.iconWrap,
        )}
      >
        <AlertCircle className={cn(config.icon, 'text-nebula-crimson')} />
      </div>
      <p
        className={cn(
          'font-bold text-foreground mb-1',
          config.title,
        )}
      >
        {message}
      </p>
      {description && (
        <p
          className={cn(
            'text-gray-400 max-w-md mb-4',
            config.desc,
          )}
        >
          {description}
        </p>
      )}
      {onRetry && (
        <Button
          size={config.button}
          onClick={onRetry}
          className="mt-1 bg-nebula-crimson hover:bg-nebula-crimson/90 text-white shadow-md shadow-nebula-crimson/20"
        >
          <RefreshCw className="w-4 h-4" />
          重新加载
        </Button>
      )}
    </div>
  );
}

export { ErrorState };
