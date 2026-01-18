import { useState, useEffect } from 'react';
import { Theme } from '../types';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('default');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('default', 'light');
    root.classList.add(theme);
  }, [theme]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reduceMotion) {
      root.classList.add('theme-transition');
      window.setTimeout(() => {
        root.classList.remove('theme-transition');
      }, 260);
    }

    setTheme((prev) => (prev === 'default' ? 'light' : 'default'));
  };

  return { theme, toggleTheme };
}
