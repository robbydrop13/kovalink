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
              let config = SharedKeychain.load()
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
                content.title = "Validation requise"
                content.body = "La question n'a pas pu être récupérée. Ouvre l'app pour la lire."
                content.categoryIdentifier = Category.blind
                handler(content)
                return
            }
            self.apply(prompt: prompt, to: content)
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
            content.title = "\(tab) a terminé"
            content.subtitle = prompt.subtitle ?? project
            content.body = prompt.summary ?? "La tâche est terminée."
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
            content.body = "Une question attend sur le Mac. Les options n'ont pas pu être lues."
            content.categoryIdentifier = Category.blind

        case .none:
            content.body = "La question a été résolue sur le Mac."
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
enum SharedKeychain {
    struct Config {
        let tsDns: String
        let port: Int
        let nseToken: String
    }

    private static let service = "io.claap.kovalink"
    private static let accessGroup = "io.claap.kovalink"

    static func load() -> Config? {
        guard let tsDns = read("kl.tsDns"), let nseToken = read("kl.nseToken") else { return nil }
        // `kl.port` est ecrit par l'app a l'appairage (credentials.ts). Le repli est la
        // constante GENEREE depuis le protocole, jamais un nombre ecrit ici.
        let port = read("kl.port").flatMap(Int.init) ?? KovaLinkProtocol.defaultPort
        return Config(tsDns: tsDns, port: port, nseToken: nseToken)
    }

    private static func read(_ key: String) -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        query[kSecAttrAccessGroup as String] = accessGroup

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
