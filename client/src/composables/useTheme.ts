import { ref, watch } from 'vue'

type Theme = 'light' | 'dark'

const THEME_KEY = 'cw-theme'

const currentTheme = ref<Theme>((localStorage.getItem(THEME_KEY) as Theme) || 'light')

export function useTheme() {
  const setTheme = (theme: Theme) => {
    currentTheme.value = theme
    localStorage.setItem(THEME_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  }

  const toggleTheme = () => {
    const newTheme = currentTheme.value === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
  }

  const initTheme = () => {
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme
    if (savedTheme) {
      setTheme(savedTheme)
    } else {
      setTheme('light')
    }
  }

  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
  })

  return {
    currentTheme,
    setTheme,
    toggleTheme,
    initTheme
  }
}
