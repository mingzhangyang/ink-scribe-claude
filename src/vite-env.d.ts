/// <reference types="vite/client" />

/** Type-safe declarations for Vite asset URLs loaded through dynamic import(). */
declare module "*?url" {
  const url: string;
  export default url;
}

/** The app reads this Vite-defined base path when resolving pdf.js CMap assets. */
interface ImportMetaEnv {
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
