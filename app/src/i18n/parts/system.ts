// Chaînes visibles : system. Voir `../en.ts`.
//
// Couvre les écrans Réglages, Appairage et Activité, le layout racine, la liaison, le
// démarrage, l'environnement (Expo Go), le client HTTP et les notifications (contenu des
// comptes rendus, titres des actions de catégorie). Clés préfixées par domaine.
export const system = {
  // --- Liaison (pastille et Réglages) --------------------------------------------------
  linkConnecting: 'Connecting…',
  linkDirect: 'Direct',
  linkRelayed: 'Relayed',
  linkMacUnreachable: 'Mac unreachable',
  linkOffline: 'Offline',
  /** Erreur du daemon telle quelle, précédée de son code : la cause n'est jamais masquée. */
  linkDaemonError: (code: string, message: string) => `${code}: ${message}`,
  linkPairingRefused: 'Pairing refused, pair again from Settings.',

  // --- Environnement (Expo Go) ---------------------------------------------------------
  pushUnavailable: 'Notifications are unavailable in Expo Go, a build is required.',
  shareExtensionUnavailable:
    'Sharing from other apps requires a build: iOS extensions do not run in Expo Go. The rest of this screen works, including sending to the Mac.',

  // --- Démarrage -----------------------------------------------------------------------
  bootStorageFailed: (seconds: number) =>
    `Startup returned nothing after ${seconds} s. Local storage is not responding.`,

  // --- Layout racine -------------------------------------------------------------------
  layoutRouteErrorTitle: 'Screen error',
  layoutRouteErrorHint: 'This route threw an exception while rendering.',

  // --- Client HTTP ---------------------------------------------------------------------
  httpNotPaired: 'Device not paired',
  httpUnreadableBody: (text: string) => `unreadable response: ${text}`,
  httpStatusOn: (status: number, path: string) => `HTTP ${status} on ${path}`,

  // --- Réglages ------------------------------------------------------------------------
  settingsTitle: 'Settings',
  settingsBack: 'Sessions',
  settingsSectionNotifications: 'NOTIFICATIONS',
  settingsSectionMac: 'MAC',
  settingsSectionSecurity: 'SECURITY',
  settingsSectionActivity: 'ACTIVITY',
  settingsOnlyValidations: 'Validations only',
  settingsOnlyValidationsHint:
    'Only validation requests ring. Task completions stay silent. Off by default.',
  settingsQuietHours: 'Quiet hours',
  settingsQuietHoursHint: '11:00 PM to 7:00 AM. In that window, only validations ring.',
  settingsKeepMacAwake: 'Keep the Mac awake',
  settingsKeepMacAwakeHint:
    'While an agent is working, 4 h max. Lid closed on battery, the session is suspended.',
  settingsFollowOnMac: 'Follow on the Mac',
  settingsFollowOnMacHint:
    'Opening a session here switches the tab on the Mac, like Cmd+P. Turn it off if someone is working on the Mac while you read.',
  settingsRevoke: 'Revoke pairing',
  settingsRevoking: 'Revoking…',
  settingsRevokeConfirmTitle: 'Revoke pairing',
  settingsRevokeConfirmBody:
    'The token is erased from the iPhone and invalidated on the Mac, immediately. The cache and the queue are cleared.',
  settingsRevokeConfirmCancel: 'Cancel',
  settingsRevokeConfirmAction: 'Revoke',
  settingsLink: 'Link',
  settingsLinkLatency: (label: string, ms: number) => `${label} · ${ms} ms`,
  settingsLastNotification: 'Last notification delivered',
  settingsNotificationsToday: 'Notifications today',
  settingsParseFailed: 'Unreadable questions (7 d)',
  settingsNseFailed: 'Banners not fetched (7 d)',
  settingsFileAccessLog: 'File access log',
  settingsVersion: (app: string, daemon: string) => `App ${app} · daemon ${daemon}`,
  settingsVersionUnknown: 'unknown',

  // --- Appairage -----------------------------------------------------------------------
  pairAppName: 'KovaLink',
  pairTagline: 'Drive your Kova sessions from your iPhone.',
  pairStep1: '1. Open Kova on the Mac',
  pairStep2: '2. Kova menu, then KovaLink',
  pairStep3: '3. Scan the QR code',
  pairScanButton: 'Scan the QR code',
  pairManualLink: 'Enter the code by hand',
  pairCameraDeniedTitle: 'Camera denied',
  pairCameraDeniedBody: 'Enter the code by hand, or allow the camera in iOS Settings.',
  pairCancel: 'Cancel',
  pairScanHint: 'Aim at the QR code shown on your Mac',
  pairManualTitle: 'Manual entry',
  pairManualHostPlaceholder: 'macbook-robin.tail1234.ts.net',
  pairManualCodePlaceholder: 'case-sensitive code',
  pairButton: 'Pair',
  pairBackToScan: 'Back to scan',
  pairVerifyTitle: 'Connecting to the Mac',
  pairCodeExpiresIn: (age: string) => `This code expires in ${age}`,
  pairCheckReachable: 'Mac found',
  pairCheckCertificate: 'Certificate valid',
  pairCheckToken: 'Token verified',
  pairCheckNotifications: 'Notifications',
  pairCheckNotificationsUnavailable: 'Notifications (unavailable here)',
  pairRescan: 'Rescan',
  pairCodeExpired: 'This code has expired, generate a new one on the Mac.',
  pairHealthNotOk: 'the Mac answered but /health does not return ok:true',
  pairUnreachable: (url: string, detail: string) => `Mac unreachable at ${url}\n${detail}`,
  pairRefused: (detail: string) => `Pairing refused: ${detail}`,
  pairDefaultDeviceName: 'iPhone',
  pairDoneTitle: 'Paired',
  pairDoneRelayed: 'Relayed connection',
  pairDoneDirect: 'Direct connection',
  pairDoneEverythingElseWorks: 'Everything else works.',
  pairDoneNotificationsDenied:
    'Notifications are not allowed. Without them, you will not know when an agent is done.',
  pairStart: 'Start',

  // --- Activité ------------------------------------------------------------------------
  activityTitle: 'Activity',
  activityBack: 'Back',
  activityTabFiles: 'Files',
  activityTabDiagnostic: 'Diagnostic',
  activityRetry: 'Retry',
  activityRefresh: 'Refresh',
  activityEmptyTitle: 'No file access',
  activityEmptyBody: (days: number) =>
    `The log keeps ${days} days. Nothing was read or written over that period.`,
  activityActionList: 'folder listed',
  activityActionRead: 'file read',
  activityActionText: 'text preview',
  activityActionQuickDests: 'destinations read',
  activityActionUploadInit: 'upload opened',
  activityActionUploadComplete: 'file written',
  activityActionUploadAbort: 'upload cancelled',
  activityDirectionRead: 'Mac → iPhone',
  activityDirectionWrite: 'iPhone → Mac',
  activityResultDenied: 'denied',
  activityResultError: 'error',
  activityDiagParseFailed: 'Prompt parsing failures',
  activityDiagNseFailed: 'Notification Service Extension failures',
  activityDiagLastNotification: 'Last notification delivered',
  activityDiagNone: 'none',
  activityDiagAgo: (age: string) => `${age} ago`,
  activityDiagNotificationsToday: 'Notifications today',
  activityDiagReadToday: 'Read from the Mac today',
  activityDiagWrittenToday: 'Written to the Mac today',

  // --- Notifications -------------------------------------------------------------------
  notifTitle: 'KovaLink',
  notifActionOpen: 'Open',
  notifActionInterrupt: 'Interrupt',
  notifOpenFailed: (cause: string) => `Could not open: ${cause}`,
  notifMacUnreachableOpenApp: 'Mac unreachable, open the app.',
  notifInterrupted: 'Agent interrupted.',
  notifInterruptFailed: (cause: string) => `Could not interrupt: ${cause}`,
  notifOptionLabel: (index: number) => `option ${index}`,
  notifAnswerCancelled: 'Answer cancelled.',
  notifAnswerRefused: (cause: string) => `Answer refused by the Mac: ${cause}`,
  notifAnswerUnreachable: (cause: string) =>
    `Mac unreachable (${cause}). Your answer will be dropped in 60 s.`,
  notifAnswerSent: (index: number) => `Answer sent: option ${index}`,
  notifPromptChanged: 'The question changed, your answer was not sent. Open the app.',
  notifAlreadyAnswered: 'Already answered.',
} as const;
