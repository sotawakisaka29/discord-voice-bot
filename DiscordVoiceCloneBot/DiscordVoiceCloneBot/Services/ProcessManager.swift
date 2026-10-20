import Combine
import Darwin
import Foundation

private enum ServiceLaunchError: LocalizedError {
    case compatibleNodeNotFound

    var errorDescription: String? {
        switch self {
        case .compatibleNodeNotFound:
            "このMacで動作するNode.jsが見つかりません。VoiceBotフォルダの .runtime/node/bin/node、または /opt/homebrew/bin/node を確認してください。"
        }
    }
}

private struct DiscordBotHealth: Decodable {
    let service: String
    let projectPath: String
    let pid: Int
}

@MainActor
final class ProcessManager: ObservableObject, @unchecked Sendable {
    @Published private(set) var states: [ManagedService: ServiceRunState] = [:]
    @Published private(set) var logs: [ServiceLogEntry] = []
    private var processes: [ManagedService: Process] = [:]
    private var outputPipes: [ManagedService: [Pipe]] = [:]

    init() {
        for service in ManagedService.allCases { states[service] = .stopped }
    }

    func state(for service: ManagedService) -> ServiceRunState {
        states[service] ?? .stopped
    }

    var hasManagedActiveServices: Bool {
        ManagedService.allCases.contains {
            state(for: $0).isActive && !state(for: $0).isExternallyManaged
        }
    }

    func start(_ service: ManagedService, in projectURL: URL) {
        guard state(for: service).isActive == false else { return }
        guard FileManager.default.fileExists(atPath: projectURL.appending(path: "package.json").path) else {
            states[service] = .failed("プロジェクトが見つかりません")
            appendLog(service, "VoiceBotプロジェクトが見つかりません。", isError: true)
            return
        }

        states[service] = .starting

        if service == .styleBertVITS2 || service == .discordBot {
            Task { [weak self] in
                guard let self else { return }
                let isAlreadyRunning = switch service {
                case .discordBot:
                    await self.isDiscordBotAvailable(in: projectURL)
                case .styleBertVITS2:
                    await self.isStyleBertVITS2Available()
                }
                if isAlreadyRunning {
                    self.states[service] = .externalRunning
                    let message = service == .discordBot
                        ? "すでに起動しているDiscord Botを検出しました。"
                        : "すでに127.0.0.1:5000で起動しているサーバーを使用します。"
                    self.appendLog(service, message, isError: false)
                } else {
                    self.startManaged(service, in: projectURL)
                }
            }
            return
        }

        startManaged(service, in: projectURL)
    }

    func refreshServiceAvailability(in projectURL: URL) {
        Task { [weak self] in
            guard let self else { return }
            for service in ManagedService.allCases {
                guard self.processes[service] == nil,
                      self.state(for: service) != .starting,
                      self.state(for: service) != .stopping else { continue }

                let available = switch service {
                case .discordBot:
                    await self.isDiscordBotAvailable(in: projectURL)
                case .styleBertVITS2:
                    await self.isStyleBertVITS2Available()
                }
                if available {
                    self.states[service] = .externalRunning
                } else if self.state(for: service).isExternallyManaged {
                    self.states[service] = .stopped
                }
            }
        }
    }

    private func startManaged(_ service: ManagedService, in projectURL: URL) {
        appendLog(service, "起動しています…", isError: false)

        let launch: (executableURL: URL, arguments: [String])
        do {
            launch = try launchConfiguration(for: service, projectURL: projectURL)
        } catch {
            states[service] = .failed(error.localizedDescription)
            appendLog(service, "起動準備に失敗しました: \(error.localizedDescription)", isError: true)
            return
        }

        let process = Process()
        let standardOutput = Pipe()
        let standardError = Pipe()
        process.executableURL = launch.executableURL
        process.arguments = launch.arguments
        process.currentDirectoryURL = projectURL
        process.environment = serviceEnvironment(for: projectURL)
        process.standardOutput = standardOutput
        process.standardError = standardError

        observe(standardOutput, for: service, isError: false)
        observe(standardError, for: service, isError: true)
        outputPipes[service] = [standardOutput, standardError]

        process.terminationHandler = { [self] finishedProcess in
            Task { @MainActor [self] in
                self.outputPipes[service]?.forEach { $0.fileHandleForReading.readabilityHandler = nil }
                self.outputPipes[service] = nil
                self.processes[service] = nil
                let requestedStop = self.states[service] == .stopping
                if finishedProcess.terminationStatus == 0 || requestedStop {
                    self.states[service] = .stopped
                    self.appendLog(service, "停止しました。", isError: false)
                } else {
                    self.states[service] = .failed("終了コード \(finishedProcess.terminationStatus)")
                    self.appendLog(service, "異常終了しました（終了コード: \(finishedProcess.terminationStatus)）。", isError: true)
                }
            }
        }

        do {
            try process.run()
            processes[service] = process
            states[service] = .running
            appendLog(service, "プロセスを開始しました。", isError: false)
        } catch {
            states[service] = .failed(error.localizedDescription)
            appendLog(service, "起動できませんでした: \(error.localizedDescription)", isError: true)
        }
    }

