import { useEffect, useRef } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import operationsAnalystData from '../../assets/lottie/operations-analyst.json';

export interface OperationsLottiePlayerProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
  altText?: string;
}

export function OperationsLottiePlayer({
  className = '',
  width = '100%',
  height = '100%',
  loop = true,
  autoplay = true,
  speed = 1,
  altText = 'KITS-EOS Operations Analyst Reviewing Real-Time Dashboard',
}: OperationsLottiePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animItemRef = useRef<AnimationItem | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Check prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const prefersReducedMotion = mediaQuery.matches;

    // Initialize Lottie instance with SVG renderer
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: prefersReducedMotion ? false : loop,
      autoplay: prefersReducedMotion ? false : autoplay,
      animationData: operationsAnalystData,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: true,
        hideOnTransparent: false,
        className: 'w-full h-full block mx-auto',
      },
    });

    anim.addEventListener('DOMLoaded', () => {
      if (containerRef.current) {
        const svg = containerRef.current.querySelector('svg');
        if (svg) {
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.display = 'block';
        }
      }
      anim.goToAndPlay(20, true);
    });

    anim.setSpeed(speed);
    animItemRef.current = anim;

    // If reduced motion is requested, render static initial frame
    if (prefersReducedMotion) {
      anim.goToAndStop(30, true);
    }

    // 1. Tab Visibility Observer: Pause in background tabs to conserve CPU
    const handleVisibilityChange = () => {
      if (!animItemRef.current || prefersReducedMotion) return;
      if (document.hidden) {
        animItemRef.current.pause();
      } else {
        animItemRef.current.play();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 2. IntersectionObserver: Only animate when visible in the viewport
    let observer: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window && containerRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!animItemRef.current || prefersReducedMotion) return;
            if (entry.isIntersecting && !document.hidden) {
              animItemRef.current.play();
            } else {
              animItemRef.current.pause();
            }
          });
        },
        { threshold: 0.1 }
      );
      observer.observe(containerRef.current);
    }

    // 3. Dynamic Reduced Motion Listener
    const handleMotionPreference = (e: MediaQueryListEvent) => {
      if (!animItemRef.current) return;
      if (e.matches) {
        animItemRef.current.goToAndStop(30, true);
      } else {
        animItemRef.current.play();
      }
    };
    mediaQuery.addEventListener('change', handleMotionPreference);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      mediaQuery.removeEventListener('change', handleMotionPreference);
      if (observer) observer.disconnect();
      anim.destroy();
      animItemRef.current = null;
    };
  }, [loop, autoplay, speed]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={altText}
      className={`relative select-none pointer-events-none ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        maxWidth: '100%',
      }}
    />
  );
}
