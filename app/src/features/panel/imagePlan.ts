// Les images d'une option de fiche : celles a montrer, et une note pour chaque image
// laissee de cote. Pur, teste sous Node. Memes regles que Kova (`images_html`) : deux au
// plus, un chemin absolu, une extension d'image. Le poids et l'acces se verifient a la
// lecture (`fileSize`), seul le daemon les connait.
import { SHEET_IMAGES_MAX, SHEET_IMAGE_EXTENSIONS, type SheetImage } from '@/protocol';
import { t } from '@/i18n/en';

export interface ImagePlan {
  shown: SheetImage[];
  notes: string[];
}

/** Le nom d'une image dans une note : son libelle, sinon son chemin. */
export function imageName(image: SheetImage): string {
  return image.label.trim() || image.path || 'image';
}

/**
 * Un daemon anterieur aux images transmet la fiche telle quelle : une entree mal formee
 * devient une image sans chemin, que la fiche dit non affichee, au lieu de la faire planter.
 */
function asImage(raw: unknown): SheetImage {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    label: typeof r['label'] === 'string' ? r['label'] : '',
    path: typeof r['path'] === 'string' ? r['path'] : '',
  };
}

export function planImages(images: readonly SheetImage[] | undefined): ImagePlan {
  const shown: SheetImage[] = [];
  const notes: string[] = [];
  const list = Array.isArray(images) ? images : [];
  for (const raw of list.slice(0, SHEET_IMAGES_MAX)) {
    // L'objet d'origine quand il est bien forme : son identite garde l'image chargee.
    const image = typeof raw?.label === 'string' && typeof raw?.path === 'string' ? raw : asImage(raw);
    const ext = image.path.split('.').pop()?.toLowerCase() ?? '';
    if (!image.path.startsWith('/')) notes.push(t.panelSheetImageNotShown(imageName(image), t.panelSheetImageNotAbsolute));
    else if (!SHEET_IMAGE_EXTENSIONS.includes(ext)) notes.push(t.panelSheetImageNotShown(imageName(image), t.panelSheetImageType));
    else shown.push(image);
  }
  if (list.length > SHEET_IMAGES_MAX) notes.push(t.panelSheetImagesExtra(list.length - SHEET_IMAGES_MAX, SHEET_IMAGES_MAX));
  return { shown, notes };
}
