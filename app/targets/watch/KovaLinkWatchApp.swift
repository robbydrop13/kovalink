import SwiftUI

@main
struct KovaLinkWatchApp: App {
    @StateObject private var link = PhoneLink()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(link)
        }
    }
}
