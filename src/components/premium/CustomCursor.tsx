'use client'

/**
 * VeriFace Edge — Custom Cursor
 *
 * Premium custom cursor with magnetic hover detection.
 * The cursor grows when hovering over interactive elements.
 *
 * Disabled on touch devices (no cursor on mobile).
 */

import { useEffect, useState } from 'react'
import { animated, useSpring } from '@react-spring/web'

export function CustomCursor() {
  const [enabled, setEnabled] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [hidden, setHidden] = useState(true)

  const [springs, api] = useSpring(() => ({
    x: 0,
    y: 0,
    scale: 1,
    config: { tension: 500, friction: 30, mass: 0.3 },
  }))

  useEffect(() => {
    // Only enable on devices with fine pointer (mouse)
    if (!window.matchMedia('(pointer: fine)').matches) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(true)

    const handleMouseMove = (e: MouseEvent) => {
      api.start({ x: e.clientX, y: e.clientY })
       
      setHidden(false)

      // Check if hovering over interactive element
      const target = e.target as HTMLElement
      const interactive = target.closest('button, a, input, [role="button"], [data-cursor="hover"]')
       
      setHovering(!!interactive)
    }

     
    const handleMouseLeave = () => setHidden(true)

    window.addEventListener('mousemove', handleMouseMove)
    document.documentElement.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [api])

  if (!enabled) return null

  return (
    <>
      {/* Hide default cursor */}
      <style jsx global>{`
        * { cursor: none !important; }
      `}</style>

      {/* Outer ring */}
      <animated.div
        style={{
          x: springs.x,
          y: springs.y,
          scale: hovering ? 1.5 : 1,
          opacity: hidden ? 0 : 1,
        }}
        className="fixed top-0 left-0 z-[9999] pointer-events-none"
      >
        <div
          className="rounded-full border-2 transition-colors duration-200"
          style={{
            width: 32,
            height: 32,
            marginLeft: -16,
            marginTop: -16,
            borderColor: hovering ? '#10b981' : 'rgba(255,255,255,0.4)',
            backgroundColor: hovering ? 'rgba(16,185,129,0.1)' : 'transparent',
          }}
        />
      </animated.div>

      {/* Inner dot */}
      <animated.div
        style={{
          x: springs.x,
          y: springs.y,
          scale: hovering ? 0.5 : 1,
          opacity: hidden ? 0 : 1,
        }}
        className="fixed top-0 left-0 z-[9999] pointer-events-none"
      >
        <div
          className="rounded-full transition-colors duration-200"
          style={{
            width: 6,
            height: 6,
            marginLeft: -3,
            marginTop: -3,
            backgroundColor: hovering ? '#10b981' : '#ffffff',
          }}
        />
      </animated.div>
    </>
  )
}
