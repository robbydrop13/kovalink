import ExpoModulesCore
import UIKit

public class WatchRelayModule: Module {
    public func definition() -> ModuleDefinition {
        Name("WatchRelay")

        Function("configure") { (baseUrl: String, token: String) in
            WatchRelay.shared.configure(baseUrl: baseUrl, token: token)
        }

        Function("clear") {
            WatchRelay.shared.clear()
        }

        /// Les nombres du cadran, calcules par le JS (`features/watch/countsSync.ts`).
        /// Un objet et non quatre arguments : le JS en ajoute un champ sans casser l'appel.
        Function("setCounts") { (counts: [String: Any]) in
            WatchRelay.shared.setCounts(
                asks: intOf(counts, "asks") ?? 0,
                errors: intOf(counts, "errors") ?? 0,
                ended: intOf(counts, "ended") ?? 0,
                oldestAt: intOf(counts, "oldestAt"),
                at: intOf(counts, "at")
            )
        }
    }
}

/// Un nombre JS arrive en `NSNumber` : `intValue` lit aussi bien un entier qu'un `Double`
/// entier, la ou `as? Int` echouerait sur le second.
private func intOf(_ counts: [String: Any], _ key: String) -> Int? {
    (counts[key] as? NSNumber)?.intValue
}

/// Active WatchConnectivity dès le lancement, y compris le lancement en arrière-plan que
/// déclenche un message de la montre : le JS n'est pas encore là, et n'a pas à l'être.
/// `subscriberDidRegister` et non `didFinishLaunching` : mesuré en simulateur (Expo 57), le
/// second n'était jamais appelé sur cet abonné.
public class WatchRelayAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func subscriberDidRegister() {
        WatchRelay.shared.activate()
    }

    /// Le push SILENCIEUX de comptes du daemon (`aps: {"content-available": 1}`, sans
    /// alerte, sans son, sans badge). Expo place la charge `data` sous `userInfo["body"]` :
    /// c'est là que vit `kl`, à la racine du `userInfo` pour un push APNs brut. Elle ne
    /// porte que des nombres : `asks`, `errors`, `ended`, `oldestAt`, `at`, et
    /// `t == "counts"`.
    ///
    /// C'est le seul chemin qui atteint le cadran quand l'app est fermée : iOS réveille le
    /// processus quelques secondes, on écrit dans les defaults partagés et on pousse à la
    /// montre. Le budget d'arrière-plan se compte en secondes, donc rien n'attend ici :
    /// la réponse part dès que les nombres sont envoyés.
    public func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        let body = userInfo["body"] as? [String: Any]
        guard let kl = body?["kl"] as? [String: Any] ?? userInfo["kl"] as? [String: Any],
              kl["t"] as? String == "counts",
              let asks = kl["asks"] as? Int,
              let errors = kl["errors"] as? Int
        else {
            return completionHandler(.noData)
        }
        // Un lancement en arrière-plan ne passe pas par `didFinishLaunching` sur un abonné :
        // `subscriberDidRegister` a déjà activé la session, on le refait au cas où.
        WatchRelay.shared.activate()
        WatchRelay.shared.setCounts(
            asks: asks,
            errors: errors,
            ended: kl["ended"] as? Int ?? 0,
            oldestAt: kl["oldestAt"] as? Int,
            at: kl["at"] as? Int
        )
        // Le push silencieux ne touche pas au badge : sans ces deux lignes, une permission
        // acceptée sur le Mac laissait le compteur haut sur l'écran d'accueil.
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = asks
        }
        completionHandler(.newData)
    }
}
