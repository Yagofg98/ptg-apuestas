import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

/**
 * Carga datos con `loader` y los recarga cada vez que el backend emite un cambio
 * (Realtime de Supabase o el bus del store demo). Así las cuotas se mueven solas.
 */
export function useLive<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    loader()
      .then((d) => setData(d))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
    const unsub = api.subscribe(reload);
    return unsub;
  }, [reload]);

  return { data, loading, reload };
}
