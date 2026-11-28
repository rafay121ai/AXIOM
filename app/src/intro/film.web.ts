import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { Film } from './film';

// Skia's engine (public/canvaskit.wasm, 8 MB, from `npx setup-skia-web public`) is needed only by the sign-up film, so it
// downloads only when the sign-in screen is shown. Skia captures its engine when first imported: the film is imported after.
export const readyFilm: Film | null = null;
export async function loadFilm(): Promise<Film> {
  await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });
  return import('../screens/IntroSequence');
}
