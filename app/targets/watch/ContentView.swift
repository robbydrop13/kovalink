import SwiftUI
import WatchKit

/// Les deux sessions de v1. Le nom est celui que le daemon résout (nom de session ou titre).
private let targets = ["claap-agent", "perso-agent"]

struct ContentView: View {
    @EnvironmentObject private var link: PhoneLink
    @AppStorage("target") private var target = targets[0]
    @State private var text = ""
    @State private var state: SendState = .idle
    /// Un nonce par message, gardé entre deux essais : le daemon ignore un doublon.
    @State private var nonce = UUID().uuidString

    enum SendState: Equatable {
        case idle, sending, sent(String), failed(String)
    }

    var body: some View {
        // Le Picker `.navigationLink` pousse sa liste : il lui faut une pile de navigation.
        NavigationStack { form }
    }

    private var form: some View {
        ScrollView {
            VStack(spacing: 8) {
                Picker("To", selection: $target) {
                    ForEach(targets, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.navigationLink)
                // Autre destinataire, autre message : un doublon ne doit pas passer pour livré.
                .onChange(of: target) { _, _ in nonce = UUID().uuidString }

                TextField("Dictate", text: $text, axis: .vertical)
                    .lineLimit(1...8)
                    .onChange(of: text) { _, new in
                        // Nouveau texte : nouveau message, donc nouveau nonce.
                        guard !new.isEmpty else { return }
                        state = .idle
                        nonce = UUID().uuidString
                    }

                if !text.isEmpty {
                    Button(action: send) {
                        Label(state == .sending ? "Sending" : "Send", systemImage: "paperplane.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(state == .sending)
                }

                status
            }
        }
        .navigationTitle("KovaLink")
        #if DEBUG
        .task { await selfTest() }
        #endif
    }

    #if DEBUG
    /// Aller-retour montre, iPhone, relais, en simulateur : `KOVALINK_WATCH_SELFTEST=1` au
    /// lancement envoie un message vers une session qui n'existe pas et journalise l'issue.
    private func selfTest() async {
        guard ProcessInfo.processInfo.environment["KOVALINK_WATCH_SELFTEST"] == "1" else { return }
        try? await Task.sleep(for: .seconds(4))
        link.send(text: "selftest", to: "kovalink-selftest", nonce: UUID().uuidString) { outcome in
            print("KOVALINK_SELFTEST \(outcome)")
        }
    }
    #endif

    @ViewBuilder private var status: some View {
        switch state {
        case .idle, .sending:
            EmptyView()
        case .sent(let session):
            Label("Delivered to \(session)", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.footnote)
        case .failed(let reason):
            Label(reason, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.footnote)
        }
    }

    private func send() {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        state = .sending
        link.send(text: message, to: target, nonce: nonce) { outcome in
            switch outcome {
            case .delivered(let session):
                WKInterfaceDevice.current().play(.success)
                // Robin a pu redicter pendant l'attente : on n'efface que ce qui est parti.
                guard text.trimmingCharacters(in: .whitespacesAndNewlines) == message else { return }
                text = ""
                state = .sent(session)
            case .failed(let reason):
                WKInterfaceDevice.current().play(.failure)
                state = .failed(reason)
            }
        }
    }
}
