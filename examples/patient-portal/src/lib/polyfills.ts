// Web Crypto + sessionStorage polyfills for React Native / Hermes.
//
// @medplum/core assumes a browser environment in two places that matter to us:
//   1. crypto.subtle.digest (SHA-256) — used by the PKCE code-challenge helper.
//   2. sessionStorage           — processCode() reads the PKCE 'codeVerifier' from it.
// `react-native-get-random-values` (imported in index.ts before this file) already
// installs crypto.getRandomValues; here we fill the remaining gaps.
import * as ExpoCrypto from 'expo-crypto';

type AnyCrypto = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  subtle?: { digest: (algorithm: unknown, data: BufferSource) => Promise<ArrayBuffer> };
};

const g = globalThis as unknown as { crypto?: AnyCrypto; sessionStorage?: Storage };

// --- crypto.subtle.digest (SHA-256 / SHA-1 / SHA-512) ----------------------------
if (g.crypto && !g.crypto.subtle) {
  const algoMap: Record<string, ExpoCrypto.CryptoDigestAlgorithm> = {
    'SHA-1': ExpoCrypto.CryptoDigestAlgorithm.SHA1,
    'SHA-256': ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    'SHA-384': ExpoCrypto.CryptoDigestAlgorithm.SHA384,
    'SHA-512': ExpoCrypto.CryptoDigestAlgorithm.SHA512,
  };
  g.crypto.subtle = {
    digest: async (algorithm: unknown, data: BufferSource): Promise<ArrayBuffer> => {
      const name = typeof algorithm === 'string' ? algorithm : (algorithm as { name: string }).name;
      const algo = algoMap[name];
      if (!algo) {
        throw new Error(`Unsupported digest algorithm: ${name}`);
      }
      const source = data instanceof ArrayBuffer ? data : ((data as ArrayBufferView).buffer as ArrayBuffer);
      return ExpoCrypto.digest(algo, new Uint8Array(source));
    },
  };
}

// --- sessionStorage shim ---------------------------------------------------------
// Native has no sessionStorage. We only need an in-memory store so the PKCE
// 'codeVerifier' that we set in auth.ts survives until processCode() reads it.
if (typeof g.sessionStorage === 'undefined') {
  const data = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  };
  g.sessionStorage = memory;
}
