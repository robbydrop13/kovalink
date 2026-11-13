import UserNotifications

/// Notification Service Extension.
///
/// Ce que cette extension fait : elle récupère le contenu de la notification sur le canal
/// chiffré direct, puis elle réécrit le CORPS de la bannière.
///
/// Ce qu'elle ne fait JAMAIS, et c'est une exigence, pas une préférence :
///  - elle n'appelle jamais `setNotificationCategories`. Ré-enregistrer une catégorie depuis
///    une extension n'est pas une capacité documentée par Apple. Si l'hypothèse était fausse,
///    la bannière apparaîtrait sans aucun bouton, en silence, sur le seul écran qui justifie
///    le produit. Les catégories sont pré-enregistrées statiquement par l'app au lancement ;
///  - elle ne déclare aucune action, et surtout aucune action de saisie de texte libre ;
///  - elle ne transporte aucun secret : la charge utile du push ne contient qu'une référence
///    opaque, jamais la question, jamais le paneId.
///
/// Elle se contente de choisir, parmi les catégories déjà enregistrées, celle qui correspond
/// à ce qu'elle a réussi à lire. Branchement à TROIS voies : `turn_end`, `parsed`,
/// `unparsable`. C'est `turn_end` qui arrive le plus souvent : sur cette machine, l'agent ne
/// demande jamais de permission, il finit son tour.
final class NotificationService: UNNotificationServiceExtension {

    // Identifiants de catégorie. Ils DOIVENT rester identiques à ceux de
    // `packages/protocol` (NOTIFICATION_CATEGORY) : Swift ne peut pas importer le TypeScript,
    // c'est la seule duplication du projet et elle est signalée ici pour être vérifiée à la
    // revue de code.
    private enum Category {
        static let turnEnd = "KL_TURN_END"
        static let awaiting2 = "KL_AWAITING_2"
        static let awaiting3 = "KL_AWAITING_3"
        static let blind = "KL_AWAITING_BLIND"
    }

    /// Catégories qui portent des boutons de réponse chiffrés.
    private static let answerCategories: Set<String> = [Category.awaiting2, Category.awaiting3]

    /// Budget interne. iOS accorde environ 30 s, on s'arrête bien avant : au delà, Robin
    /// regarde un écran vide en attendant une bannière.
    private static let budget: TimeInterval = 4.0

    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?
    private var task: URLSessionDataTask?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.handler = contentHandler
        let mutable = request.content.mutableCopy() as? UNMutableNotificationContent
        self.content = mutable

        guard let content = mutable,
              let promptRef = content.userInfo["promptRef"] as? String,
              // `host` : le Mac qui a sonné (plan M1, étape 5). Absent chez un daemon plus
              // ancien : les clés du Mac actif, comme avant.
              let config = SharedKeychain.load(host: content.userInfo["host"] as? String)
        else {
            // Aucun jeton, aucune référence : on rend la charge utile telle quelle. Elle
            // porte déjà `KL_AWAITING_BLIND` et son texte de repli, donc la bannière n'est
            // jamais muette et ne promet aucun bouton qui n'existe pas.
            contentHandler(mutable ?? request.content)
            return
        }

