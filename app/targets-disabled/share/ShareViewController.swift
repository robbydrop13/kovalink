import UIKit
import UniformTypeIdentifiers
import Social

/// Share Extension de KovaLink.
///
/// Elle fait UNE chose : copier les pièces jointes dans le conteneur du groupe d'app, puis
/// ouvrir `kovalink://share` pour passer la main à l'app hôte. Le choix de la destination,
/// l'envoi par morceaux et la reprise vivent dans l'app, où ce code existe déjà et où la
/// limite mémoire de 120 Mo d'une extension ne s'applique pas.
///
/// Conséquence voulue : cette extension ne lit aucun jeton, n'ouvre aucune connexion
/// réseau, et ne peut donc rien exfiltrer. Sa surface d'attaque est un dossier de travail.
class ShareViewController: UIViewController {

  private static let appGroup = "group.io.claap.kovalink"
  private static let inboxName = "share-inbox"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.043, green: 0.051, blue: 0.063, alpha: 1)
    handleAttachments()
  }

  /// Dossier de dépôt, vidé à chaque partage.
  ///
  /// Le vider AVANT chaque partage, et non après, est délibéré : si l'app hôte n'a pas été
  /// ouverte la fois précédente, les fichiers restants seraient renvoyés par erreur avec
  /// ceux du partage courant.
  private func prepareInbox() -> URL? {
    let fm = FileManager.default
    guard let container = fm.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) else {
      return nil
    }
    let inbox = container.appendingPathComponent(Self.inboxName, isDirectory: true)
    if fm.fileExists(atPath: inbox.path) {
      try? fm.removeItem(at: inbox)
    }
    try? fm.createDirectory(at: inbox, withIntermediateDirectories: true)
    return inbox
  }

  private func handleAttachments() {
    guard
      let inbox = prepareInbox(),
      let items = extensionContext?.inputItems as? [NSExtensionItem]
    else {
      finish(inbox: nil)
      return
    }

    let providers = items.flatMap { $0.attachments ?? [] }
    guard !providers.isEmpty else {
      finish(inbox: inbox)
      return
    }

    let group = DispatchGroup()
    for provider in providers {
      group.enter()
      copy(provider: provider, into: inbox) { group.leave() }
    }
    group.notify(queue: .main) { [weak self] in
      self?.finish(inbox: inbox)
    }
  }

  /// Copie une pièce jointe, quel que soit son type.
  ///
  /// `UTType.item` couvre tout ce qui a une représentation de fichier : image, vidéo, PDF,
  /// document. Le texte et les URL, qui n'en ont pas, sont écrits dans un `.txt`, ce qui
  /// est très exactement ce que Robin veut retrouver sur son Mac quand il partage un lien
  /// depuis Safari.
  private func copy(provider: NSItemProvider, into inbox: URL, done: @escaping () -> Void) {
    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
      || provider.hasItemConformingToTypeIdentifier(UTType.item.identifier) {
      provider.loadFileRepresentation(forTypeIdentifier: UTType.item.identifier) { url, _ in
        defer { done() }
        guard let url else { return }
        // `loadFileRepresentation` donne un fichier temporaire détruit au retour du bloc :
        // la copie doit se faire ICI, pas plus tard.
        let target = Self.uniqueDestination(inbox: inbox, name: url.lastPathComponent)
        try? FileManager.default.copyItem(at: url, to: target)
      }
      return
    }

    for identifier in [UTType.url.identifier, UTType.plainText.identifier] {
      guard provider.hasItemConformingToTypeIdentifier(identifier) else { continue }
      provider.loadItem(forTypeIdentifier: identifier, options: nil) { item, _ in
        defer { done() }
        let text: String?
        if let url = item as? URL {
          text = url.absoluteString
        } else if let string = item as? String {
          text = string
        } else {
          text = nil
        }
        guard let text else { return }
        let name = "partage-\(Self.timestamp()).txt"
        let target = Self.uniqueDestination(inbox: inbox, name: name)
        try? text.write(to: target, atomically: true, encoding: .utf8)
      }
      return
    }

    done()
  }

  /// Deux photos peuvent porter le même nom (`IMG_0001.HEIC`). Suffixe `-2`, comme le Mac.
  private static func uniqueDestination(inbox: URL, name: String) -> URL {
    let fm = FileManager.default
    var candidate = inbox.appendingPathComponent(name)
    guard fm.fileExists(atPath: candidate.path) else { return candidate }
    let ext = (name as NSString).pathExtension
    let stem = (name as NSString).deletingPathExtension
    var index = 2
    repeat {
      let suffixed = ext.isEmpty ? "\(stem)-\(index)" : "\(stem)-\(index).\(ext)"
      candidate = inbox.appendingPathComponent(suffixed)
      index += 1
    } while fm.fileExists(atPath: candidate.path) && index < 100
    return candidate
  }

  private static func timestamp() -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyyMMdd-HHmmss"
    return formatter.string(from: Date())
  }

  /// Ouvre l'app hôte et lui passe le chemin ABSOLU du dossier de dépôt.
  ///
  /// Passer le chemin plutôt que de le faire redécouvrir à l'app évite d'écrire un module
  /// natif dont ce serait le seul rôle. Les deux processus partagent le conteneur, donc le
  /// même chemin y désigne les mêmes fichiers.
  private func finish(inbox: URL?) {
    var target = "kovalink://share"
    if let inbox,
       let encoded = inbox.path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
      target += "?root=\(encoded)"
    }
    if let url = URL(string: target) {
      openHostApp(url)
    }
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }

  /// `UIApplication.shared` n'existe pas dans une extension : on remonte la chaîne des
  /// répondeurs jusqu'à un objet qui sait ouvrir une URL. C'est le chemin supporté.
  private func openHostApp(_ url: URL) {
    var responder: UIResponder? = self
    let selector = sel_registerName("openURL:")
    while let current = responder {
      if current.responds(to: selector) && current != self {
        current.perform(selector, with: url)
        return
      }
      responder = current.next
    }
  }
}
