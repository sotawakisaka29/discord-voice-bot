import AppKit
import SwiftUI

struct ModelComparisonView: View {
    @EnvironmentObject private var projectLocator: ProjectLocator
    @StateObject private var store = ModelComparisonStore()
    @State private var selectedPrompt = ComparisonPrompt.presets[0]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                modelFolderSection
                promptSection
                checkpointsSection
            }
            .padding(30)
        }
        .navigationTitle("モデル聴き比べ")
        .onDisappear { store.stopPlayback() }
        .alert("モデル聴き比べ", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("OK") { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "不明なエラー")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("チェックポイントを同じ文章で比較", systemImage: "speaker.wave.2.circle.fill")
                .font(.title2.bold())
            Text("学習結果のフォルダを選ぶと、含まれるすべてのモデルから比較用音声を生成します。config.json、style_vectors.npy、複数のsafetensorsを同じフォルダに置いてください。")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(.indigo.opacity(0.1), in: RoundedRectangle(cornerRadius: 18))
    }

    private var modelFolderSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("1. 学習結果フォルダ")
                .font(.title3.bold())

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.modelFolderURL?.lastPathComponent ?? "未選択")
                        .font(.headline)
                    Text(store.modelFolderURL?.path ?? "Google DriveからダウンロードしたTeffyフォルダなどを選択します。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
                Spacer()
                Button("フォルダを選択…", systemImage: "folder") { chooseModelFolder() }
                    .disabled(store.isGenerating)
            }
            .padding(16)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("2. 定型文")
                .font(.title3.bold())

            Picker("定型文", selection: $selectedPrompt) {
                ForEach(ComparisonPrompt.presets) { prompt in
                    Text(prompt.title).tag(prompt)
                }
            }
            .pickerStyle(.segmented)
            .disabled(store.isGenerating)
            .onChange(of: selectedPrompt) { _, _ in store.clearGeneratedAudio() }

            Text(selectedPrompt.text)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, minHeight: 54, alignment: .topLeading)
                .padding(14)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))

            HStack {
                if store.isGenerating {
                    ProgressView()
                        .controlSize(.small)
                    Text(store.statusMessage ?? "生成しています…")
                        .foregroundStyle(.secondary)
                } else if let statusMessage = store.statusMessage {
                    Label(statusMessage, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("全モデルで生成", systemImage: "waveform.badge.plus") {
                    store.generateAll(text: selectedPrompt.text, projectURL: projectLocator.projectURL)
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.checkpoints.isEmpty || store.isGenerating || !projectLocator.isValid)
            }
        }
    }

    private var checkpointsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("3. 聴き比べ")
                .font(.title3.bold())

            if store.checkpoints.isEmpty {
                ContentUnavailableView(
                    "モデルフォルダを選択してください",
                    systemImage: "waveform.badge.magnifyingglass",
                    description: Text("検出したチェックポイントがここに並びます。")
                )
                .frame(minHeight: 180)
            } else {
                VStack(spacing: 0) {
                    ForEach(store.checkpoints) { checkpoint in
                        HStack(spacing: 14) {
                            Image(systemName: "waveform")
                                .foregroundStyle(.indigo)
                                .frame(width: 26)

                            VStack(alignment: .leading, spacing: 3) {
                                Text(checkpoint.filename)
                                    .font(.body.weight(.medium))
                                if let label = checkpoint.trainingLabel {
                                    Text(label)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()

                            if store.generatedAudio[checkpoint.id] != nil {
                                Button(
                                    store.playingCheckpointID == checkpoint.id ? "停止" : "再生",
                                    systemImage: store.playingCheckpointID == checkpoint.id ? "stop.fill" : "play.fill"
                                ) {
                                    store.togglePlayback(for: checkpoint)
                                }
                                .buttonStyle(.bordered)
                            } else {
                                Text(store.isGenerating ? "生成中" : "未生成")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        if checkpoint.id != store.checkpoints.last?.id { Divider() }
                    }
                }
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private func chooseModelFolder() {
        let panel = NSOpenPanel()
        panel.title = "学習結果フォルダを選択"
        panel.prompt = "選択"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let folderURL = panel.url {
            store.loadModelFolder(folderURL)
        }
    }
}

#Preview {
    ModelComparisonView()
        .environmentObject(ProjectLocator())
        .frame(width: 900, height: 700)
}
