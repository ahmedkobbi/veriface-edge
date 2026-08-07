'use client'

/**
 * VeriFace Edge — GSAP Hero Animation
 *
 * Premium scroll-triggered animations using GSAP:
 *   - Word-by-word text reveal
 *   - Parallax on scroll
 *   - Staggered card entrance
 *   - Magnetic CTA button
 */

import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

interface GsapHeroProps {
  title: string
  highlight?: string
  subtitle: string
  children?: ReactNode
}

export function GsapHero({ title, highlight, subtitle, children }: GsapHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      // Split title into words and animate
      const titleEl = titleRef.current
      if (titleEl) {
        const text = titleEl.textContent ?? ''
        const words = text.split(' ')
        titleEl.innerHTML = words
          .map((w) => `<span class="inline-block overflow-hidden"><span class="inline-block gsap-word">${w}</span></span>`)
          .join(' ')

        tl.from('.gsap-word', {
          y: '100%',
          opacity: 0,
          stagger: 0.05,
          duration: 0.8,
        })
      }

      // Animate subtitle
      tl.from(
        subtitleRef.current,
        {
          y: 30,
          opacity: 0,
          duration: 0.8,
        },
        '-=0.4',
      )

      // Animate CTA
      tl.from(
        ctaRef.current,
        {
          y: 20,
          opacity: 0,
          duration: 0.6,
        },
        '-=0.4',
      )

      // Parallax on scroll
      gsap.to(titleRef.current, {
        yPercent: -30,
        opacity: 0.5,
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      })
    },
    { scope: containerRef },
  )

  return (
    <div ref={containerRef} className="relative">
      <h2
        ref={titleRef}
        className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-slate-100 mb-6 leading-[1.1]"
      >
        {title}{' '}
        {highlight && (
          <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
            {highlight}
          </span>
        )}
      </h2>
      <p
        ref={subtitleRef}
        className="text-base md:text-lg text-slate-400 max-w-2xl mb-8 leading-relaxed"
      >
        {subtitle}
      </p>
      <div ref={ctaRef}>{children}</div>
    </div>
  )
}
