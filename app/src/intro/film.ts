import * as film from '../screens/IntroSequence';

export type Film = typeof film;

// Phones: Skia is built in, so the sign-up film is ready at once. The web version (film.web.ts) loads Skia's engine first.
export const readyFilm: Film | null = film;
export const loadFilm = () => Promise.resolve(film);
