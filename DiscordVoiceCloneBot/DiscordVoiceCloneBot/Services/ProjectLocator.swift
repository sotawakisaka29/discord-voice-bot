import AppKit
import Combine
import Foundation

@MainActor
final class ProjectLocator: ObservableObject {
    @Published private(set) var projectURL: URL

    init() {
        if let savedPath = UserDefaults.standard.string(forKey: "voiceBotProjectPath") {
            projectURL = URL(fileURLWithPath: savedPath, isDirectory: true)
        } else {
            projectURL = FileManager.default.homeDirectoryForCurrentUser
                .appending(path: "Desktop/開発/discord-voice-bot", directoryHint: .isDirectory)
        }
    }

    var isValid: Bool {
        FileManager.default.fileExists(atPath: projectURL.appending(path: "package.json").path)
            && FileManager.default.fileExists(atPath: projectURL.appending(path: "bot.js").path)
    }

    func chooseProjectFolder() {
        let panel = NSOpenPanel()
        panel.title = "VoiceBotのフォルダを選択"
        panel.message = "package.json と bot.js があるフォルダを選んでください。"
        panel.prompt = "このフォルダを使う"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = projectURL

        guard panel.runModal() == .OK, let url = panel.url else { return }
        projectURL = url
        UserDefaults.standard.set(url.path, forKey: "voiceBotProjectPath")
    }
}
