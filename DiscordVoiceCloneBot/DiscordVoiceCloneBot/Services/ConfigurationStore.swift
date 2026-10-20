import Combine
import Foundation

enum ConfigurationError: LocalizedError {
    case projectNotFound
    case missingGuildID
    case invalidGuildID(String)
    case duplicateGuildID
    case invalidVoiceID
    case duplicateVoiceID
    case invalidLocalURL
    case missingRequiredField(String)

    var errorDescription: String? {
        switch self {
        case .projectNotFound: "VoiceBotプロジェクトが見つかりません。Bot設定でフォルダを選択してください。"
        case .missingGuildID: "サーバーIDを1つ以上入力してください。"
        case .invalidGuildID(let value): "サーバーID「\(value)」は半角数字だけで入力してください。"
        case .duplicateGuildID: "同じサーバーIDが複数入力されています。"
        case .invalidVoiceID: "声のIDは半角英数字、小文字、ハイフン、アンダースコアだけで入力してください。"
        case .duplicateVoiceID: "同じIDの声がすでに登録されています。"
        case .invalidLocalURL: "API URLには localhost、127.0.0.1、または ::1 を指定してください。"
        case .missingRequiredField(let field): "「\(field)」を入力してください。"
        }
    }
}

struct DiscordGuildEntry: Identifiable {
    let id = UUID()
    var value: String
}

@MainActor
final class ConfigurationStore: ObservableObject {
    @Published var discordBotToken = ""
    @Published var discordGuilds = [DiscordGuildEntry(value: "")]
    @Published private(set) var voices: [VoiceProfile] = []
    @Published private(set) var defaultVoiceID: String?
    @Published private(set) var styleBertModels: [StyleBertModel] = []
    @Published private(set) var defaultStyleBertModelID: String?
    @Published private(set) var notice: String?

    var defaultVoice: VoiceProfile? {
        guard let defaultVoiceID else { return voices.first }
        return voices.first(where: { $0.id == defaultVoiceID }) ?? voices.first
    }

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()

    func load(from projectURL: URL) {
        notice = nil
        loadEnvironment(from: projectURL.appending(path: ".env"))
        loadStyleBertModels(from: projectURL.appending(path: "style-bert-vits2-models.json"))
        do {
            let data = try Data(contentsOf: projectURL.appending(path: "voices.json"))
            let catalog = try JSONDecoder().decode(VoiceCatalog.self, from: data)
            voices = catalog.voices
            defaultVoiceID = catalog.defaultVoiceId.flatMap { requestedID in
                voices.contains(where: { $0.id == requestedID }) ? requestedID : nil
            } ?? voices.first?.id
        } catch {
            voices = []
            defaultVoiceID = nil
            notice = "声の設定を読み込めませんでした: \(error.localizedDescription)"
        }
    }

    private func loadStyleBertModels(from url: URL) {
        do {
            let data = try Data(contentsOf: url)
            let catalog = try JSONDecoder().decode(StyleBertModelCatalog.self, from: data)
            styleBertModels = catalog.models.map { id, definition in
                StyleBertModel(
                    id: id,
                    modelDirectory: definition.modelDir,
                    modelFile: definition.modelFile
                )
            }
            .sorted { $0.id.localizedStandardCompare($1.id) == .orderedAscending }
            defaultStyleBertModelID = styleBertModels.contains(where: { $0.id == catalog.defaultModelId })
                ? catalog.defaultModelId
                : styleBertModels.first?.id
        } catch {
            styleBertModels = []
            defaultStyleBertModelID = nil
            notice = "Style-Bert-VITS2のモデル設定を読み込めませんでした: \(error.localizedDescription)"
        }
    }

    func saveEnvironment(to projectURL: URL) throws {
        guard FileManager.default.fileExists(atPath: projectURL.path) else {
            throw ConfigurationError.projectNotFound
        }
        let envURL = projectURL.appending(path: ".env")
        let existing = (try? String(contentsOf: envURL, encoding: .utf8)) ?? ""
        var lines = existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let guildIDs = try validatedGuildIDs()
        updateEnvironmentLine(name: "DISCORD_BOT_TOKEN", value: discordBotToken, lines: &lines)
        updateEnvironmentLine(name: "DISCORD_GUILD_IDS", value: guildIDs.joined(separator: ","), lines: &lines)
        removeEnvironmentLine(name: "DISCORD_GUILD_ID", lines: &lines)
        let output = lines.joined(separator: "\n").trimmingCharacters(in: .newlines) + "\n"
        try output.write(to: envURL, atomically: true, encoding: .utf8)
        discordGuilds = guildIDs.map { DiscordGuildEntry(value: $0) }
        notice = "Discord設定（サーバー\(guildIDs.count)件）を保存しました。次回のBot起動から反映されます。"
    }

    func addDiscordGuild() {
        discordGuilds.append(DiscordGuildEntry(value: ""))
    }

    func removeDiscordGuild(id: UUID) {
        discordGuilds.removeAll { $0.id == id }
        if discordGuilds.isEmpty {
            discordGuilds = [DiscordGuildEntry(value: "")]
        }
    }

