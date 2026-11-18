// Chaînes visibles : le Cockpit, la file d'attention de Robin telle que Kova la montre sur
// le Mac. Voir `../en.ts`. Exception assumée à « aucun mot français » (comme les lignes
// `attn*` de `asks.ts`) : ce sont les mots du Cockpit de Kova, au caractère près, pour
// que le téléphone et le Mac disent la même chose (`kova/src/cockpit.rs`).
export const cockpit = {
  cockpitTitle: 'Cockpit',
  cockpitSubtitle: (n: number, urgent: number) => {
    const lead = n === 0 ? 'Aucune action pour toi' : n === 1 ? '1 action pour toi' : `${n} actions pour toi`;
    const tail = urgent === 0 ? '' : urgent === 1 ? ' · 1 urgente' : ` · ${urgent} urgentes`;
    return `${lead}${tail}`;
  },
  cockpitSectionUrgent: 'Urgent',
  cockpitSectionToday: "Aujourd'hui",
  cockpitSectionWeek: 'Cette semaine',
  cockpitFilterAll: 'Tout',
  cockpitScopeClaap: 'Claap',
  cockpitScopePerso: 'Perso',
  cockpitFilterA11y: (name: string, n: number) => `${name}, ${n}`,
  cockpitMore: (n: number) => `Voir plus (${n})`,
  cockpitEmpty: "Rien ne t'attend ici",
  cockpitNeedsLine: (n: number) => `Cockpit · ${n}`,

  // L'âge d'une carte, comme `cockpit::age`.
  cockpitAgeNow: "à l'instant",
  cockpitAgeMin: (n: number) => `il y a ${n} min`,
  cockpitAgeHours: (n: number) => `il y a ${n} h`,
  cockpitAgeYesterday: 'hier',
  cockpitAgeDays: (n: number) => `il y a ${n} j`,

  // Boutons et icônes (`Button::label`).
  cockpitOpen: 'Voir',
  cockpitDecide: 'Décider',
  cockpitBrief: 'Brief',
  cockpitTest: 'Tester',
  cockpitRespond: 'Répondre',
  cockpitSeen: 'Vu',
  cockpitSeenHint: 'Ranger la carte, sans go ni no go',
  cockpitGo: 'Go',
  cockpitGoSend: 'Go, envoyer',
  cockpitNoGo: 'No go',
  cockpitAsk: 'Demander',
  cockpitAskHint: 'Écris ta question pour demander',
  cockpitLeft: "C'est parti",
  cockpitResend: 'Renvoyer',
  cockpitSnooze: 'Plus tard',
  cockpitDismiss: 'Pas pertinent, retirer',
  cockpitDone: "C'est fait",
  cockpitCancelAsk: 'Annuler ma demande',

  // Une carte ouverte.
  cockpitReplyOn: 'Ta réponse sur ',
  cockpitReplyPlaceholder: 'Ton commentaire (facultatif), ou ta question',
  cockpitWaitingAgent: "Attend l'agent",
  cockpitUncertain: (why: string) => `Peut-être parti : ${why}`,
  cockpitFailed: (why: string) => `Échec : ${why}`,
  cockpitProof: (proof: string) => `Preuve : ${proof}`,
  cockpitDraftTo: (to: string) => `À ${to}`,
  cockpitDraftSubject: (subject: string) => `Objet ${subject}`,
  cockpitDraftEditable: 'Modifiable',
  cockpitDraftModified: 'Modifié par toi',
  cockpitDraftRestore: 'Rétablir le brouillon',
  cockpitBefore: 'Avant',
  cockpitAfter: 'Après',
  cockpitShotUnreadable: (path: string) => `Image illisible : ${path}`,
  cockpitRunning: 'En cours…',

  // Les toasts (`cockpit::Toast`).
  cockpitToastGo: 'Go noté',
  cockpitToastNoGo: 'No go noté',
  cockpitToastSeen: 'Vu : carte rangée',
  cockpitToastDone: 'Fait : carte rangée',
  cockpitToastDismiss: 'Carte écartée',
  cockpitToastSnooze: 'Carte reportée',
  cockpitToastAsk: 'Demande envoyée',
  cockpitToastCancel: 'Demande annulée',
  cockpitToastLeft: "C'est parti noté",
  cockpitToastResend: 'Renvoi noté',
  cockpitToastTextLeft: (text: string) => `Ton texte, parti avec : ${text}`,
  cockpitToastFailed: 'Non transmis',
  cockpitToastTextKept: ' Ton texte est resté sur la carte.',
  cockpitToastUnknown: 'Envoi non confirmé',
  cockpitToastUnknownMore: "Vérifie sur le Mac avant de recommencer : le geste est peut-être arrivé.",
  cockpitToastClose: 'Fermer',

  // Les raisons d'un refus que le daemon ne formule pas lui-même.
  cockpitCardChanged: "la carte a changé depuis son affichage, relis-la : rien n'est noté ni fermé",
  cockpitNotOffered: "ce geste n'est plus offert sur cette carte",
  cockpitGone: "la carte n'est plus dans la file",
  cockpitBusy: 'un geste est déjà en cours sur cette carte',

  // Le report (`Plus tard`).
  cockpitSnoozeHour: 'Dans 1 h',
  cockpitSnoozeEvening: 'Ce soir',
  cockpitSnoozeMorning: 'Demain matin',
  cockpitSnoozeMonday: 'Lundi prochain',
  cockpitSnoozeCancel: 'Annuler',
} as const;
