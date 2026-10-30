import Foundation
import OSLog
import Security
import WatchConnectivity

/// Reçoit le texte dicté sur la montre et l'envoie au daemon, sans passer par le JS.
///
/// Message attendu : `kind=send`, `session`, `text`, `nonce`. Réponse à la montre : `ok`
/// puis `session` (nom résolu par le daemon) ou `error` (phrase courte, affichée telle quelle).
final class WatchRelay: NSObject, WCSessionDelegate {
    static let shared = WatchRelay()

    /// `ROUTES.sessionText` de `packages/protocol/src/routes.ts`.
    private static let sessionTextPath = "/v1/sessions/text"
    private static let keychainService = "io.claap.kovalink.watch-relay"
    private static let keychainAccount = "config"

    private struct Config: Codable {
        let baseUrl: String
        let token: String
    }

    private var activated = false
    private let log = Logger(subsystem: "io.claap.kovalink", category: "watch-relay")

    func activate() {
        guard WCSession.isSupported(), !activated else { return }
        activated = true
        WCSession.default.delegate = self
        WCSession.default.activate()
        log.notice("activating WatchConnectivity")
    }

    // MARK: Configuration, copiée du trousseau de l'app par le JS

    func configure(baseUrl: String, token: String) {
        guard let data = try? JSONEncoder().encode(Config(baseUrl: baseUrl, token: token)) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
        ]
        // Mise à jour en place : jamais d'instant sans jeton entre un effacement et un ajout.
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            // Lisible iPhone verrouillé (après le premier déverrouillage), jamais sauvegardé ailleurs.
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            item[kSecValueData as String] = data
            status = SecItemAdd(item as CFDictionary, nil)
        }
        if status != errSecSuccess { log.error("keychain write failed \(status)") }
    }

    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func loadConfig() -> Config? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Config.self, from: data)
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        log.notice("activation state \(activationState.rawValue), error \(error?.localizedDescription ?? "none")")
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // Changement de montre : réactiver pour la nouvelle.
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard message["kind"] as? String == "send",
              let target = message["session"] as? String,
              let text = message["text"] as? String,
              let nonce = message["nonce"] as? String
        else {
            return replyHandler(["ok": false, "error": "Unknown request, update KovaLink"])
        }
        // L'app peut avoir été réveillée en arrière-plan rien que pour ce message : on garde
        // le processus en vie jusqu'à la réponse. `performExpiringActivity` est sûr depuis la
        // file de WatchConnectivity, contrairement à `UIApplication.shared`.
        log.notice("message for \(target, privacy: .public)")
        // Une seule réponse à la montre, quel que soit le chemin (réponse du Mac ou temps
        // d'arrière-plan retiré par iOS).
        let lock = NSLock()
        var answered = false
        let answer: ([String: Any]) -> Void = { [log] reply in
            lock.lock()
            defer { lock.unlock() }
            guard !answered else { return }
            answered = true
            log.notice("reply ok=\(reply["ok"] as? Bool ?? false)")
            replyHandler(reply)
        }
        ProcessInfo.processInfo.performExpiringActivity(withReason: "watch-relay") { expired in
            guard !expired else {
                return answer(["ok": false, "error": "iPhone ran out of background time, retry"])
            }
            let done = DispatchSemaphore(value: 0)
            self.post(session: target, text: text, nonce: nonce) { reply in
                answer(reply)
                done.signal()
            }
            done.wait()
        }
    }

    // MARK: Envoi au daemon

    private func post(session: String, text: String, nonce: String, reply: @escaping ([String: Any]) -> Void) {
        guard let config = loadConfig(), let url = URL(string: config.baseUrl + Self.sessionTextPath) else {
            return reply(["ok": false, "error": "Open KovaLink on the iPhone once"])
        }
        var request = URLRequest(url: url, timeoutInterval: 12)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["session": session, "text": text, "nonce": nonce])

        URLSession.shared.dataTask(with: request) { data, response, error in
            if error != nil {
                return reply(["ok": false, "error": "Mac unreachable"])
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            reply(Self.outcome(status: status, json: json, asked: session))
        }.resume()
    }

    static func outcome(status: Int, json: [String: Any], asked: String) -> [String: Any] {
        switch status {
        case 200:
            let resolved = json["session"] as? String ?? asked
            if json["applied"] as? Bool == true { return ["ok": true, "session": resolved] }
            switch json["reason"] as? String {
            case "duplicate":
                // Même nonce déjà reçu : le premier envoi est passé, la réponse s'était perdue.
                return ["ok": true, "session": resolved]
            case "unknown_session":
                let names = (json["names"] as? [String] ?? []).joined(separator: ", ")
                return ["ok": false, "error": names.isEmpty ? "No session \(asked) on the Mac" : "No session \(asked). Open: \(names)"]
            case "ambiguous_session":
                return ["ok": false, "error": "Several sessions named \(asked)"]
            case "kova_down":
                return ["ok": false, "error": "Kova is not running on the Mac"]
            case let reason?:
                return ["ok": false, "error": "Not delivered (\(reason))"]
            case nil:
                return ["ok": false, "error": "Not delivered"]
            }
        case 401:
            return ["ok": false, "error": "Open KovaLink on the iPhone to refresh access"]
        case 429:
            return ["ok": false, "error": "Too many sends, wait a moment"]
        default:
            let message = json["message"] as? String ?? "HTTP \(status)"
            return ["ok": false, "error": "Refused: \(message)"]
        }
    }
}
