import Foundation
import WatchConnectivity

/// Le seul canal de la montre : l'iPhone, par WatchConnectivity. L'iPhone relaie au daemon.
///
/// Message envoyé : `kind=send`, `session`, `text`, `nonce`. Réponse : `ok`, puis `session`
/// (le nom résolu) ou `error` (une phrase lisible, déjà rédigée par l'iPhone).
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    enum Outcome: Equatable {
        case delivered(session: String)
        case failed(String)
    }

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
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

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
}
