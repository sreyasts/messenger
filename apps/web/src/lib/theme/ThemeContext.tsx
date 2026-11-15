// apps/web/src/lib/theme/ThemeContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeAccent } from '@/types/database';

export interface ThemeConfig {
  name: string;
  gradientClass: string;
  bubbleClass: string;
  primaryHex: string;
  activeRing: string;
}

export const THEME_CONFIGS: Record<ThemeAccent, ThemeConfig> = {
  'violet-pink': {
    name: 'Violet Pink',
    gradientClass: 'bg-gradient-to-tr from-[#8A2387] via-[#E94057] to-[#F27121]',
    bubbleClass: 'bg-gradient-to-tr from-[#8A2387] via-[#E94057] to-[#F27121] text-white',
    primaryHex: '#E1306C',
    activeRing: 'ring-[#E1306C]',
  },
  'ocean-blue': {
    name: 'Ocean Blue',
    gradientClass: 'bg-gradient-to-tr from-[#00C6FF] to-[#0072FF]',
    bubbleClass: 'bg-gradient-to-tr from-[#00C6FF] to-[#0072FF] text-white',
    primaryHex: '#0084FF',
    activeRing: 'ring-[#0084FF]',
  },
  'emerald': {
    name: 'Emerald',
    gradientClass: 'bg-gradient-to-tr from-[#11998E] to-[#38EF7D]',
    bubbleClass: 'bg-gradient-to-tr from-[#11998E] to-[#38EF7D] text-white',
    primaryHex: '#10B981',
    activeRing: 'ring-[#10B981]',
  },
  'crimson': {
    name: 'Crimson',
    gradientClass: 'bg-gradient-to-tr from-[#FF416C] to-[#FF4B2B]',
    bubbleClass: 'bg-gradient-to-tr from-[#FF416C] to-[#FF4B2B] text-white',
    primaryHex: '#EF4444',
    activeRing: 'ring-[#EF4444]',
  },
  'monochrome': {
    name: 'Monochrome',
    gradientClass: 'bg-gradient-to-tr from-[#555555] to-[#222222]',
    bubbleClass: 'bg-[#2E2E2E] text-white border border-[#444444]',
    primaryHex: '#E5E5E5',
    activeRing: 'ring-[#E5E5E5]',
  },
};

export const WALLPAPER_PRESETS = [
  { id: 'pure-black', name: 'Pure Black', url: '' },
  { id: 'midnight-dots', name: 'Subtle Grid', url: 'radial-gradient(#222222 1px, transparent 1px)' },
  { id: 'dark-mesh', name: 'Dark Nebula', url: 'radial-gradient(circle at 50% 50%, #151525 0%, #000000 100%)' },
  { id: 'emerald-dark', name: 'Deep Emerald', url: 'radial-gradient(circle at 80% 20%, #062319 0%, #000000 100%)' },
];

interface ThemeContextType {
  accent: ThemeAccent;
  setAccent: (accent: ThemeAccent) => void;
  wallpaper: string;
  setWallpaper: (wallpaper: string) => void;
  config: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextType>({
  accent: 'violet-pink',
  setAccent: () => {},
  wallpaper: '',
  setWallpaper: () => {},
  config: THEME_CONFIGS['violet-pink'],
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<ThemeAccent>('violet-pink');
  const [wallpaper, setWallpaperState] = useState<string>('');

  useEffect(() => {
    try {
      const savedAccent = localStorage.getItem('messenger_accent') as ThemeAccent;
      if (savedAccent && THEME_CONFIGS[savedAccent]) {
        setAccentState(savedAccent);
      }
      const savedWallpaper = localStorage.getItem('messenger_wallpaper');
      if (savedWallpaper) {
        setWallpaperState(savedWallpaper);
      }
    } catch (e) {
      console.warn('Failed to read theme from localStorage:', e);
    }
  }, []);

  const setAccent = (newAccent: ThemeAccent) => {
    setAccentState(newAccent);
    try {
      localStorage.setItem('messenger_accent', newAccent);
    } catch {}
  };

  const setWallpaper = (newWallpaper: string) => {
    setWallpaperState(newWallpaper);
    try {
      localStorage.setItem('messenger_wallpaper', newWallpaper);
    } catch {}
  };

  return (
    <ThemeContext.Provider
      value={{
        accent,
        setAccent,
        wallpaper,
        setWallpaper,
        config: THEME_CONFIGS[accent] || THEME_CONFIGS['violet-pink'],
      }}
    >
      <div className="dark bg-black text-white min-h-screen selection:bg-[#E1306C] selection:text-white">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
