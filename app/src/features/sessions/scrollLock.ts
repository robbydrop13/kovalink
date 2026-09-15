// Le verrou du défilement de la liste pendant un glisser-déposer, hors React. Plusieurs
// listes le partagent (les onglets, et les panes de chaque onglet) : chacune le prend en
// son nom et ne rend que le sien. Le défilement n'est coupé que tant qu'au moins une liste
// le tient, et `releaseAll` le rend quoi qu'il arrive (aucun geste en cours à l'écran).
// Module pur, testé sous Node.

export interface ScrollLock {
  /** Prendre (`true`) ou rendre (`false`) le verrou au nom de `owner`. Idempotent. */
  set: (owner: object, locked: boolean) => void;
  /** Tout rendre : filet de sécurité quand plus aucun geste n'est en cours. */
  releaseAll: () => void;
  locked: () => boolean;
}

/** `apply` reçoit l'état du défilement coupé, seulement quand il change. */
export function createScrollLock(apply: (locked: boolean) => void): ScrollLock {
  const owners = new Set<object>();
  let applied = false;
  const sync = () => {
    const next = owners.size > 0;
    if (next === applied) return;
    applied = next;
    apply(next);
  };
  return {
    set: (owner, locked) => {
      if (locked) owners.add(owner);
      else owners.delete(owner);
      sync();
    },
    releaseAll: () => {
      owners.clear();
      sync();
    },
    locked: () => applied,
  };
}
