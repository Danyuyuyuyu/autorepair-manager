/** Web Crypto 生成跨设备唯一 ID；不依赖 Node crypto。 */
export function newMobileId(): string {
  const entropy = new Uint8Array(8);
  globalThis.crypto.getRandomValues(entropy);
  const random = Array.from(entropy, (value) => value.toString(16).padStart(2, "0")).join("");
  return `c${Date.now().toString(36)}${random}`;
}
