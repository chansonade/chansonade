/// <reference types="vite/client" />

declare module 'verovio/wasm' {
  const createModule: (options?: Record<string, unknown>) => Promise<any>;
  export default createModule;
}
declare module 'verovio/esm' {
  export const VerovioToolkit: new (module: any) => any;
}

declare module 'virtual:local-scores' {
  export type LocalScore = { file: string; title: string; subtitle: string; composer: string; period: string };
  const scores: LocalScore[];
  export default scores;
}