    func stop(_ service: ManagedService, in projectURL: URL? = nil) {
        if state(for: service).isExternallyManaged {
            guard let projectURL else {
                appendLog(service, "外部プロセスの停止先を特定できません。", isError: true)
                return
            }
            switch service {
            case .discordBot:
                stopExternalDiscordBot(in: projectURL)
            case .styleBertVITS2:
                stopExternalStyleBertVITS2(in: projectURL)
            }
            return
        }
        guard let process = processes[service], process.isRunning else {
            states[service] = .stopped
            return
        }
        states[service] = .stopping
        appendLog(service, "停止しています…", isError: false)
        let childTerminator = Process()
        childTerminator.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        childTerminator.arguments = ["-TERM", "-P", String(process.processIdentifier)]
        try? childTerminator.run()
        process.terminate()
    }

    func toggle(_ service: ManagedService, in projectURL: URL) {
        state(for: service).isActive ? stop(service, in: projectURL) : start(service, in: projectURL)
    }

    func startRecommended(in projectURL: URL, engines: Set<VoiceEngine>) {
        if engines.contains(.styleBertVITS2) { start(.styleBertVITS2, in: projectURL) }
        start(.discordBot, in: projectURL)
    }

    func stopAll() {
        for service in ManagedService.allCases
        where state(for: service).isActive && !state(for: service).isExternallyManaged {
            stop(service)
        }
    }

    private func stopExternalDiscordBot(in projectURL: URL) {
        states[.discordBot] = .stopping
        appendLog(.discordBot, "外部で起動したDiscord Botを停止しています…", isError: false)

        Task { [weak self] in
            guard let self else { return }
            var processIDs = await Task.detached {
                Self.legacyDiscordBotProcessIDs(in: projectURL)
            }.value
            if let health = await self.discordBotHealth(),
               URL(fileURLWithPath: health.projectPath).standardizedFileURL
                == projectURL.standardizedFileURL,
               health.pid > 0,
               health.pid <= Int(Int32.max) {
                processIDs.append(pid_t(health.pid))
            }
            processIDs = Array(Set(processIDs))

            guard !processIDs.isEmpty else {
                self.states[.discordBot] = .externalRunning
                self.appendLog(
                    .discordBot,
                    "このVoiceBotプロジェクトから起動したBotを特定できないため、停止しませんでした。",
                    isError: true
                )
                return
            }

            for processID in processIDs {
                Darwin.kill(processID, SIGTERM)
            }
            try? await Task.sleep(for: .seconds(2))
            for processID in processIDs where Darwin.kill(processID, 0) == 0 {
                Darwin.kill(processID, SIGKILL)
            }

            for _ in 0..<10 {
                if !(await self.isDiscordBotAvailable(in: projectURL)) {
                    self.states[.discordBot] = .stopped
                    self.appendLog(.discordBot, "外部で起動したDiscord Botを停止しました。", isError: false)
                    return
                }
                try? await Task.sleep(for: .milliseconds(200))
            }

            self.states[.discordBot] = .externalRunning
            self.appendLog(.discordBot, "Discord Botの停止を確認できませんでした。", isError: true)
        }
    }

    private func stopExternalStyleBertVITS2(in projectURL: URL) {
        let serverScriptPath = projectURL
            .appending(path: "scripts/style_bert_vits2_server.py")
            .standardizedFileURL.path

        states[.styleBertVITS2] = .stopping
        appendLog(.styleBertVITS2, "外部で起動した音声サーバーを停止しています…", isError: false)

        Task { [weak self] in
            guard let self else { return }
            let processIDs = await Task.detached {
                Self.processIDs(matchingCommand: serverScriptPath)
            }.value

            guard !processIDs.isEmpty else {
                self.states[.styleBertVITS2] = .externalRunning
                self.appendLog(
                    .styleBertVITS2,
                    "このVoiceBotプロジェクトから起動したサーバーを特定できないため、停止しませんでした。",
                    isError: true
                )
                return
            }

            for processID in processIDs {
                Darwin.kill(processID, SIGTERM)
            }

            try? await Task.sleep(for: .seconds(2))
            for processID in processIDs where Darwin.kill(processID, 0) == 0 {
                Darwin.kill(processID, SIGKILL)
            }

            for _ in 0..<10 {
                if !(await self.isStyleBertVITS2Available()) {
                    self.states[.styleBertVITS2] = .stopped
                    self.appendLog(.styleBertVITS2, "外部で起動した音声サーバーを停止しました。", isError: false)
                    return
                }
                try? await Task.sleep(for: .milliseconds(200))
            }

            self.states[.styleBertVITS2] = .externalRunning
            self.appendLog(.styleBertVITS2, "音声サーバーの停止を確認できませんでした。", isError: true)
        }
    }

