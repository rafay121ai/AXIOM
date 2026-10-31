// Phones: Skia is built in, so the app starts at once. The web version (boot.web.ts) loads Skia's engine first.
export function boot(start: () => void) {
  start();
}
