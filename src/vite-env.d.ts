/// <reference types="vite/client" />

declare module 'verovio/wasm' {
  const createModule: (options?: Record<string, unknown>) => Promise<any>;
  export default createModule;
}
declare module 'verovio/esm' {
  export const VerovioToolkit: new (module: any) => any;
}
