import { Check } from 'lucide-react';
import { useAccentTheme } from '@client/src/contexts/ThemeContext';

export function ThemeSelector() {
  const { theme, setTheme, themes } = useAccentTheme();

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
      {themes.map((t) => {
        const isActive = theme === t.id;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-2xl border bg-[var(--card)] transition-all duration-200 active:scale-[0.97] ${
              isActive
                ? 'border-[var(--accent-primary)]'
                : 'border-[var(--border)]'
            }`}
            style={{
              boxShadow: isActive ? '0 0 0 1px var(--accent-primary)' : undefined,
            }}
          >
            <div
              className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
              style={{ backgroundColor: t.color }}
            >
              {isActive && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </div>
            <div className="flex flex-col items-start text-left">
              <div className="flex items-center gap-1.5">
                <Icon
                  className="w-3.5 h-3.5"
                  style={{ color: isActive ? t.color : 'var(--muted-foreground)' }}
                />
                <span
                  className={`text-sm font-semibold ${
                    isActive ? 'text-foreground' : 'text-foreground'
                  }`}
                >
                  {t.name}
                </span>
              </div>
              <span className="text-[11px] text-[var(--muted-foreground)] leading-tight mt-0.5">
                {t.description}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default ThemeSelector;
