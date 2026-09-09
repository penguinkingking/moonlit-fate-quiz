declare global {
  interface Window { __MOONLIT_ART__?: Record<string, string>; }
}

export function artUrl(name: string) {
  if (typeof window !== 'undefined' && window.__MOONLIT_ART__?.[name]) {
    return window.__MOONLIT_ART__[name];
  }
  return `/art/${name}${name.startsWith('characters/') ? '.jpg' : '.png'}`;
}
