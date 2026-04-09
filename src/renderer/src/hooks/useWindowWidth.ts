import { useState, useEffect } from 'react'

/**
 * Hook that tracks the current window inner width.
 * Updates on resize with a small debounce for performance.
 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    let rafId: number | null = null

    const handleResize = (): void => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => {
        setWidth(window.innerWidth)
        rafId = null
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [])

  return width
}
