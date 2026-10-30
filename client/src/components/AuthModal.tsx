import React, { useState, useCallback, type FormEvent } from 'react';
import { Mail, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@client/src/components/ui/tabs';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { useAuth } from '@client/src/hooks/useAuth';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultTab?: 'login' | 'register';
}

const EMAIL_REGEX: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthModal({
  open,
  onOpenChange,
  onSuccess,
  defaultTab = 'login',
}: AuthModalProps): React.ReactElement {
  const { login, register } = useAuth();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(defaultTab);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // 登录表单
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  // 注册表单
  const [registerEmail, setRegisterEmail] = useState<string>('');
  const [registerPassword, setRegisterPassword] = useState<string>('');
  const [registerError, setRegisterError] = useState<string>('');

  const resetForm = useCallback((): void => {
    setLoginEmail('');
    setLoginPassword('');
    setLoginError('');
    setRegisterEmail('');
    setRegisterPassword('');
    setRegisterError('');
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      onOpenChange(nextOpen);
      if (!nextOpen) {
        resetForm();
        setActiveTab(defaultTab);
      }
    },
    [onOpenChange, resetForm, defaultTab],
  );

  const handleLoginSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      setLoginError('');

      if (!EMAIL_REGEX.test(loginEmail)) {
        setLoginError('请输入有效的邮箱地址');
        return;
      }
      if (!loginPassword) {
        setLoginError('请输入密码');
        return;
      }

      setSubmitting(true);
      try {
        await login(loginEmail.trim(), loginPassword);
        toast.success('登录成功');
        handleOpenChange(false);
        onSuccess?.();
      } catch {
        setLoginError('邮箱或密码错误');
      } finally {
        setSubmitting(false);
      }
    },
    [login, loginEmail, loginPassword, handleOpenChange, onSuccess],
  );

  const handleRegisterSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      setRegisterError('');

      if (!EMAIL_REGEX.test(registerEmail)) {
        setRegisterError('请输入有效的邮箱地址');
        return;
      }
      if (registerPassword.length < 8) {
        setRegisterError('密码至少 8 位');
        return;
      }

      setSubmitting(true);
      try {
        await register(registerEmail.trim(), registerPassword);
        toast.success('注册成功');
        handleOpenChange(false);
        onSuccess?.();
      } catch (err: unknown) {
        const message: string =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: { message?: string } } }).response
                ?.data?.message ?? '注册失败，请稍后重试'
            : '注册失败，请稍后重试';
        setRegisterError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [register, registerEmail, registerPassword, handleOpenChange, onSuccess],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-xl text-[hsl(210_100%_16%)]">
            欢迎回来
          </DialogTitle>
          <DialogDescription>
            登录后可跨设备同步你的收藏与关注
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v: string) =>
            setActiveTab(v as 'login' | 'register')
          }
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">登录</TabsTrigger>
            <TabsTrigger value="register">注册</TabsTrigger>
          </TabsList>

          {/* 登录 Tab */}
          <TabsContent value="login" className="mt-4">
            <form
              onSubmit={handleLoginSubmit}
              className="space-y-4"
              data-ai-section-type="form"
            >
              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="邮箱地址"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="pl-10"
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="密码"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-10"
                    autoComplete="current-password"
                  />
                </div>
              </div>
              {loginError && (
                <p className="text-sm text-destructive">{loginError}</p>
              )}
              <Button
                type="submit"
                className="w-full bg-[hsl(210_100%_16%)] text-white hover:bg-[hsl(210_100%_20%)]"
                disabled={submitting}
              >
                {submitting ? '登录中...' : '登录'}
              </Button>
            </form>
          </TabsContent>

          {/* 注册 Tab */}
          <TabsContent value="register" className="mt-4">
            <form
              onSubmit={handleRegisterSubmit}
              className="space-y-4"
              data-ai-section-type="form"
            >
              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="邮箱地址"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    className="pl-10"
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="密码（至少 8 位）"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    className="pl-10"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {registerError && (
                <p className="text-sm text-destructive">{registerError}</p>
              )}
              <Button
                type="submit"
                className="w-full bg-[hsl(210_100%_16%)] text-white hover:bg-[hsl(210_100%_20%)]"
                disabled={submitting}
              >
                {submitting ? '注册中...' : '注册'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground text-center pt-2">
          仅保存邮箱与你的收藏/关注设置，不用于其他用途
        </p>
      </DialogContent>
    </Dialog>
  );
}
