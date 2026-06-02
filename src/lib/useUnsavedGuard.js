import { useEffect, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';

export function useUnsavedGuard(dirty) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    const handler = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirm = useCallback(() => {
    if (blocker.state === 'blocked') blocker.proceed();
  }, [blocker]);

  const cancel = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);

  return { blocked: blocker.state === 'blocked', confirm, cancel };
}
