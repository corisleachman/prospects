// Local test preload. Keep the mail sink in place when Next wraps fetch.
const nativeFetch = globalThis.fetch;
function wrap(fetcher) {
  return (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (new URL(url).hostname === "api.resend.com")
      return nativeFetch("http://127.0.0.1:54329/fixture/resend", {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
    return fetcher(input, init);
  };
}
let current = wrap(nativeFetch);
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get: () => current,
  set: (value) => {
    current = wrap(value);
  },
});
