// Toutes les chaînes visibles de l'app, en anglais, en un seul module (décision du 12
// septembre : « aucun mot français dans l'interface »). Les composants importent `t` et
// n'écrivent jamais une chaîne visible en dur. Les chaînes paramétrées sont des fonctions.
// Les commentaires de code restent en français : c'est le code, pas l'interface.
//
// Les parties sont découpées par écran pour rester lisibles ; `t` est l'objet fusionné,
// et `scripts/check-i18n.sh` échoue si du français subsiste hors de ce dossier.
import { asks } from './parts/asks';
import { browser } from './parts/browser';
import { chat } from './parts/chat';
import { files } from './parts/files';
import { panel } from './parts/panel';
import { sessions } from './parts/sessions';
import { system } from './parts/system';

export const t = { ...sessions, ...chat, ...files, ...browser, ...asks, ...panel, ...system } as const;
export type Strings = typeof t;
