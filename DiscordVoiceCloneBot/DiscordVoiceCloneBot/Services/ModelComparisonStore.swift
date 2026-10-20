import AVFoundation
import Combine
import Foundation

private enum ModelComparisonError: LocalizedError {
    case missingRequiredFile(String)
    case noCheckpoints
    case projectNotFound
    case pythonNotFound(String)
    case styleBertNotFound(String)
    case helperNotFound
    case generationFailed(String)

    var errorDescription: String? {
        switch self {
        case let .missingRequiredFile(filename):
            "選択したフォルダに \(filename) がありません。"
        case .noCheckpoints:
            "選択したフォルダに .safetensors モデルがありません。"
        case .projectNotFound:
            "VoiceBotプロジェクトが見つかりません。Bot設定を確認してください。"
        case let .pythonNotFound(path):
            "Style-Bert-VITS2用のPythonが見つかりません: \(path)"
        case let .styleBertNotFound(path):
            "Style-Bert-VITS2本体が見つかりません: \(path)"
        case .helperNotFound:
            "モデル比較用の処理ファイルが見つかりません。"
        case let .generationFailed(message):
            "比較音声を生成できませんでした。\n\(message)"
        }
    }
}

@MainActor
final class ModelComparisonStore: ObservableObject {
    @Published private(set) var modelFolderURL: URL?
    @Published private(set) var checkpoints: [ModelCheckpoint] = []
    @Published private(set) var generatedAudio: [String: URL] = [:]
    @Published private(set) var isGenerating = false
    @Published private(set) var statusMessage: String?
    @Published var errorMessage: String?
    @Published private(set) var playingCheckpointID: String?

    private var audioPlayer: AVAudioPlayer?
    private var playbackTask: Task<Void, Never>?

