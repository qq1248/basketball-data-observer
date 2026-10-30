import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Zap, Shield, Sparkles, Moon } from 'lucide-react';

export type AccentTheme = 'light-orange' | 'light-emerald' | 'light-blue' | 'dark-emerald';

export interface ThemeInfo {
  id: AccentTheme;
  name: string;
  description: string;
  color: string;
  iconName: string;
  icon: React.ElementType;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'light-orange',
    name: '活力橙',
    description: '经典竞彩橙，活力四射',
    color: '#F97316',
    iconName: 'Zap',
    icon: Zap,
  },
  {
    id: 'light-emerald',
    name: '翡翠绿',
    description: '专业翡翠绿，沉稳清晰',
    color: '#10B981',
    iconName: 'Shield',
    icon: Shield,
  },
  {
    id: 'light-blue',
    name: '经典蓝',
    description: '清爽电光蓝，科技感',
    color: '#3B82F6',
    iconName: 'Sparkles',
    icon: Sparkles,
  },
  {
    id: 'dark-emerald',
    name: '暗夜深邃',
    description: '深色护眼模式，翡翠绿',
    color: '#10B981',
    iconName: 'Moon',
    icon: Moon,
  },
];

const STORAGE_KEY = 'accent-theme';
const DEFAULT_THEME: AccentTheme = 'light-orange';
const VALID_THEMES: AccentTheme[] = ['light-orange', 'light-emerald', 'light-blue', 'dark-emerald'];

// 立即初始化主题，避免首屏闪烁（FOUC）
// 模块加载时就读取 localStorage 并设置 data-accent-theme 属性，
// 确保 React 首次渲染前主题变量已生效
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const theme: AccentTheme =
      saved && (VALID_THEMES as readonly string[]).includes(saved)
        ? (saved as AccentTheme)
        : DEFAULT_THEME;
    document.documentElement.setAttribute('data-accent-theme', theme);
  } catch {
    // ignore
  }
}

interface ThemeContextValue {
  theme: AccentTheme;
  setTheme: (theme: AccentTheme) => void;
  themes: ThemeInfo[];
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getInitialTheme(): AccentTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (VALID_THEMES as readonly string[]).includes(saved)) {
      // 同步应用主题，确保首次渲染前属性已存在
      document.documentElement.setAttribute('data-accent-theme', saved);
      return saved as AccentTheme;
    }
  } catch {
    // ignore
  }
  // 无保存值时也立即设置默认主题
  document.documentElement.setAttribute('data-accent-theme', DEFAULT_THEME);
  return DEFAULT_THEME;
}

function applyAccentTheme(theme: AccentTheme) {
  document.documentElement.setAttribute('data-accent-theme', theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AccentTheme>(getInitialTheme);

  useEffect(() => {
    applyAccentTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = (next: AccentTheme) => {
    setThemeState(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAccentTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAccentTheme must be used within a ThemeProvider');
  }
  return ctx;
}
