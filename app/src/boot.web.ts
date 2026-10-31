import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

// Skia captures its engine when first imported, so the app (which imports Skia) is required only after it has loaded.
// public/canvaskit.wasm comes from `npx setup-skia-web public`.
export function boot(start: () => void) {
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(start);
}
