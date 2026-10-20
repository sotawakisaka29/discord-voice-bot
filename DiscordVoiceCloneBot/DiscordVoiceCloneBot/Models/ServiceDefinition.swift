import Foundation

enum ManagedService: String, CaseIterable, Identifiable, Hashable {
    case discordBot
    case styleBertVITS2

    var id: String { rawValue }

    var title: String {
        switch self {
        case .discordBot: "Discord Bot"
        case .styleBertVITS2: "Style-Bert-VITS2"
        }
    }

    var subtitle: String {
        switch self {
        case .discordBot: "Discordへ接続し、読み上げを受け付けます"
        case .styleBertVITS2: "Style-Bert-VITS2 API（127.0.0.1:5000）"
        }
    }

    var symbol: String {
        switch self {
        case .discordBot: "bubble.left.fill"
        case .styleBertVITS2: "person.wave.2.fill"
        }
    }

}

enum ServiceRunState: Equatable {
    case stopped
    case starting
    case running
    case externalRunning
    case stopping
    case failed(String)

    var label: String {
        switch self {
        case .stopped: "停止中"
        case .starting: "起動中"
        case .running: "稼働中"
        case .externalRunning: "起動済み"
        case .stopping: "停止処理中"
        case .failed: "エラー"
        }
    }

    var isActive: Bool {
        switch self {
        case .starting, .running, .externalRunning, .stopping: true
        case .stopped, .failed: false
        }
    }

    var isExternallyManaged: Bool {
        self == .externalRunning
    }
}

struct ServiceLogEntry: Identifiable {
    let id = UUID()
    let date: Date
    let service: ManagedService
    let message: String
    let isError: Bool
}
