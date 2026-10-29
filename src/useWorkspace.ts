import { useEffect, useRef, useState } from 'react';
import { request, SerializedLoader } from './api';
import type { Session, ViewState } from './types';
export function useWorkspace(obs: boolean) {
  const [session, setSession] = useState<Session | null>(null),
    [state, setState] = useState<ViewState | null>(null),
    [error, setError] = useState(''),
    [clock, setClock] = useState(0);
  const mounted = useRef(true);
  const loader = useRef<SerializedLoader | null>(null);
  if (!loader.current)
    loader.current = new SerializedLoader(async () => {
      if (obs) {
        const data = await request('/api/overlay' + location.search);
        if (mounted.current) {
          setState(data);
          setClock(data.serverTime - Date.now());
        }
      } else {
        const identity = await request('/api/session');
        const data = identity.user ? await request('/api/state') : null;
        if (mounted.current) {
          setSession(identity);
          setState(data);
          if (data) setClock(data.serverTime - Date.now());
        }
      }
      if (mounted.current)
        setError((previous) => (previous.startsWith('Connection lost.') ? '' : previous));
    });
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await loader.current!.load();
      } catch (e) {
        if (mounted.current) setError('Connection lost. ' + (e as Error).message);
      } finally {
        if (mounted.current) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  return {
    session,
    state,
    error,
    setError,
    clock,
    load: (force = true) => loader.current!.load(force),
  };
}