    func loadModelFolder(_ folderURL: URL) {
        stopPlayback()
        generatedAudio = [:]
        statusMessage = nil
        errorMessage = nil

        do {
            let fileManager = FileManager.default
            for filename in ["config.json", "style_vectors.npy"] {
                guard fileManager.fileExists(atPath: folderURL.appending(path: filename).path) else {
                    throw ModelComparisonError.missingRequiredFile(filename)
                }
            }

            let files = try fileManager.contentsOfDirectory(
                at: folderURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
            let discovered = files
                .filter { $0.pathExtension.lowercased() == "safetensors" }
                .map(Self.checkpoint(from:))
                .sorted(by: Self.compareCheckpoints)

            guard !discovered.isEmpty else { throw ModelComparisonError.noCheckpoints }
            modelFolderURL = folderURL
            checkpoints = discovered
            statusMessage = "\(discovered.count)個のチェックポイントを見つけました。"
        } catch {
            modelFolderURL = nil
            checkpoints = []
            errorMessage = error.localizedDescription
        }
    }

    func clearGeneratedAudio() {
        stopPlayback()
        generatedAudio = [:]
        if !checkpoints.isEmpty {
            statusMessage = "文章を変更しました。比較音声をもう一度生成してください。"
        }
    }

    func generateAll(text: String, projectURL: URL) {
        guard let modelFolderURL, !isGenerating else { return }
        stopPlayback()
        generatedAudio = [:]
        errorMessage = nil
        isGenerating = true
        statusMessage = "\(checkpoints.count)個のモデルで音声を生成しています…"

        let expectedCheckpoints = checkpoints
        Task {
            do {
                let outputDirectory = try await Task.detached(priority: .userInitiated) {
                    try Self.runComparison(
                        text: text,
                        modelFolderURL: modelFolderURL,
                        projectURL: projectURL
                    )
                }.value

                generatedAudio = Dictionary(uniqueKeysWithValues: expectedCheckpoints.compactMap { checkpoint in
                    let audioURL = outputDirectory.appending(path: "\(checkpoint.basename).wav")
                    guard FileManager.default.fileExists(atPath: audioURL.path) else { return nil }
                    return (checkpoint.id, audioURL)
                })
                statusMessage = "比較音声を\(generatedAudio.count)件生成しました。"
            } catch {
                errorMessage = error.localizedDescription
                statusMessage = nil
            }
            isGenerating = false
        }
    }

    func togglePlayback(for checkpoint: ModelCheckpoint) {
        guard let audioURL = generatedAudio[checkpoint.id] else { return }

        if playingCheckpointID == checkpoint.id, audioPlayer?.isPlaying == true {
            stopPlayback()
            return
        }

        stopPlayback()
        do {
            let player = try AVAudioPlayer(contentsOf: audioURL)
            player.prepareToPlay()
            player.play()
            audioPlayer = player
            playingCheckpointID = checkpoint.id

            let checkpointID = checkpoint.id
            playbackTask = Task { [weak self] in
                let nanoseconds = UInt64(max(player.duration, 0) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: nanoseconds)
                guard !Task.isCancelled, self?.playingCheckpointID == checkpointID else { return }
                self?.playingCheckpointID = nil
                self?.audioPlayer = nil
            }
        } catch {
            errorMessage = "音声を再生できませんでした: \(error.localizedDescription)"
        }
    }

    func stopPlayback() {
        playbackTask?.cancel()
        playbackTask = nil
        audioPlayer?.stop()
        audioPlayer = nil
        playingCheckpointID = nil
    }

    nonisolated private static func runComparison(
        text: String,
        modelFolderURL: URL,
        projectURL: URL
    ) throws -> URL {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: projectURL.appending(path: "package.json").path) else {
            throw ModelComparisonError.projectNotFound
        }

        let environment = ProcessInfo.processInfo.environment
        let homeDirectory = fileManager.homeDirectoryForCurrentUser
        let pythonURL = environment["STYLE_BERT_VITS2_PYTHON"].map(URL.init(fileURLWithPath:))
            ?? homeDirectory.appending(path: "miniforge3-arm64/envs/StyleBertVITS2/bin/python")
        let styleBertURL = environment["STYLE_BERT_VITS2_DIR"].map(URL.init(fileURLWithPath:))
            ?? homeDirectory.appending(path: "Desktop/開発/Style-Bert-VITS2")
        let helperURL = projectURL.appending(path: "scripts/compare_style_bert_models.py")

        guard fileManager.isExecutableFile(atPath: pythonURL.path) else {
            throw ModelComparisonError.pythonNotFound(pythonURL.path)
        }
        guard fileManager.fileExists(atPath: styleBertURL.path) else {
            throw ModelComparisonError.styleBertNotFound(styleBertURL.path)
        }
        guard fileManager.fileExists(atPath: helperURL.path) else {
            throw ModelComparisonError.helperNotFound
        }

        let comparisonRoot = fileManager.temporaryDirectory
            .appending(path: "DiscordVoiceCloneBot/model-comparisons", directoryHint: .isDirectory)
        try fileManager.createDirectory(at: comparisonRoot, withIntermediateDirectories: true)
        let outputDirectory = comparisonRoot.appending(path: UUID().uuidString, directoryHint: .isDirectory)

        let process = Process()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.executableURL = pythonURL
        process.arguments = [
            helperURL.path,
            "--style-bert-dir", styleBertURL.path,
            "--model-dir", modelFolderURL.path,
            "--output-dir", outputDirectory.path,
            "--text", text,
            "--device", environment["STYLE_BERT_VITS2_DEVICE"] ?? "cpu"
        ]
        process.currentDirectoryURL = projectURL
        process.environment = environment.merging(["PYTORCH_ENABLE_MPS_FALLBACK": "1"]) { _, new in new }
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        let standardOutput = String(
            data: outputPipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        let standardError = String(
            data: errorPipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        guard process.terminationStatus == 0 else {
            let details = standardError.isEmpty ? standardOutput : standardError
            throw ModelComparisonError.generationFailed(details.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        return outputDirectory
    }

    nonisolated private static func checkpoint(from fileURL: URL) -> ModelCheckpoint {
        let filename = fileURL.deletingPathExtension().lastPathComponent
        let epoch = firstCapture(in: filename, pattern: #"(?:^|_)e(\d+)(?:_|$)"#)
        let step = firstCapture(in: filename, pattern: #"(?:^|_)s(\d+)(?:_|$)"#)
        return ModelCheckpoint(fileURL: fileURL, step: step, epoch: epoch)
    }

    nonisolated private static func firstCapture(in value: String, pattern: String) -> Int? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(
                in: value,
                range: NSRange(value.startIndex..., in: value)
              ),
              let range = Range(match.range(at: 1), in: value) else { return nil }
        return Int(value[range])
    }

    nonisolated private static func compareCheckpoints(_ lhs: ModelCheckpoint, _ rhs: ModelCheckpoint) -> Bool {
        switch (lhs.step, rhs.step) {
        case let (.some(left), .some(right)) where left != right:
            return left < right
        case (.some, .none):
            return true
        case (.none, .some):
            return false
        default:
            return lhs.filename.localizedStandardCompare(rhs.filename) == .orderedAscending
        }
    }
}
