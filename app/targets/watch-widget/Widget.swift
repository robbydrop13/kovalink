import SwiftUI
import WidgetKit

/// Les nombres du cadran : `[asks, errors, ended, oldestAt]`, écrits par l'app montre dans
/// les defaults de l'App Group. `oldestAt` est la seconde epoch de la plus ancienne attente,
/// 0 quand il n'y en a pas. Jamais un mot du contenu.
struct Counts: Equatable {
    var asks: Int
    var errors: Int
    var ended: Int
    var oldestAt: Int

    static let empty = Counts(asks: 0, errors: 0, ended: 0, oldestAt: 0)

    /// Aperçu de la galerie : des nombres crédibles, datés d'il y a 4 minutes.
    static var sample: Counts {
        Counts(asks: 3, errors: 1, ended: 2, oldestAt: Int(Date().timeIntervalSince1970) - 4 * 60)
    }
}

enum CountsStore {
    static let suite = "group.io.claap.kovalink"
    static let key = "watch.counts"

    static func load() -> Counts {
        let defaults = UserDefaults(suiteName: suite) ?? .standard
        guard let raw = defaults.array(forKey: key) as? [Int], raw.count == 4 else { return .empty }
        return Counts(asks: raw[0], errors: raw[1], ended: raw[2], oldestAt: raw[3])
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let counts: Counts
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, counts: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, counts: context.isPreview ? .sample : CountsStore.load()))
    }

    /// Une entrée, puis WidgetKit redemande dans 15 min. Les nombres bougent au rythme des
    /// pushes de l'iPhone, pas besoin de plus fin.
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let entry = Entry(date: .now, counts: CountsStore.load())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
}

struct KovaLinkWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    private var counts: Counts { entry.counts }

    var body: some View {
        content.containerBackground(for: .widget) { Color.clear }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryRectangular: rectangular
        case .accessoryCircular: circular
        default: inline
        }
    }

    /// Grand nombre, « asks » dessous. Sans attente : « ! » avec le nombre d'erreurs, ou une
    /// coche quand tout est calme.
    private var circular: some View {
        Group {
            if counts.asks > 0 {
                VStack(spacing: -1) {
                    Text(verbatim: "\(counts.asks)")
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                        .minimumScaleFactor(0.5)
                        .foregroundStyle(DS.accent)
                    Text("asks")
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                }
            } else if counts.errors > 0 {
                VStack(spacing: -2) {
                    Text(verbatim: "!")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                    Text(verbatim: "\(counts.errors)")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                }
                .foregroundStyle(DS.crit)
            } else {
                Image(systemName: "checkmark")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(DS.ok)
            }
        }
        .padding(4)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("KovaLink")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .widgetAccentable()
            Text(verbatim: asksLine)
                .font(.system(size: 13, weight: .medium, design: .rounded))
            if counts.errors > 0 {
                Text(verbatim: counts.errors == 1 ? "1 error" : "\(counts.errors) errors")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(DS.crit)
            } else if counts.ended > 0 {
                Text(verbatim: "\(counts.ended) ended")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var inline: some View {
        Text(verbatim: "\(counts.asks) asks")
            .font(.system(size: 13, weight: .semibold, design: .rounded))
    }

    private var asksLine: String {
        guard counts.asks > 0 else { return "0 asks" }
        guard counts.oldestAt > 0 else { return "\(counts.asks) asks" }
        return "\(counts.asks) asks · oldest \(Self.age(since: counts.oldestAt))"
    }

    /// « 4m », « 2h », « 1d », « now » sous la minute.
    static func age(since epoch: Int, now: Date = .now) -> String {
        let seconds = max(0, Int(now.timeIntervalSince1970) - epoch)
        switch seconds {
        case ..<60: return "now"
        case ..<3_600: return "\(seconds / 60)m"
        case ..<86_400: return "\(seconds / 3_600)h"
        default: return "\(seconds / 86_400)d"
        }
    }
}

@main
struct KovaLinkWatchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KovaLinkWatchWidget", provider: Provider()) { entry in
            KovaLinkWidgetView(entry: entry)
        }
        .configurationDisplayName("KovaLink")
        .description("Asks, errors and ended sessions.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner, .accessoryInline])
    }
}
