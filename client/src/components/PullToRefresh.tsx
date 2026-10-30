import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { RefreshCw, Check } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  threshold?: number;
}

const PULL_THRESHOLD = 70;
const MAX_PULL = 130;

export function PullToRefresh({ onRefresh, children, threshold = PULL_THRESHOLD }: PullToRefreshProps) {
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'ready' | 'refreshing' | 'done'>('idle');
  const pullY = useMotionValue(0);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const getScrollTop = useCallback((): number => {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (phaseRef.current === 'refreshing') return;
    if (getScrollTop() <= 5) {
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = false;
    }
  }, [getScrollTop]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (phaseRef.current === 'refreshing') return;
    if (startYRef.current === null) {
      if (getScrollTop() <= 5) {
        startYRef.current = e.touches[0].clientY;
      }
      return;
    }

    const currentY = e.touches[0].clientY;
    const delta = currentY - startYRef.current;

    if (delta <= 0) {
      if (pullingRef.current) {
        pullY.set(0);
        pullingRef.current = false;
        setPhase('idle');
      }
      return;
    }

    if (getScrollTop() > 5) {
      startYRef.current = currentY;
      if (pullingRef.current) {
        pullY.set(0);
        pullingRef.current = false;
        setPhase('idle');
      }
      return;
    }

    const dampened = delta < threshold
      ? delta
      : threshold + (delta - threshold) * 0.35;

    const clamped = Math.min(dampened, MAX_PULL);
    pullY.set(clamped);
    pullingRef.current = true;
    setPhase(clamped >= threshold ? 'ready' : 'pulling');

    if (e.cancelable) {
      e.preventDefault();
    }
  }, [pullY, threshold, getScrollTop]);

  const handleTouchEnd = useCallback(async () => {
    if (phaseRef.current === 'refreshing') return;
    if (!pullingRef.current) {
      startYRef.current = null;
      return;
    }

    const currentPull = pullY.get();
    if (currentPull >= threshold) {
      setPhase('refreshing');
      pullY.set(56);
      try {
        await Promise.resolve(onRefresh());
        setPhase('done');
        setTimeout(() => {
          pullY.set(0);
          setPhase('idle');
        }, 700);
      } catch (err) {
        logger.warn('Pull to refresh failed', err);
        pullY.set(0);
        setPhase('idle');
      }
    } else {
      pullY.set(0);
      setPhase('idle');
    }

    startYRef.current = null;
    pullingRef.current = false;
  }, [pullY, threshold, onRefresh]);

  useEffect(() => {
    const isMobile = 'ontouchstart' in window && window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const indicatorTranslate = useTransform(pullY, (v) => `${v - 60}px`);

  return (
    <>
      <motion.div
        style={{ y: indicatorTranslate }}
        className="fixed top-12 left-0 right-0 z-[60] flex justify-center pointer-events-none md:hidden"
      >
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white shadow-lg border border-border/60 text-xs">
          {phase === 'refreshing' && (
            <>
              <RefreshCw className="w-4 h-4 text-nebula-crimson animate-spin" />
              <span className="font-medium text-nebula-crimson">刷新中…</span>
            </>
          )}
          {phase === 'done' && (
            <>
              <Check className="w-4 h-4 text-home-win" />
              <span className="font-medium text-home-win">已更新</span>
            </>
          )}
          {phase === 'ready' && (
            <>
              <RefreshCw className="w-4 h-4 text-nebula-crimson" />
              <span className="font-medium text-nebula-crimson">释放立即刷新</span>
            </>
          )}
          {(phase === 'pulling' || phase === 'idle') && pullY.get() > 5 && (
            <>
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">下拉刷新</span>
            </>
          )}
        </div>
      </motion.div>
      {children}
    </>
  );
}

export default PullToRefresh;
