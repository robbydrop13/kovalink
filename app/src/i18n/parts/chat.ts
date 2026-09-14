// Chaînes visibles : chat, actions, transferts. Voir `../en.ts`.
export const chat = {
  // Actions partagées entre écrans.
  voiceButton: 'Dictate',
  voiceRecording: 'Recording…',
  voiceCancelled: 'Recording cancelled',
  voiceCancelA11y: 'Cancel recording',
  voiceStopA11y: 'Stop recording',
  voiceSendA11y: 'Send recording',
  voiceRecordingA11y: (seconds: number) => `Recording, ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`,
  voiceTranscribing: 'Transcribing…',
  voiceNeedsBuild: 'Voice input arrives with the next app build (microphone module missing in this one)',
  voicePermissionDenied: 'Microphone access refused. Enable it in Settings for KovaLink.',
  voiceTooLong: 'Recording too long (over 10 MB). Keep it under a couple of minutes.',
  voiceTooShort: 'Too short, talk a little longer before stopping',
  voiceEmpty: 'Nothing was recognized',
  voiceFailed: (cause: string) => `Transcription failed. ${cause}`,
  chatThinking: 'Thinking…',
  chatRunningTool: (tool: string) => `Running ${tool}…`,
  systemLabel: 'System',
  systemEvents: (n: number) => (n === 1 ? '1 system event' : `${n} system events`),
  systemShowRaw: 'Show raw content',
  actionCancel: 'Cancel',
  actionRetry: 'Retry',
  actionSend: 'Send',
  actionDismiss: 'Dismiss',
  /** Pastille flottante du fil : du nouveau est arrivé en bas pendant que Robin lisait plus haut. */
  chatJumpLatest: 'Latest',
  chatJumpLatestA11y: 'Scroll to the latest messages',

  // Bandeau d'état de la session (`AgentStatus`, `statusLabel`).
  statusA11y: (label: string) => `Agent status: ${label}`,
  statusClosed: 'Session closed',
  statusOffline: 'Offline, state frozen',
  statusAwaiting: 'Waiting for you',
  statusWorking: 'Working',
  statusWorkingFor: (elapsed: string) => `Working · ${elapsed}`,
  statusDoneAgo: (age: string) => `Done ${age} ago`,
  statusIdle: 'Idle',
  statusStarting: 'Starting Claude',
  /** Durée compacte du bandeau : `1m 12s`, `45s`. */
  statusElapsed: (minutes: number, seconds: number) => (minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`),

  // Verbes des lignes d'action (`toolLabel`).
  toolLabelRead: 'Reads',
  toolLabelWrite: 'Writes',
  toolLabelEdit: 'Edits',
  toolLabelRun: 'Runs',
  toolLabelSearch: 'Searches',
  toolLabelList: 'Lists',
  toolLabelFetch: 'Fetches',
  toolLabelLookUp: 'Looks up',
  toolLabelDelegate: 'Delegates',
  toolLabelPlan: 'Plans',
  toolLabelApply: 'Applies',

  // Ligne d'action (`ToolRow`).
  toolStateRunning: 'running',
  toolStateDone: 'done',
  toolStateFailed: 'failed',
  toolStateUnknown: 'no result',
  toolRowA11y: (verb: string, target: string, state: string) => `${verb} ${target}, ${state}`,
  toolRowMoreLines: (n: number) => `${n} more lines, visible on the Mac`,
  toolRowTruncated: 'Full result not retrievable, see it on the Mac.',
  toolRowNoOutput: 'No output.',

  // Groupe d'actions (`ToolGroup`).
  toolGroupCount: (n: number) => `${n} actions`,
  toolGroupCollapse: 'collapse',
  toolGroupProgress: (done: number, total: number) => `${done} of ${total} done`,
  toolGroupFailedCount: (n: number) => `${n} failed`,
  toolGroupDone: 'done',
  toolGroupA11y: (count: string, detail: string) => `${count}, ${detail}`,

  // Bulles (`Bubble`).
  bubbleResend: 'resend',
  bubbleResendA11y: 'Failed, resend',
  bubbleThinking: 'Thinking',
  bubbleCopy: 'Copy',
  bubbleShare: 'Share',
  bubbleCopied: 'Copied',
  bubbleLongPressHint: 'Long press to copy or share',
  bubbleStreamingA11y: 'the agent is typing',

  // Rendu Markdown.
  markdownCodeLang: 'code',
  markdownCopy: 'Copy',
  markdownCopyA11y: 'Copy this code block',

  // Zone de saisie (`Composer`).
  composerPlaceholder: 'Send message',
  composerCommandsA11y: 'Slash commands',
  composerCommandHint: (name: string) => `Insert /${name}`,
  composerLockedPlaceholder: 'Answer the question above first',
  composerUnavailable: 'Unavailable',
  composerFaceIdPlaceholder: 'Free text, Face ID required',
  composerOfflinePlaceholder: 'Sent when reconnected',
  composerSendFailed: (cause: string) => `Could not send. ${cause}`,
  composerQueued: (n: number) => (n === 1 ? '1 message queued' : `${n} messages queued`),
  composerFieldA11y: 'Message to send',
  composerInterrupt: 'Stop',
  composerSending: 'Sending',

  // Pièces jointes (`AttachmentViews`, `attachments`, `actions/attachments`).
  attachmentAdd: 'Add an attachment',
  attachmentSourcePhotos: 'Photos',
  attachmentSourceCamera: 'Camera',
  attachmentSourceFiles: 'Files',
  attachmentCellularTitle: 'Send over cellular',
  attachmentCellularBody: (size: string) => `${size} of attachments would go over cellular. Send now?`,
  attachmentArrived: 'arrived',
  attachmentHashing: 'hashing…',
  attachmentResuming: 'resuming…',
  attachmentPercent: (n: number) => `${n}%`,
  attachmentRemoveA11y: (name: string) => `Remove ${name}`,
  attachmentPhoto: 'photo',
  attachmentMissing: (n: number, names: string) =>
    `${n === 1 ? 'one attachment has not arrived' : `${n} attachments have not arrived`} on the Mac: ${names}`,
  attachmentDestLabel: 'Chat attachment',
  attachmentNoDestDir: 'destination folder unknown',
  attachmentError: (name: string, message: string) => `${name}: ${message}`,

  // File des textes en attente (`StaleQueue`).
  staleQuote: (text: string) => `“${text}”`,
  staleAttachments: (n: number) => (n === 1 ? '1 attachment' : `${n} attachments`),
  staleOne: 'This message has been waiting for over 15 min. Send it anyway?',
  staleMany: (n: number) => `${n} messages have been waiting for over 15 min. Send them anyway?`,
  staleDiscard: 'Discard',

  // Envoi de texte et vidange de la file (`sendText`, `outboxRunner`).
  faceIdSendFreeText: 'Send a free-text reply',
  refusedCause: (code: string, message: string) => `${code}: ${message}`,
  outboxNotApplied: (reason: string) => `not applied: ${reason}`,
  outboxUnknownReason: 'unknown reason',

  // File de transferts (`store/transfers`).
  transferChecksumMismatch: (written: string, expected: string) =>
    `Checksum mismatch: ${written} written on the Mac, ${expected} expected.`,
  transferCanceled: 'transfer canceled',
  transferFailed: 'transfer failed',
  transferMissing: (id: string) => `transfer ${id} not in the queue`,
  transferRemoved: (id: string) => `transfer ${id} removed from the queue before finishing`,
} as const;
