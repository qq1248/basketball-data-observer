import { useState, useEffect } from 'react';
import { X, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { logger } from '@lark-apaas/client-toolkit/logger';

const STORAGE_KEY = 'pwa_install_dismissed';

export const PWAPrompt = () => {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;

    const dismissed = sessionStorage.getItem(STORAGE_KEY);
    if (dismissed === 'true') return;

    const ua = navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua) && !('serviceWorker' in navigator && 'BeforeInstallPromptEvent' in window);
    setIsIOS(ios);

    if (ios) {
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setShow(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      setShow(false);
      sessionStorage.setItem(STORAGE_KEY, 'true');
      return;
    }
    if (!deferredPrompt) return;
    try {
      const prompt = deferredPrompt as unknown as { prompt: () => Promise<{ outcome: string }> };
      await prompt.prompt();
    } catch (err) {
      logger.warn('PWA install prompt failed', err);
    }
    setShow(false);
    sessionStorage.setItem(STORAGE_KEY, 'true');
  };

  const handleDismiss = () => {
    setShow(false);
    sessionStorage.setItem(STORAGE_KEY, 'true');
  };

  if (!show || isStandalone) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="md:hidden"
      >
        <div className="relative bg-gradient-to-r from-nebula-crimson to-red-900 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Download className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-medium truncate">
              {isIOS ? '分享 → 添加到主屏幕' : '安装到桌面，全屏体验'}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleInstall}
              className="text-xs font-bold px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 active:scale-95 transition-all"
            >
              {isIOS ? '知道了' : '安装'}
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-full hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              aria-label="关闭安装提示"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PWAPrompt;
