// Horloge à la seconde, active seulement quand quelque chose l'affiche : une durée qui
// court, un « il y a n min », un délai de confirmation. Pas de tick quand rien ne bouge.
import { useEffect, useState } from 'react';

export function useClock(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
