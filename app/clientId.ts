export function createClientId() {
  const bytes = new Uint8Array(16);
  const browserCrypto = globalThis.crypto;

  if (browserCrypto && typeof browserCrypto.getRandomValues === "function") {
    browserCrypto.getRandomValues(bytes);
  } else {
    const seed = `${Date.now()}-${Math.random()}-${globalThis.performance?.now() ?? 0}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (seed.charCodeAt(index % seed.length) + Math.floor(Math.random() * 256)) % 256;
    }
  }

  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
