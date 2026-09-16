// « Lu » remonte au Mac (docs/16) : le pane que Robin vient de lire sur l'iPhone cesse de
// tirer la pastille Next du Mac, exactement comme s'il l'avait lu devant l'ecran. Decision
// pure, testee sous Node : l'emetteur est injecte, comme « Suivre sur le Mac » (`follow.ts`).
//
// MUET PAR CONSTRUCTION : aucun toast, aucune reprise, aucun etat. La marque de lecture
// locale est posee de toute facon et c'est elle qui eteint la pastille du telephone ; ceci
// n'en est que l'echo vers le Mac. Un daemon injoignable, un Kova trop ancien ou un pane
// deja ferme ne doivent jamais interrompre une lecture.
export type PaneReadSender = (paneId: number) => Promise<unknown>;

/** Un envoi, au plus. Ni la promesse rejetee ni l'emetteur qui leve ne ressortent d'ici. */
export function markPaneReadOnMac(paneId: number, send: PaneReadSender): void {
  try {
    void send(paneId).catch(() => undefined);
  } catch {
    // Un emetteur qui leve AVANT de rendre sa promesse (pas d'appairage, URL absente) est
    // le meme non evenement qu'un rejet : la lecture continue.
  }
}
