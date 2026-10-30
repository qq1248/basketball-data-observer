type LiveCountListener = (count: number) => void;

const EVENT_NAME = 'app-live-count-change';
let currentCount = 0;

export function setLiveCount(count: number): void {
  currentCount = count;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: count }));
  }
}

export function getLiveCount(): number {
  return currentCount;
}

export function onLiveCountChange(listener: LiveCountListener): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<number>).detail;
    listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  if (currentCount > 0) listener(currentCount);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
