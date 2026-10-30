import ExpoModulesCore

public class WatchRelayModule: Module {
    public func definition() -> ModuleDefinition {
        Name("WatchRelay")

        Function("configure") { (baseUrl: String, token: String) in
            WatchRelay.shared.configure(baseUrl: baseUrl, token: token)
        }

        Function("clear") {
            WatchRelay.shared.clear()
        }
    }
}

/// Active WatchConnectivity dès le lancement, y compris le lancement en arrière-plan que
/// déclenche un message de la montre : le JS n'est pas encore là, et n'a pas à l'être.
/// `subscriberDidRegister` et non `didFinishLaunching` : mesuré en simulateur (Expo 57), le
/// second n'était jamais appelé sur cet abonné.
public class WatchRelayAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func subscriberDidRegister() {
        WatchRelay.shared.activate()
    }
}