        fetch(config: config, promptRef: promptRef) { [weak self] prompt in
            guard let self, let content = self.content, let handler = self.handler else { return }
            guard let prompt else {
                // Échec de récupération : état 3. Corps de repli, aucune action d'option.
                content.title = "Validation required"
                content.body = "The question could not be fetched. Open the app to read it."
                content.categoryIdentifier = Category.blind
                handler(content)
                return
            }
            self.apply(prompt: prompt, to: content)
            // Bannière d'un autre Mac que l'actif : jamais de bouton de réponse. Une action
            // rapide n'agirait pas (l'app ne répond qu'au Mac actif) ; toucher la bannière
            // ouvre l'app, qui change de Mac puis ouvre le pane.
            if !config.isActiveHost, NotificationService.answerCategories.contains(content.categoryIdentifier) {
                content.categoryIdentifier = Category.blind
            }
            handler(content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        task?.cancel()
        if let content, let handler {
            content.categoryIdentifier = Category.blind
            handler(content)
        }
    }

    // MARK: - Branchement à trois voies

    private func apply(prompt: Prompt, to content: UNMutableNotificationContent) {
        let tab = content.userInfo["tab"] as? String ?? "Kova"
        let project = content.userInfo["project"] as? String ?? ""

        switch prompt.state {
        case .turnEnd:
            // Le cas dominant. Aucune décision à prendre, donc aucune action d'approbation :
            // Robin ouvre, lit le dernier échange, et dicte la suite.
            content.title = "\(tab) is done"
            content.subtitle = prompt.subtitle ?? project
            content.body = prompt.summary ?? "The task is done."
            content.categoryIdentifier = Category.turnEnd

        case .parsed:
            content.title = "\(tab) attend ta validation"
            content.subtitle = prompt.subtitle ?? project
            // Le corps porte la question, le détail, puis la LISTE NUMÉROTÉE des options.
            // C'est cette liste qui donne son sens aux boutons chiffrés, elle n'est jamais
            // omise : les libellés des boutons sont figés à l'enregistrement de la catégorie.
            var body = String(prompt.question?.prefix(120) ?? "")
            if let detail = prompt.detail, !detail.isEmpty {
                body += "\n" + detail.joined(separator: "\n")
            }
            let options = prompt.options ?? []
            if !options.isEmpty {
                body += "\n" + options.map { "\($0.index). \($0.label)" }.joined(separator: "\n")
            }
            content.body = body

            // Le userInfo porte ce dont l'action rapide a besoin pour envoyer une réponse
            // vérifiable : l'index seul ne suffit pas, le daemon exige le hash.
            content.userInfo["paneId"] = prompt.paneId
            content.userInfo["promptHash"] = prompt.promptHash ?? ""
            content.userInfo["awaitingSince"] = prompt.awaitingSince ?? ""
            content.userInfo["optionCount"] = options.count
            content.userInfo["optionKinds"] = options.map { $0.kind }

            // Budget de 4 actions. `Interrompre` n'est jamais retiré, l'option de refus non
            // plus. À partir de 4 options, 4 chiffres plus `Interrompre` feraient 5 actions :
            // on retombe donc sur la catégorie aveugle, avec la question et la liste complète
            // toujours lisibles dans le corps.
            switch options.count {
            case 2: content.categoryIdentifier = Category.awaiting2
            case 3: content.categoryIdentifier = Category.awaiting3
            default: content.categoryIdentifier = Category.blind
            }

        case .unparsable:
            // Question détectée, options illisibles. Le texte de la question n'est pas
            // affiché : on vient de dire qu'on ne sait pas le lire.
            content.title = "\(tab)"
            content.subtitle = project
            content.body = "A question is waiting on the Mac. The options could not be read."
            content.categoryIdentifier = Category.blind

        case .none:
            content.body = "The question was resolved on the Mac."
            content.categoryIdentifier = Category.blind
        }
    }

    // MARK: - Récupération

    private func fetch(
        config: SharedKeychain.Config,
        promptRef: String,
        completion: @escaping (Prompt?) -> Void
    ) {
        guard let url = URL(string: "https://\(config.tsDns):\(config.port)/v1/prompt/\(promptRef)")
        else {
            completion(nil)
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = NotificationService.budget
        // Jeton court dédié à la NSE, de portée limitée à cette seule route.
        request.setValue("Bearer \(config.nseToken)", forHTTPHeaderField: "Authorization")

        let session = URLSession(configuration: .ephemeral)
        task = session.dataTask(with: request) { data, response, _ in
            guard let data,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let prompt = try? JSONDecoder().decode(Prompt.self, from: data)
            else {
                completion(nil)
                return
            }
            completion(prompt)
        }
        task?.resume()
    }
}

// MARK: - Modèle

/// Miroir minimal du type `Prompt` de `packages/protocol`. Union à trois états utiles.
struct Prompt: Decodable {
    enum State: String, Decodable {
        case turnEnd = "turn_end"
        case parsed
        case unparsable
        case none
    }

    struct Option: Decodable {
        let index: Int
        let label: String
        let kind: String
    }

    let state: State
    let paneId: Int
    let awaitingSince: String?
    let question: String?
    let detail: [String]?
    let options: [Option]?
    let promptHash: String?
    let summary: String?
    let subtitle: String?
}

/// Lecture du trousseau partagé. L'extension n'y lit que ce dont elle a besoin.
///
/// Les entrées sont écrites par expo-secure-store (`app/src/store/credentials.ts`), qui
/// range chaque clé sous le service `<keychainService>:no-auth`, avec le compte en `Data`
/// (`SecureStoreModule.swift`, `query(with:options:requireAuthentication:)`), dans le groupe
/// `<AppIdentifierPrefix>io.claap.kovalink`. La requête ne nomme pas le groupe : le préfixe
/// d'équipe n'est pas connu ici, et sans groupe iOS cherche dans tous ceux de l'extension,
/// c'est à dire ce seul groupe partagé.
enum SharedKeychain {
    struct Config {
        let tsDns: String
        let port: Int
        let nseToken: String
        /// Faux pour l'emplacement d'un autre Mac que l'actif (`kl.h.<host>.*`).
        let isActiveHost: Bool
    }

    /// Service actuel d'expo-secure-store, puis l'ancien nom sans suffixe.
    private static let services = ["io.claap.kovalink:no-auth", "io.claap.kovalink"]

    /// `host` : `tsDns` du daemon émetteur, porté par la charge. S'il désigne un autre Mac
    /// que l'actif, on lit l'emplacement de ce Mac (`kl.h.<host>.*`). Sans emplacement, pas
    /// de configuration : la bannière reste dans son état sans bouton d'option.
    static func load(host: String?) -> Config? {
        let active = read("kl.tsDns")
        if let host, !host.isEmpty, host != active {
            return loadHost(host)
        }
        guard let tsDns = active, let nseToken = read("kl.nseToken") else { return nil }
        // `kl.port` est ecrit par l'app a l'appairage (credentials.ts). Le repli est la
        // constante GENEREE depuis le protocole, jamais un nombre ecrit ici.
        let port = read("kl.port").flatMap(Int.init) ?? KovaLinkProtocol.defaultPort
        return Config(tsDns: tsDns, port: port, nseToken: nseToken, isActiveHost: true)
    }

    /// Un Mac du registre `kl.hosts` seulement : le jeton ne part jamais vers un nom venu de
    /// la seule charge. Le port vient du registre (`hosts.ts`, `HostEntry.port`).
    private static func loadHost(_ host: String) -> Config? {
        guard let raw = read("kl.hosts"),
              let data = raw.data(using: .utf8),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
              let entry = list.first(where: { ($0["id"] as? String) == host }),
              let nseToken = read("kl.h.\(safeKey(host)).nseToken")
        else { return nil }
        let stored = (entry["port"] as? NSNumber)?.intValue ?? 0
        let port = stored > 0 ? stored : KovaLinkProtocol.defaultPort
        return Config(tsDns: host, port: port, nseToken: nseToken, isActiveHost: false)
    }

    /// Miroir de `hostKeys` (`app/src/store/hosts.ts`) : chaque unité UTF-16 hors de
    /// `[A-Za-z0-9._-]` devient `_`, comme la regex JS sans drapeau `u`.
    static func safeKey(_ id: String) -> String {
        String(id.utf16.map { unit -> Character in
            switch unit {
            case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2E, 0x5F, 0x2D:
                return Character(Unicode.Scalar(UInt8(unit)))
            default:
                return "_"
            }
        })
    }

    private static func read(_ key: String) -> String? {
        let account = Data(key.utf8)
        for service in services {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            var item: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
               let data = item as? Data,
               let value = String(data: data, encoding: .utf8) {
                return value
            }
        }
        return nil
    }
}
