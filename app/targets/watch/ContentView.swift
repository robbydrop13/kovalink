import SwiftUI
import WatchKit

/// Les deux sessions de v1. Le nom est celui que le daemon résout (nom de session ou titre).
private let targets = ["claap-agent", "perso-agent"]

/// En dessous, un appui est un tap : rien n'est envoyé.
private let minHold: TimeInterval = 0.5
/// Ce que le micro garde après le relâché.
private let tailAfterRelease: TimeInterval = 0.35

/// Un bouton par session : appuyer et tenir enregistre, relâcher envoie. Pas de clavier, pas
/// de confirmation : l'iPhone fait transcrire l'audio par le daemon et relaie le texte.
struct ContentView: View {
    @EnvironmentObject private var link: PhoneLink
    @State private var recorder = VoiceRecorder()
    /// Le bouton sous le doigt, remis à `nil` au relâché comme à l'annulation du geste.
    @GestureState private var held: String?
    /// La session du bouton tenu, du premier contact au relâché.
    @State private var pressed: String?
    /// Début de l'enregistrement en cours, une fois le micro ouvert.
    @State private var recordingSince: Date?
    @State private var state: SendState = .idle
    /// Le dernier enregistrement qui n'est pas passé. Retry le renvoie avec le même nonce :
    /// le daemon ignore un doublon si le premier envoi était en fait arrivé.
    @State private var retry: Take?
    /// Le micro tourne encore un instant après le relâché, pour ne pas couper le dernier mot.
    @State private var finishing = false

    struct Take: Equatable {
        let file: URL
        let target: String
        let nonce: String
    }

    enum SendState: Equatable {
        case idle, tooShort, sending(String), sent(String), failed(String)
    }

    private var sending: Bool {
        if case .sending = state { return true }
        return false
    }

    var body: some View {
        VStack(spacing: 6) {
            ForEach(targets, id: \.self) { holdButton($0) }
            status
                .font(DS.font(12))
                .frame(maxWidth: .infinity, minHeight: 28)
        }
        .padding(.horizontal, 2)
        .onChange(of: held) { _, new in
            if let new { press(new) } else { release() }
        }
        #if DEBUG
        .task { await selfTest() }
        #endif
    }

    private func holdButton(_ target: String) -> some View {
        let isPressed = pressed == target
        let recording = isPressed && recordingSince != nil
        let shape = RoundedRectangle(cornerRadius: 16)
        return VStack(spacing: 2) {
            Image(systemName: recording ? "waveform" : "mic.fill")
                .font(.system(size: 18, weight: .semibold))
            Text(target)
                .font(DS.font(15, weight: .semibold))
            if recording, let since = recordingSince {
                Text(since, style: .timer)
                    .font(DS.font(13, weight: .medium).monospacedDigit())
            }
        }
        .foregroundStyle(DS.t1)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(shape.fill(recording ? DS.critBg : DS.bgElev))
        .overlay(shape.stroke(recording ? DS.critDot : .clear, lineWidth: 2))
        .scaleEffect(isPressed ? 0.97 : 1)
        .opacity(sending || (pressed != nil && !isPressed) ? 0.4 : 1)
        .contentShape(shape)
        // Un DragGesture sans distance minimale voit le contact et le relâché, là où un
        // Button ne voit que le tap.
        .gesture(DragGesture(minimumDistance: 0).updating($held) { _, held, _ in held = target })
        .allowsHitTesting(!sending && (pressed == nil || isPressed))
        .animation(.easeOut(duration: 0.12), value: isPressed)
    }

    @ViewBuilder private var status: some View {
        if pressed != nil {
            Text(recordingSince == nil ? "Opening the mic" : "Release to send").foregroundStyle(DS.t3)
        } else {
            HStack(spacing: 6) {
                outcome
                // Visible tant que l'enregistrement raté est gardé, même après un tap trop court.
                if let retry, !sending {
                    Button("Retry") { send(retry) }
                        .font(DS.font(12, weight: .semibold))
                        .buttonStyle(.borderedProminent)
                        .tint(DS.accent)
                        .fixedSize()
                }
            }
        }
    }

