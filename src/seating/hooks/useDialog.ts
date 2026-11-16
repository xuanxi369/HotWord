import { useEffect, useRef } from 'react';

export function useDialog(onClose: () => void) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      );
    const focus = requestAnimationFrame(() => {
      if (!element.contains(document.activeElement)) {
        const initial = element.querySelector<HTMLElement>(
          '[data-dialog-autofocus]:not(:disabled)',
        );
        (initial || controls()[0])?.focus();
      }
    });
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = controls(),
        first = items[0],
        last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener('keydown', handle);
    return () => {
      cancelAnimationFrame(focus);
      element.removeEventListener('keydown', handle);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return dialog;
}
