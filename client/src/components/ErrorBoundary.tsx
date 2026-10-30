import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
  showBack?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('ErrorBoundary caught error', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  handleBack = (): void => {
    // 通过自定义事件通知上层使用 navigate
    window.history.back();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallbackTitle = '加载失败', fallbackMessage, showBack } = this.props;
      return (
        <div className="rounded-xl p-8 border border-border bg-card text-center shadow-sm">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-muted-foreground/60" />
            </div>
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">{fallbackTitle}</h3>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            {fallbackMessage || '数据加载失败，请稍后重试'}
          </p>
          <div className="flex items-center justify-center gap-2">
            {showBack && (
              <button
                onClick={this.handleBack}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md border border-border bg-card text-foreground hover:bg-muted/50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                返回
              </button>
            )}
            {this.props.onReset && (
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
