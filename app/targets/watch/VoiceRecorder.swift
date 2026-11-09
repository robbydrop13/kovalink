import AVFoundation
import Foundation

/// Le micro de la montre, un enregistrement à la fois, le temps d'un appui.
///
/// AAC mono 16 kHz à 32 kbit/s, en `.aac` (ADTS) : de la voix seulement, deux minutes font
/// moins de 500 Ko, qui passent à l'iPhone en une dizaine de messages. Le daemon accepte ce
/// format tel quel (`audio/aac`).
final class VoiceRecorder {
    /// Au-delà, l'enregistrement part comme si Robin avait relâché.
    static let maxDuration: TimeInterval = 120

    private static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 32_000,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?

    /// Demande le micro au premier appel, puis enregistre. `completion` sur la file principale.
    func start(completion: @escaping (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async { completion(granted && self.begin()) }
        }
    }

    private func begin() -> Bool {
        guard recorder == nil else { return true }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).aac")
        do {
            try AVAudioSession.sharedInstance().setCategory(.record, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            let recorder = try AVAudioRecorder(url: url, settings: Self.settings)
            if recorder.record() {
                self.recorder = recorder
                startedAt = Date()
                return true
            }
        } catch {}
        try? FileManager.default.removeItem(at: url)
        try? AVAudioSession.sharedInstance().setActive(false)
        return false
    }

    /// Arrête et rend le fichier avec sa durée, `nil` si rien n'enregistrait.
    func stop() -> (url: URL, duration: TimeInterval)? {
        guard let recorder, let startedAt else { return nil }
        recorder.stop()
        self.recorder = nil
        self.startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        return (recorder.url, Date().timeIntervalSince(startedAt))
    }
}
