import { useEffect, useState } from 'react';

export function ScrollProgressBar() {
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollable = document.querySelector('main') || document.documentElement;
      const totalHeight = scrollable.scrollHeight - scrollable.clientHeight;
      if (totalHeight <= 0) {
        setScrollProgress(0);
        return;
      }
      const currentProgress = ((scrollable.scrollTop || window.scrollY) / totalHeight) * 100;
      setScrollProgress(Math.min(100, Math.max(0, currentProgress)));
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (mainEl) mainEl.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div 
      className="fixed top-0 left-0 right-0 h-[2.5px] z-50 pointer-events-none bg-transparent"
      aria-hidden="true"
    >
      <div
        className="h-full bg-gradient-to-r from-kits-red via-red-600 to-kits-blue transition-[width] duration-150 ease-out shadow-xs"
        style={{ width: `${scrollProgress}%` }}
      />
    </div>
  );
}
