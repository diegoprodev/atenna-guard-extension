import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectButton, removeButton } from './injectButton';
import type { PlatformConfig } from './detectInput';

const chatgpt: PlatformConfig = {
  name: 'ChatGPT',
  inputSelector: '#prompt-textarea',
};

describe('injectButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="parent"><textarea id="prompt-textarea"></textarea></div>';
  });

  it('injects .atenna-btn into the input parent', () => {
    injectButton(chatgpt, () => {});
    expect(document.querySelector('.atenna-btn')).not.toBeNull();
  });

  it('does not inject twice (idempotent)', () => {
    injectButton(chatgpt, () => {});
    injectButton(chatgpt, () => {});
    expect(document.querySelectorAll('.atenna-btn').length).toBe(1);
  });

  it('sets padding-top on parent container', () => {
    injectButton(chatgpt, () => {});
    const parent = document.getElementById('parent') as HTMLElement;
    expect(parent.style.paddingTop).toBe('30px');
  });

  it('sets position relative if container is static', () => {
    injectButton(chatgpt, () => {});
    const parent = document.getElementById('parent') as HTMLElement;
    expect(parent.style.position).toBe('relative');
  });

  it('button text is "Atenna Guard Prompt"', () => {
    injectButton(chatgpt, () => {});
    const btn = document.querySelector('.atenna-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Atenna Guard Prompt');
  });

  it('calls onToggle when button is clicked', () => {
    const toggle = vi.fn();
    injectButton(chatgpt, toggle);
    (document.querySelector('.atenna-btn') as HTMLButtonElement).click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('does nothing if input selector matches nothing', () => {
    document.body.innerHTML = '<div></div>';
    injectButton(chatgpt, () => {});
    expect(document.querySelector('.atenna-btn')).toBeNull();
  });
});

describe('removeButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="parent"><textarea id="prompt-textarea"></textarea></div>';
  });

  it('removes injected button', () => {
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    expect(document.querySelector('.atenna-btn')).toBeNull();
  });

  it('resets padding-top after removal', () => {
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    const parent = document.getElementById('parent') as HTMLElement;
    expect(parent.style.paddingTop).toBe('');
  });
});
