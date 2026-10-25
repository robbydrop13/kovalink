// Chaînes visibles : les questions des agents (`kova ask`). Voir `../en.ts`.
//
// Vocabulaire : « question », jamais « prompt », qui désigne dans cette app la validation
// lue sur l'écran du Mac. Les deux coexistent et ne se répondent pas de la même façon.
export const asks = {
  askBanner: (n: number) => (n === 1 ? '1 agent is waiting for an answer' : `${n} agents are waiting for an answer`),
  askBannerAction: 'Answer',
  askTitle: 'Agent question',
  askFrom: (from: string) => `${from} asks`,
  askMore: (n: number) => (n === 1 ? '1 more question' : `${n} more questions`),
  askPlaceholder: 'Type an answer, or just pick a button',
  askCopy: 'Copy',
  askCopied: 'Copied',
  askLater: 'Later',
  askLaterFor: (label: string) => `Later, in ${label}`,
  askSnoozedUntil: (time: string) => `Put off until ${time}`,
  /** L'agent a cessé d'attendre sur la socket : la réponse lui sera portée par Kova. */
  askNotWaiting:
    'The agent stopped waiting. Your answer will be delivered to its conversation on the Mac, which takes a little longer.',
  askSending: 'Sending…',
  askGoneTitle: 'Nothing left to answer',
  askGoneBody: 'This question is no longer waiting: it was answered on the Mac, or Kova restarted.',
  askUnsupportedTitle: 'Questions are unavailable',
  askUnsupportedBody: 'The Kova running on the Mac does not know about agent questions yet. Relaunch it after an update.',
  askFailed: (cause: string) => `Not sent. ${cause}`,
  askOffline: 'No answer can be sent while the Mac is unreachable.',
} as const;
