import SwiftUI
import WatchKit

@main
struct KovaLinkWatchApp: App {
    /// Le délégué démarre au lancement du processus, avant toute vue : un réveil en
    /// arrière-plan (contexte ou message de l'iPhone) doit atteindre `PhoneLink` même
    /// quand iOS ne crée aucune vue.
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate

    @StateObject private var link = PhoneLink.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(link)
        }
    }
}

/// Le lancement de l'app montre. `PhoneLink` est le seul délégué de la session.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        PhoneLink.shared.start()
    }
}
