/**
 * VeriFace Edge Mobile — Theme Context
 *
 * Dark/Light/Auto theme switcher with persistence.
 * - 'auto' follows system appearance (changes when OS dark mode toggles)
 * - 'dark' forces dark theme
 * - 'light' forces light theme
 *
 * Theme mode is persisted in SecureStore (survives app restart).
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { darkTheme, lightTheme, type Theme, type ThemeMode } from './theme'

const THEME_KEY = 'veriface_theme_mode'

interface ThemeContextValue {
  theme: Theme
  mode: ThemeMode
  setMode: (mode: ThemeMode) => Promise<void>
  toggle: () => Promise<void>
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  mode: 'dark',
  setMode: async () => {},
  toggle: async () => {},
  isDark: true,
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()
  const [mode, setModeState] = useState<ThemeMode>('dark') // Default to dark (matches web)

  // Load saved theme mode on mount
  useEffect(() => {
    loadMode()
  }, [])

  const loadMode = async () => {
    try {
      const saved = await SecureStore.getItemAsync(THEME_KEY) as ThemeMode | null
      if (saved && ['dark', 'light', 'auto'].includes(saved)) {
        setModeState(saved)
      }
    } catch {
      // Default to dark
    }
  }

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode)
    try {
      await SecureStore.setItemAsync(THEME_KEY, newMode)
    } catch {
      // Non-critical
    }
  }, [])

  const toggle = useCallback(async () => {
    const newMode = mode === 'dark' ? 'light' : 'dark'
    await setMode(newMode)
  }, [mode, setMode])

  // Resolve actual theme based on mode + system
  const isDark = mode === 'dark' || (mode === 'auto' && systemScheme === 'dark')
  const theme = isDark ? darkTheme : lightTheme

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggle, isDark }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
