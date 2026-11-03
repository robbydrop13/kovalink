import Foundation
import WatchConnectivity
import WidgetKit

/// Le seul canal de la montre : l'iPhone, par WatchConnectivity. L'iPhone relaie au daemon.
///
/// Message envoyé : `kind=send`, `session`, `text`, `nonce`. Réponse : `ok`, puis `session`
/// (le nom résolu) ou `error` (une phrase lisible, déjà rédigée par l'iPhone).
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    /// Une seule instance, et c'est elle qui porte le délégué `WCSession` : elle doit vivre
    /// dès le lancement du processus, y compris quand iOS réveille l'app en arrière-plan
    /// sans créer de vue.
    static let shared = PhoneLink()

    enum Outcome: Equatable {
        case delivered(session: String)
        case failed(String)
    }

    private var activated = false

    /// Démarre WatchConnectivity une fois : l'app delegate l'appelle au lancement, la vue
    /// se contente de lire l'instance partagée.
    func start() {
        guard WCSession.isSupported(), !activated else { return }
        activated = true
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Juste après le lancement, WatchConnectivity met plusieurs secondes à voir l'iPhone
    /// (mesuré : 15 s en simulateur). On attend la joignabilité avant de conclure.
    private static let reachabilityWait: TimeInterval = 15

    func send(text: String, to session: String, nonce: String, completion: @escaping (Outcome) -> Void) {
        let done: (Outcome) -> Void = { outcome in DispatchQueue.main.async { completion(outcome) } }
        guard WCSession.isSupported() else { return done(.failed("WatchConnectivity unavailable")) }
        let message: [String: Any] = ["kind": "send", "session": session, "text": text, "nonce": nonce]
        whenReachable(deadline: Date().addingTimeInterval(Self.reachabilityWait)) { reachable in
            guard reachable else { return done(.failed("iPhone unreachable")) }
            WCSession.default.sendMessage(
                message,
                replyHandler: { reply in
                    if reply["ok"] as? Bool == true {
                        done(.delivered(session: reply["session"] as? String ?? session))
                    } else {
                        done(.failed(reply["error"] as? String ?? "Refused by the Mac"))
                    }
                },
                errorHandler: { error in done(.failed(error.localizedDescription)) }
            )
        }
    }

    private func whenReachable(deadline: Date, _ then: @escaping (Bool) -> Void) {
        let wc = WCSession.default
        if wc.activationState == .activated && wc.isReachable { return then(true) }
        if Date() >= deadline { return then(false) }
        if wc.activationState == .notActivated { wc.activate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.whenReachable(deadline: deadline, then)
        }
    }

    // MARK: Nombres du cadran

    /// App Group partagé avec l'extension `watch-widget` : c'est par lui que la complication
    /// lit les nombres, sans WatchConnectivity.
    private static let sharedSuite = "group.io.claap.kovalink"
    private static let countsKey = "watch.counts"
    private static let countsAtKey = "watch.counts.at"

    /// `[asks, errors, ended, oldestAt]` et, depuis la version qui date ses envois, un
    /// cinquième entier `at` : l'instant où l'iPhone a composé ces nombres. Un envoi sans
    /// `at` (iPhone plus ancien) prend l'heure de réception.
    ///
    /// Le contexte de WatchConnectivity peut arriver en retard : un `at` plus vieux que
    /// celui déjà en place est ignoré, sinon un état ancien écraserait un plus récent.
    private func storeCounts(_ raw: Any?) {
        guard let payload = raw as? [Int], payload.count == 4 || payload.count == 5 else { return }
        let stamp = payload.count == 5 ? payload[4] : Int(Date().timeIntervalSince1970)
        let defaults = UserDefaults(suiteName: Self.sharedSuite) ?? .standard
        if stamp < defaults.integer(forKey: Self.countsAtKey) { return }
        // La complication lit quatre entiers : `at` reste à côté, jamais dedans.
        defaults.set(Array(payload.prefix(4)), forKey: Self.countsKey)
        defaults.set(stamp, forKey: Self.countsAtKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // Contexte reçu pendant que l'app n'était pas lancée : on le remonte à la complication.
        guard activationState == .activated else { return }
        storeCounts(session.receivedApplicationContext["counts"])
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        storeCounts(applicationContext["counts"])
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        storeCounts(userInfo["counts"])
    }
}
