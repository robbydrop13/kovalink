import Foundation
import OSLog
import Security
import WatchConnectivity

/// Le relais de la montre, dans les deux sens : le texte dicte part vers le daemon, et les
/// nombres du cadran (questions, erreurs, age) partent vers la montre par WatchConnectivity.
///
/// Message attendu de la montre : `kind=send`, `session`, `text`, `nonce`. Reponse a la
/// montre : `ok` puis `session` (nom resolu par le daemon) ou `error` (phrase courte,
/// affichee telle quelle). La voix arrive en `kind=audio`, voir `receiveAudio`.
final class WatchRelay: NSObject, WCSessionDelegate {
    static let shared = WatchRelay()

    /// `ROUTES.sessionText` de `packages/protocol/src/routes.ts`.
    private static let sessionTextPath = "/v1/sessions/text"
    /// `ROUTES.transcribe` et `TRANSCRIBE_MAX_BYTES` de `packages/protocol/src/routes.ts`.
    private static let transcribePath = "/v1/transcribe"
    private static let transcribeMaxBytes = 10 * 1024 * 1024
    private static let keychainService = "io.claap.kovalink.watch-relay"
    private static let keychainAccount = "config"

    /// App Group partage avec l'app hote et avec la montre : c'est par lui que la montre
    /// lit les nombres, y compris quand l'iPhone est verrouille.
    private static let sharedSuite = "group.io.claap.kovalink"
    /// Derniers nombres pousses, renvoyes a une montre qui s'active apres coup.
    private static let countsKey = "watch.counts"
    /// Instant de composition des nombres gardes, en secondes epoch.
    private static let countsAtKey = "watch.counts.at"

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

    // MARK: Comptes du cadran

    /// Les nombres du cadran, en cinq entiers : `[asks, errors, ended, oldestAt, at]`,
    /// `oldestAt` etant la seconde epoch de la plus ancienne attente (0 quand il n'y en a
    /// pas) et `at` celle de leur composition. Jamais un mot : ni question, ni nom de
    /// pane, ni titre.
    ///
    /// Un `at` plus ancien que le dernier recu est ignore : deux pushes partis dans un
    /// ordre peuvent arriver dans l'autre, et le second ecraserait des nombres plus
    /// recents par des plus vieux.
    ///
    /// Ils sont gardes dans les defaults partages, pour qu'une montre activee plus tard
    /// (app installee, iPhone redemarre) recoive le dernier etat au lieu de rien.
    func setCounts(asks: Int, errors: Int, ended: Int, oldestAt: Int?, at: Int?) {
        let stamp = at ?? Int(Date().timeIntervalSince1970)
        if stamp < sharedDefaults.integer(forKey: Self.countsAtKey) {
            log.notice("counts ignored, older than the stored ones")
            return
        }
        let payload = [asks, errors, ended, oldestAt ?? 0, stamp]
        sharedDefaults.set(payload, forKey: Self.countsKey)
        sharedDefaults.set(stamp, forKey: Self.countsAtKey)
        log.notice("counts asks=\(asks) errors=\(errors) ended=\(ended)")
        publish(payload)
    }

