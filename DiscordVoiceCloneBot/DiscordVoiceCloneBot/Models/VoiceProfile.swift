import Foundation

enum VoiceEngine: String, Codable, CaseIterable, Identifiable {
    case macOS = "macos"
    case styleBertVITS2 = "style-bert-vits2"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .macOS: "macOS標準音声"
        case .styleBertVITS2: "Style-Bert-VITS2"
        }
    }

    var symbol: String {
        switch self {
        case .macOS: "apple.logo"
        case .styleBertVITS2: "person.wave.2"
        }
    }
}

struct VoiceProfile: Codable, Identifiable, Equatable {
    var id: String
    var label: String
    var engine: VoiceEngine
    var macosVoice: String?
    var apiUrl: String?
    var modelId: String?

    static var empty: VoiceProfile {
        VoiceProfile(
            id: "",
            label: "",
            engine: .macOS,
            macosVoice: "com.apple.voice.compact.ja-JP.Kyoko"
        )
    }
}

struct VoiceCatalog: Codable {
    var defaultVoiceId: String?
    var voices: [VoiceProfile]
}
