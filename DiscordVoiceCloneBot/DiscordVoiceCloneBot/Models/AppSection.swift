import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard
    case voices
    case modelComparison
    case settings
    case logs

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "ホーム"
        case .voices: "声の管理"
        case .modelComparison: "モデル聴き比べ"
        case .settings: "Bot設定"
        case .logs: "実行ログ"
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: "rectangle.grid.2x2.fill"
        case .voices: "waveform.circle.fill"
        case .modelComparison: "speaker.wave.2.circle.fill"
        case .settings: "gearshape.fill"
        case .logs: "terminal.fill"
        }
    }
}
