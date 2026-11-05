// What the Android back button does on each screen. 'stay' swallows the press so a founder is never dropped out of
// the app mid-journey (and the care screen is never escaped into it); 'exit' is the normal leave, on home only.
export type BackTarget<S> = S | 'stay' | 'exit';

type Back = { name: string; back?: unknown };

export function backTarget<S extends Back>(stage: S, home: S, settings: S, history: S): BackTarget<S> {
  switch (stage.name) {
    case 'home': return 'exit';
    case 'history':
    case 'settings': return home;
    case 'past': return history;
    case 'answers': return settings;
    case 'move': return stage.back as S;
    default: return 'stay';
  }
}