    private var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: Self.sharedSuite) ?? .standard
    }

    private func publish(_ payload: [Int]) {
        let session = WCSession.default
        // Session pas encore active (le push silencieux peut arriver avant la fin de
        // `activate()`) : la valeur gardee partira de `activationDidComplete`.
        guard session.activationState == .activated else { return }
        do {
            // Derniere valeur gagne : `updateApplicationContext` remplace, il ne fait pas file.
            try session.updateApplicationContext(["counts": payload])
        } catch {
            log.error("application context failed \(error.localizedDescription)")
        }
        // Complication : iOS compte le budget, on n'en prend un que s'il en reste un.
        if session.isComplicationEnabled && session.remainingComplicationUserInfoTransfers > 0 {
            _ = session.transferCurrentComplicationUserInfo(["counts": payload])
        }
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
        // Montre activee apres le dernier envoi : on lui renvoie les nombres gardes.
        if activationState == .activated, let payload = sharedDefaults.array(forKey: Self.countsKey) as? [Int] {
            publish(payload)
        }
    }
    /// App de montre installee (ou retiree) pendant que l'iPhone tourne.
    func sessionWatchStateDidChange(_ session: WCSession) {
        if let payload = sharedDefaults.array(forKey: Self.countsKey) as? [Int] {
            publish(payload)
        }
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // Changement de montre : réactiver pour la nouvelle.
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        switch message["kind"] as? String {
        case "send":
            guard let target = message["session"] as? String,
                  let text = message["text"] as? String,
                  let nonce = message["nonce"] as? String
            else { break }
            log.notice("message for \(target, privacy: .public)")
            return respond(replyHandler) { reply in self.post(session: target, text: text, nonce: nonce, reply: reply) }
        case "audio":
            return receiveAudio(message, replyHandler: replyHandler)
        default:
            break
        }
        replyHandler(["ok": false, "error": "Unknown request, update KovaLink"])
    }

    /// Une seule réponse à la montre, quel que soit le chemin (réponse du Mac ou temps
    /// d'arrière-plan retiré par iOS).
    ///
    /// L'app peut avoir été réveillée en arrière-plan rien que pour ce message : on garde le
    /// processus en vie jusqu'à la réponse. `performExpiringActivity` est sûr depuis la file
    /// de WatchConnectivity, contrairement à `UIApplication.shared`.
    private func respond(_ replyHandler: @escaping ([String: Any]) -> Void, work: @escaping (@escaping ([String: Any]) -> Void) -> Void) {
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
            work { reply in
                answer(reply)
                done.signal()
            }
            done.wait()
        }
    }

    // MARK: Voix de la montre

    /// Les tranches d'un enregistrement de la montre, dans l'ordre : `id` (un UUID propre à
    /// chaque essai, pour qu'un Retry n'écrive jamais dans le fichier d'un essai encore en
    /// cours), `offset`, `chunk`, `last`, et `session` et `nonce` sur la dernière. Elles s'ajoutent à un fichier
    /// temporaire ; un `offset` qui ne tombe pas sur sa taille veut dire une tranche perdue.
    /// La dernière part au daemon pour la transcription, puis le texte suit le chemin de
    /// `kind=send`, avec le nonce du message : le daemon ignore un doublon.
    private func receiveAudio(_ message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard let id = message["id"] as? String, UUID(uuidString: id) != nil,
              let offset = message["offset"] as? Int,
              let chunk = message["chunk"] as? Data,
              let last = message["last"] as? Bool
        else {
            return replyHandler(["ok": false, "error": "Unknown request, update KovaLink"])
        }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("watch-audio-\(id).aac")
        let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
        guard offset == 0 || offset == size, offset + chunk.count <= Self.transcribeMaxBytes else {
            try? FileManager.default.removeItem(at: file)
            return replyHandler(["ok": false, "error": "Recording incomplete, retry"])
        }
        do {
            if offset == 0 {
                try chunk.write(to: file, options: .atomic)
            } else {
                let handle = try FileHandle(forWritingTo: file)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: chunk)
            }
        } catch {
            return replyHandler(["ok": false, "error": "iPhone storage error, retry"])
        }
        guard last else { return replyHandler(["ok": true]) }
        guard let target = message["session"] as? String, let nonce = message["nonce"] as? String else {
            return replyHandler(["ok": false, "error": "Unknown request, update KovaLink"])
        }
        log.notice("audio for \(target, privacy: .public) bytes=\(offset + chunk.count)")
        respond(replyHandler) { reply in
            self.transcribe(file: file) { result in
                try? FileManager.default.removeItem(at: file)
                switch result {
                case .success(let text):
                    self.post(session: target, text: text, nonce: nonce, reply: reply)
                case .failure(let failure):
                    reply(failure.reply)
                }
            }
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

    /// Une phrase pour la montre, déjà rédigée.
    struct RelayFailure: Error {
        let message: String
        var reply: [String: Any] { ["ok": false, "error": message] }
    }

    /// `POST /v1/transcribe`, corps brut `audio/aac`, comme la dictée de l'app.
    private func transcribe(file: URL, completion: @escaping (Result<String, RelayFailure>) -> Void) {
        guard let config = loadConfig(), let url = URL(string: config.baseUrl + Self.transcribePath) else {
            return completion(.failure(RelayFailure(message: "Open KovaLink on the iPhone once")))
        }
        guard let audio = try? Data(contentsOf: file) else {
            return completion(.failure(RelayFailure(message: "Recording lost, retry")))
        }
        // Au-delà du budget du daemon (120 s chez OpenAI) : un appel lent mais réussi ne doit
        // pas passer pour un échec, que Retry ferait transcrire une deuxième fois.
        var request = URLRequest(url: url, timeoutInterval: 130)
        request.httpMethod = "POST"
        request.setValue("audio/aac", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "authorization")
        request.httpBody = audio

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                let timedOut = (error as? URLError)?.code == .timedOut
                return completion(.failure(RelayFailure(message: timedOut ? "Transcription took too long, retry" : "Mac unreachable")))
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            completion(Self.transcription(status: status, json: json))
        }.resume()
    }

    static func transcription(status: Int, json: [String: Any]) -> Result<String, RelayFailure> {
        switch status {
        case 200:
            let text = (json["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? .failure(RelayFailure(message: "Nothing heard")) : .success(text)
        case 401:
            return .failure(RelayFailure(message: "Open KovaLink on the iPhone to refresh access"))
        case 429:
            return .failure(RelayFailure(message: "Too many sends, wait a moment"))
        case 503:
            return .failure(RelayFailure(message: "Transcription is off on the Mac"))
        default:
            // Le daemon rédige déjà la raison (plus de crédits OpenAI, limite atteinte...).
            let message = json["message"] as? String ?? "HTTP \(status)"
            return .failure(RelayFailure(message: "Transcription failed: \(message)"))
        }
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
