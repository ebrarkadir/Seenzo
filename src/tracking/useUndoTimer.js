import { useEffect } from 'react';

import { useTracking } from './TrackingContext';

export function useUndoTimer() {
  const { undo, dismissUndo } = useTracking();

  useEffect(() => {
    if (!undo) {
      return undefined;
    }
    const timer = setTimeout(dismissUndo, 6000);
    return () => clearTimeout(timer);
  }, [dismissUndo, undo]);
}
