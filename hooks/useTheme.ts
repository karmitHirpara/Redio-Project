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
    setTheme(prev => prev === 'default' ? 'light' : 'default');
  };

  return { theme, toggleTheme };
}