    func saveVoice(_ profile: VoiceProfile, replacing originalID: String?, to projectURL: URL) throws {
        let profile = normalized(profile)
        try validate(profile, originalID: originalID)
        if let originalID, let index = voices.firstIndex(where: { $0.id == originalID }) {
            voices[index] = profile
            if defaultVoiceID == originalID { defaultVoiceID = profile.id }
        } else {
            voices.append(profile)
        }
        try saveVoices(to: projectURL)
        notice = originalID == nil ? "声を追加しました。Botを再起動すると反映されます。" : "声の設定を更新しました。Botを再起動すると反映されます。"
    }

    func deleteVoice(id: String, from projectURL: URL) throws {
        voices.removeAll { $0.id == id }
        if defaultVoiceID == id { defaultVoiceID = voices.first?.id }
        try saveVoices(to: projectURL)
        notice = "声を削除しました。Botを再起動すると反映されます。"
    }

    func setDefaultVoice(id: String, in projectURL: URL) throws {
        guard voices.contains(where: { $0.id == id }) else { throw ConfigurationError.invalidVoiceID }
        defaultVoiceID = id
        try saveVoices(to: projectURL)
        notice = "デフォルトの声を変更しました。Botを再起動すると反映されます。"
    }

    private func loadEnvironment(from url: URL) {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
            discordBotToken = ""
            discordGuilds = [DiscordGuildEntry(value: "")]
            return
        }
        var values: [String: String] = [:]
        for line in contents.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 { values[parts[0]] = parts[1] }
        }
        discordBotToken = values["DISCORD_BOT_TOKEN"] ?? ""
        let guildValue = values["DISCORD_GUILD_IDS"] ?? values["DISCORD_GUILD_ID"] ?? ""
        let guildIDs = guildValue
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        discordGuilds = guildIDs.isEmpty
            ? [DiscordGuildEntry(value: "")]
            : guildIDs.map { DiscordGuildEntry(value: $0) }
    }

    private func updateEnvironmentLine(name: String, value: String, lines: inout [String]) {
        let safeValue = value.replacingOccurrences(of: "\n", with: "")
        if let index = lines.firstIndex(where: { $0.hasPrefix("\(name)=") }) {
            lines[index] = "\(name)=\(safeValue)"
        } else {
            lines.append("\(name)=\(safeValue)")
        }
    }

    private func removeEnvironmentLine(name: String, lines: inout [String]) {
        lines.removeAll { $0.hasPrefix("\(name)=") }
    }

    private func validatedGuildIDs() throws -> [String] {
        let guildIDs = discordGuilds
            .map { $0.value.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !guildIDs.isEmpty else { throw ConfigurationError.missingGuildID }
        for guildID in guildIDs where guildID.range(of: #"^\d+$"#, options: .regularExpression) == nil {
            throw ConfigurationError.invalidGuildID(guildID)
        }
        guard Set(guildIDs).count == guildIDs.count else { throw ConfigurationError.duplicateGuildID }
        return guildIDs
    }

    private func validate(_ profile: VoiceProfile, originalID: String?) throws {
        let idPattern = #"^[a-z0-9][a-z0-9_-]*$"#
        guard profile.id.range(of: idPattern, options: .regularExpression) != nil else {
            throw ConfigurationError.invalidVoiceID
        }
        guard !profile.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConfigurationError.missingRequiredField("表示名")
        }
        guard !voices.contains(where: { $0.id == profile.id && $0.id != originalID }) else {
            throw ConfigurationError.duplicateVoiceID
        }

        switch profile.engine {
        case .macOS:
            guard !(profile.macosVoice ?? "").isEmpty else { throw ConfigurationError.missingRequiredField("macOS音声ID") }
        case .styleBertVITS2:
            try validateLocalURL(profile.apiUrl)
            guard !(profile.modelId ?? "").isEmpty else { throw ConfigurationError.missingRequiredField("モデルID") }
        }
    }

    private func normalized(_ source: VoiceProfile) -> VoiceProfile {
        var profile = source
        profile.id = profile.id.trimmingCharacters(in: .whitespacesAndNewlines)
        profile.label = profile.label.trimmingCharacters(in: .whitespacesAndNewlines)
        switch profile.engine {
        case .macOS:
            profile.apiUrl = nil
            profile.modelId = nil
        case .styleBertVITS2:
            profile.macosVoice = nil
        }
        return profile
    }

    private func validateLocalURL(_ value: String?) throws {
        guard let value, let url = URL(string: value), let host = url.host,
              ["127.0.0.1", "localhost", "::1"].contains(host) else {
            throw ConfigurationError.invalidLocalURL
        }
    }

    private func saveVoices(to projectURL: URL) throws {
        let data = try encoder.encode(VoiceCatalog(defaultVoiceId: defaultVoiceID, voices: voices))
        try data.write(to: projectURL.appending(path: "voices.json"), options: .atomic)
    }
}
