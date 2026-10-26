import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { focusDefault, focusElement } from '../lib/navigation/focus';

/** Stack of open overlays; Back closes the topmost one. */
const stack: (() => void)[] = [];

export function closeTopDialog(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra buttons placed before Close. */
  actions?: ReactNode;
  wide?: boolean;
};

export function Dialog({ title, onClose, children, actions, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const close = () => closeRef.current();
    stack.push(close);
    return () => {
      const i = stack.lastIndexOf(close);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);

  // Remember what had focus and return to it when the dialog closes.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    focusDefault(ref.current);
    return () => {
      if (previous && document.contains(previous)) focusElement(previous);
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div className={`dialog${wide ? ' dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} data-nav-scope ref={ref}>
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {actions}
          <button type="button" className="btn" onClick={onClose} data-autofocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
