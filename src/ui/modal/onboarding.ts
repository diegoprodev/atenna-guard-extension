const PRO_WELCOME_KEY = 'atenna_pro_welcome_pending';

export async function setProWelcomeFlag(): Promise<void> {
  await new Promise<void>(r => chrome.storage.local.set({ [PRO_WELCOME_KEY]: true }, r));
}

export async function consumeProWelcome(): Promise<boolean> {
  const val = await new Promise<boolean>(r =>
    chrome.storage.local.get(PRO_WELCOME_KEY, res => r(!!res[PRO_WELCOME_KEY]))
  );
  if (val) await new Promise<void>(r => chrome.storage.local.remove(PRO_WELCOME_KEY, r));
  return val;
}

export async function resolveWelcomeState(
  upgradedToPro: boolean,
): Promise<{ showWelcome: boolean }> {
  const showWelcome = upgradedToPro || (await consumeProWelcome());
  if (upgradedToPro) await consumeProWelcome();
  return { showWelcome };
}