    @ViewBuilder private var outcome: some View {
        switch state {
        case .idle:
            Text("Hold to talk").foregroundStyle(DS.t3)
        case .tooShort:
            Label("Hold to talk", systemImage: "hand.tap.fill").foregroundStyle(DS.warn)
        case .sending(let target):
            ProgressView().frame(width: 16, height: 16)
            Text("Sending to \(target)").foregroundStyle(DS.t2)
        case .sent(let session):
            Label("Delivered to \(session)", systemImage: "checkmark.circle.fill").foregroundStyle(DS.ok)
        case .failed(let reason):
            Label(reason, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(DS.warn)
                .lineLimit(2)
        }
    }

    // MARK: Appui

    private func press(_ target: String) {
        guard pressed == nil, !sending, !finishing else { return }
        pressed = target
        recorder.start { ok in
            // Relâché pendant la demande du micro : l'appui est déjà compté comme un tap. Si un
            // autre appui a pris la main entre-temps, l'enregistrement est le sien : on n'y touche pas.
            guard pressed == target else {
                if pressed == nil, let take = recorder.stop() { try? FileManager.default.removeItem(at: take.url) }
                return
            }
            guard ok else {
                pressed = nil
                WKInterfaceDevice.current().play(.failure)
                state = .failed("Microphone unavailable")
                return
            }
            let since = Date()
            recordingSince = since
            WKInterfaceDevice.current().play(.start)
            // Plafond : l'enregistrement part comme si le doigt s'était levé.
            DispatchQueue.main.asyncAfter(deadline: .now() + VoiceRecorder.maxDuration) {
                if recordingSince == since { release() }
            }
        }
    }

    private func release() {
        guard let target = pressed else { return }
        pressed = nil
        recordingSince = nil
        finishing = true
        // Le doigt se lève souvent sur la dernière syllabe : 0,35 s de plus la garde.
        DispatchQueue.main.asyncAfter(deadline: .now() + tailAfterRelease) {
            finishing = false
            finish(target)
        }
    }

    private func finish(_ target: String) {
        let take = recorder.stop()
        guard let take, take.duration >= minHold + tailAfterRelease else {
            if let take { try? FileManager.default.removeItem(at: take.url) }
            WKInterfaceDevice.current().play(.click)
            state = .tooShort
            return
        }
        send(Take(file: take.url, target: target, nonce: UUID().uuidString))
    }

    private func send(_ take: Take) {
        // Un nouvel enregistrement remplace celui qu'on pouvait encore renvoyer.
        if let old = retry, old != take { try? FileManager.default.removeItem(at: old.file) }
        retry = nil
        state = .sending(take.target)
        link.send(audio: take.file, to: take.target, nonce: take.nonce) { outcome in
            #if DEBUG
            print("KOVALINK_SELFTEST \(outcome)")
            #endif
            switch outcome {
            case .delivered(let session):
                WKInterfaceDevice.current().play(.success)
                try? FileManager.default.removeItem(at: take.file)
                state = .sent(session)
            case .failed(let reason):
                WKInterfaceDevice.current().play(.failure)
                retry = take
                state = .failed(reason)
            }
        }
    }

    #if DEBUG
    /// Aller-retour montre, iPhone, relais, en simulateur, qui ne sait pas tenir un doigt
    /// appuyé. `KOVALINK_WATCH_SELFTEST` au lancement : `1` envoie un texte vers une session
    /// qui n'existe pas, `hold` tient le premier bouton 15 s puis relâche (le vrai chemin de
    /// l'audio, en deux tranches), `tap` le touche 0,2 s. L'issue est journalisée.
    private func selfTest() async {
        switch ProcessInfo.processInfo.environment["KOVALINK_WATCH_SELFTEST"] {
        case "1":
            try? await Task.sleep(for: .seconds(4))
            link.send(text: "selftest", to: "kovalink-selftest", nonce: UUID().uuidString) { outcome in
                print("KOVALINK_SELFTEST \(outcome)")
            }
        case "hold":
            try? await Task.sleep(for: .seconds(3))
            press(targets[0])
            try? await Task.sleep(for: .seconds(15))
            release()
        case "tap":
            try? await Task.sleep(for: .seconds(3))
            press(targets[0])
            try? await Task.sleep(for: .milliseconds(200))
            release()
        default:
            return
        }
    }
    #endif
}
