import { useEffect, useRef } from 'react';

export function AmbientBackground() {
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const layers = Array.from(element.querySelectorAll<HTMLDivElement>('.ambient-layer'));
    const factors = [0.1, -0.08, 0.05];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0, frame = 0;

    function animate() {
      frame = 0;
      if (document.hidden || reducedMotion.matches) return;
      currentX += (targetX - currentX) * 0.05;
      currentY += (targetY - currentY) * 0.05;
      layers.forEach((layer, index) => {
        layer.style.transform = `translate(${currentX * factors[index]}px, ${currentY * factors[index]}px)`;
      });
      if (Math.abs(targetX - currentX) > 0.1 || Math.abs(targetY - currentY) > 0.1) frame = requestAnimationFrame(animate);
    }

    function handlePointerMove(event: PointerEvent) {
      if (document.hidden || reducedMotion.matches) return;
      targetX = event.clientX - window.innerWidth / 2;
      targetY = event.clientY - window.innerHeight / 2;
      if (!frame) frame = requestAnimationFrame(animate);
    }

    function syncMotion() {
      element!.dataset.paused = String(document.hidden);
      if (document.hidden || reducedMotion.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        if (reducedMotion.matches) {
          targetX = targetY = currentX = currentY = 0;
          layers.forEach(layer => { layer.style.transform = ''; });
        }
      } else if (!frame) frame = requestAnimationFrame(animate);
    }

    syncMotion();
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('visibilitychange', syncMotion);
    reducedMotion.addEventListener('change', syncMotion);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('visibilitychange', syncMotion);
      reducedMotion.removeEventListener('change', syncMotion);
    };
  }, []);

  return <div ref={scene} className="ambient-background" aria-hidden="true">
    <div className="ambient-layer"><div className="ambient-orb ambient-blue"/></div>
    <div className="ambient-layer"><div className="ambient-orb ambient-pink"/></div>
    <div className="ambient-layer"><div className="ambient-orb ambient-mint"/></div>
  </div>;
}
