import { describe, it, expect, vi } from 'vitest';

function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  const focusable = () => Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => el.offsetParent !== null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onEscape(); return; }
    if (e.key !== 'Tab') return;
    const els = focusable();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

describe('trapFocus', () => {
  it('calls onEscape when Escape is pressed', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button>B1</button><button>B2</button>';
    document.body.appendChild(container);
    const onEscape = vi.fn();
    const cleanup = trapFocus(container, onEscape);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onEscape).toHaveBeenCalledTimes(1);
    cleanup();
    document.body.removeChild(container);
  });

  it('cleanup removes the keydown listener', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onEscape = vi.fn();
    const cleanup = trapFocus(container, onEscape);
    cleanup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onEscape).not.toHaveBeenCalled();
    document.body.removeChild(container);
  });

  it('is idempotent — calling cleanup twice does not throw', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const cleanup = trapFocus(container, vi.fn());
    expect(() => { cleanup(); cleanup(); }).not.toThrow();
    document.body.removeChild(container);
  });
});
