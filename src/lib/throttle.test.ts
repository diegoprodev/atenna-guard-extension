import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttleLeadingEdge } from './throttle';

describe('throttleLeadingEdge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls function immediately on first invocation (leading edge)', () => {
    const mockFn = vi.fn();
    const throttled = throttleLeadingEdge(mockFn, 150);

    throttled();

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('ignores calls within throttle window', () => {
    const mockFn = vi.fn();
    const throttled = throttleLeadingEdge(mockFn, 150);

    throttled();
    throttled();
    throttled();

    expect(mockFn).toHaveBeenCalledTimes(1);

    // Advance within window
    vi.advanceTimersByTime(50);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('calls function once after throttle window expires (trailing edge)', () => {
    const mockFn = vi.fn();
    const throttled = throttleLeadingEdge(mockFn, 150);

    throttled();
    throttled();
    throttled();

    // Advance past throttle window
    vi.advanceTimersByTime(150);

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('resets throttle after window expires', () => {
    const mockFn = vi.fn();
    const throttled = throttleLeadingEdge(mockFn, 150);

    throttled();
    expect(mockFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(150);

    // Now within new throttle window
    throttled();
    expect(mockFn).toHaveBeenCalledTimes(2);

    // Should not call again within new window
    throttled();
    throttled();
    expect(mockFn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(150);
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('passes arguments to the throttled function', () => {
    const mockFn = vi.fn();
    const throttled = throttleLeadingEdge(mockFn, 150);

    const arg1 = { test: true };
    const arg2 = 'test';

    throttled(arg1, arg2);

    expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
  });

  it('throttles with 150ms default behavior', () => {
    const mockFn = vi.fn();
    const throttled = throttleLeadingEdge(mockFn, 150);

    // Call 10 times rapidly
    for (let i = 0; i < 10; i++) {
      throttled();
    }

    // Should only execute once at leading edge
    expect(mockFn).toHaveBeenCalledTimes(1);

    // Advance to middle of window
    vi.advanceTimersByTime(75);
    expect(mockFn).toHaveBeenCalledTimes(1);

    // Advance past throttle window
    vi.advanceTimersByTime(75);
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
