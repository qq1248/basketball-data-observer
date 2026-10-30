import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Home, Loader2 } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import { toast } from 'sonner';

interface AdminRouteGuardProps {
  children: React.ReactNode;
}

export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const syncStore = useSyncStore();
  const selfUser = syncStore.user;
  const authLoading = syncStore.authLoading;
  const navigate = useNavigate();
  const isLoggedIn = !!selfUser;
  const isAdmin = selfUser?.role === 'admin';

  useEffect(() => {
    if (!authLoading && !selfUser) {
      toast.error('无权限（403）');
      navigate('/', { replace: true });
    }
  }, [selfUser, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // 未登录
  if (!isLoggedIn) {
    return null;
  }

  // 已登录但非 admin → 403 无权限
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">无权限访问</h1>
          <p className="text-sm text-muted-foreground mb-6">
            此页面仅管理员可访问。如需权限请联系系统管理员。
          </p>
          <Button
            variant="outline"
            onClick={() => navigate('/')}
            data-ai-section-type="button"
          >
            <Home className="w-4 h-4 mr-2" />
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  // 是 admin → 渲染子组件
  return <>{children}</>;
}
