import * as ExpoCrypto from 'expo-crypto';

/**
 * Install the WebCrypto surfaces Supabase Auth needs for PKCE S256 on Hermes.
 * Only getRandomValues + subtle.digest(SHA-*) — not a full WebCrypto implementation.
 * Must run before createClient() so auth-js never falls back to plain challenges.
 */

const DIGEST_ALGORITHMS = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);

function digestAlgorithmName(algorithm) {
  if (typeof algorithm === 'string') {
    return algorithm;
  }
  if (algorithm && typeof algorithm.name === 'string') {
    return algorithm.name;
  }
  throw new TypeError('Unsupported digest algorithm');
}

function toBufferSource(data) {
  if (data == null) {
    throw new TypeError('digest data is required');
  }
  if (ArrayBuffer.isView(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new TypeError('digest data must be a BufferSource');
}

export function inspectPkceWebCrypto(cryptoLike = globalThis.crypto) {
  return {
    hasCrypto: typeof cryptoLike !== 'undefined' && cryptoLike != null,
    hasGetRandomValues: typeof cryptoLike?.getRandomValues === 'function',
    hasSubtleDigest: typeof cryptoLike?.subtle?.digest === 'function',
    hasTextEncoder: typeof TextEncoder !== 'undefined',
    hasBtoa: typeof globalThis.btoa === 'function',
  };
}

export function ensurePkceWebCrypto() {
  const current = inspectPkceWebCrypto();
  if (current.hasGetRandomValues && current.hasSubtleDigest) {
    return { installed: false, ...current };
  }

  const previous = globalThis.crypto && typeof globalThis.crypto === 'object'
    ? globalThis.crypto
    : {};

  const getRandomValues = (typedArray) => ExpoCrypto.getRandomValues(typedArray);

  const digest = async (algorithm, data) => {
    const name = digestAlgorithmName(algorithm);
    if (!DIGEST_ALGORITHMS.has(name)) {
      throw new Error(`Digest algorithm not supported: ${name}`);
    }
    return ExpoCrypto.digest(name, toBufferSource(data));
  };

  globalThis.crypto = {
    ...previous,
    getRandomValues,
    randomUUID: typeof previous.randomUUID === 'function'
      ? previous.randomUUID.bind(previous)
      : () => ExpoCrypto.randomUUID(),
    subtle: {
      ...(previous.subtle && typeof previous.subtle === 'object' ? previous.subtle : {}),
      digest,
    },
  };

  const next = inspectPkceWebCrypto();
  if (!next.hasGetRandomValues || !next.hasSubtleDigest || !next.hasTextEncoder) {
    throw new Error('PKCE S256 WebCrypto surfaces are unavailable');
  }
  return { installed: true, ...next };
}

/**
 * Prove subtle.digest returns a digest distinct from the verifier (S256 path).
 * Does not log secrets.
 */
export async function assertPkceS256DigestWorks() {
  ensurePkceWebCrypto();
  const sample = 'seenzo-pkce-s256-probe';
  const encoded = new TextEncoder().encode(sample);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  if (!(hash instanceof ArrayBuffer) || hash.byteLength < 16) {
    throw new Error('PKCE S256 digest produced an invalid result');
  }
  return true;
}

ensurePkceWebCrypto();