    nonisolated private static func processIDs(matchingCommand command: String) -> [pid_t] {
        processIDs(matchingPattern: NSRegularExpression.escapedPattern(for: command))
    }

    nonisolated private static func processIDs(matchingPattern pattern: String) -> [pid_t] {
        let process = Process()
        let standardOutput = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-f", pattern]
        process.standardOutput = standardOutput
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return []
        }

        let data = standardOutput.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0,
              let output = String(data: data, encoding: .utf8) else { return [] }
        return output
            .split(whereSeparator: \.isNewline)
            .compactMap { pid_t($0) }
    }

    nonisolated private static func legacyDiscordBotProcessIDs(in projectURL: URL) -> [pid_t] {
        processIDs(matchingPattern: "bot\\.js($| )").filter { processID in
            currentWorkingDirectory(of: processID) == projectURL.standardizedFileURL.path
        }
    }

    nonisolated private static func currentWorkingDirectory(of processID: pid_t) -> String? {
        let process = Process()
        let standardOutput = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-a", "-p", String(processID), "-d", "cwd", "-Fn"]
        process.standardOutput = standardOutput
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }

        let data = standardOutput.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0,
              let output = String(data: data, encoding: .utf8) else { return nil }
        return output
            .split(whereSeparator: \.isNewline)
            .first(where: { $0.first == "n" })
            .map { String($0.dropFirst()) }
    }

    func clearLogs() {
        logs.removeAll()
    }

    private func observe(_ pipe: Pipe, for service: ManagedService, isError: Bool) {
        pipe.fileHandleForReading.readabilityHandler = { [self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor [self] in
                self.appendLog(service, text, isError: isError)
            }
        }
    }

    private func launchConfiguration(
        for service: ManagedService,
        projectURL: URL
    ) throws -> (executableURL: URL, arguments: [String]) {
        switch service {
        case .discordBot:
            guard let nodeURL = workingNodeURL(in: projectURL) else {
                throw ServiceLaunchError.compatibleNodeNotFound
            }
            return (nodeURL, ["bot.js"])
        case .styleBertVITS2:
            return (URL(fileURLWithPath: "/bin/bash"), ["scripts/start-style-bert-vits2.sh"])
        }
    }

    private func workingNodeURL(in projectURL: URL) -> URL? {
        let candidates = [
            projectURL.appending(path: ".runtime/node/bin/node"),
            URL(fileURLWithPath: "/opt/homebrew/bin/node"),
            URL(fileURLWithPath: "/usr/local/bin/node")
        ]

        return candidates.first { candidate in
            guard FileManager.default.isExecutableFile(atPath: candidate.path) else { return false }
            let probe = Process()
            probe.executableURL = candidate
            probe.arguments = ["--version"]
            probe.standardOutput = Pipe()
            probe.standardError = Pipe()
            do {
                try probe.run()
                probe.waitUntilExit()
                return probe.terminationStatus == 0
            } catch {
                return false
            }
        }
    }

    private func isStyleBertVITS2Available() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:5000/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func discordBotHealth() async -> DiscordBotHealth? {
        guard let url = URL(string: "http://127.0.0.1:5001/health") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            let health = try JSONDecoder().decode(DiscordBotHealth.self, from: data)
            return health.service == "discord-voice-bot" ? health : nil
        } catch {
            return nil
        }
    }

    private func isDiscordBotAvailable(in projectURL: URL) async -> Bool {
        if await discordBotHealth() != nil { return true }
        return await Task.detached {
            !Self.legacyDiscordBotProcessIDs(in: projectURL).isEmpty
        }.value
    }

    private func serviceEnvironment(for projectURL: URL) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let currentPath = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        let preferredPaths = [
            "/opt/homebrew/bin",
            projectURL.appending(path: ".runtime/node/bin").path
        ]
        environment["PATH"] = (preferredPaths + [currentPath]).joined(separator: ":")
        return environment
    }

    private func appendLog(_ service: ManagedService, _ rawMessage: String, isError: Bool) {
        let messages = rawMessage
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .filter { !$0.isEmpty }
        for message in messages {
            let lowercased = message.lowercased()
            let errorIndicators = ["error", "traceback", "exception", "failed", "fatal"]
            let isActualError = isError
                && states[service] != .stopping
                && errorIndicators.contains(where: lowercased.contains)
            logs.append(ServiceLogEntry(date: Date(), service: service, message: message, isError: isActualError))
        }
        if logs.count > 2_000 { logs.removeFirst(logs.count - 2_000) }
    }
}
