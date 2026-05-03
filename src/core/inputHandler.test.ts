import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCurrentInput, getInputText, setInputText } from './inputHandler';

describe('getCurrentInput', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('returns null when no input present', () => {
    expect(getCurrentInput()).toBeNull();
  });

  it('returns #prompt-textarea when present (ChatGPT)', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    document.body.appendChild(ta);
    expect(getCurrentInput()).toBe(ta);
  });

  it('returns contenteditable div when present (Claude/Gemini)', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(getCurrentInput()).toBe(div);
  });

  it('prefers #prompt-textarea over contenteditable', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    document.body.appendChild(ta);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(getCurrentInput()).toBe(ta);
  });
});

describe('getInputText', () => {
  it('reads value from textarea', () => {
    const ta = document.createElement('textarea');
    ta.value = 'hello';
    expect(getInputText(ta)).toBe('hello');
  });

  it('reads innerText from contenteditable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.innerText = 'world';
    expect(getInputText(div)).toBe('world');
  });
});

describe('setInputText', () => {
  it('sets value on textarea and fires input event', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const fired: Event[] = [];
    ta.addEventListener('input', e => fired.push(e));
    setInputText(ta, 'new text');
    expect(ta.value).toBe('new text');
    expect(fired.length).toBeGreaterThan(0);
  });

  it('focuses the input after setting text', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const focusSpy = vi.spyOn(ta, 'focus');
    setInputText(ta, 'test');
    expect(focusSpy).toHaveBeenCalled();
  });
});
