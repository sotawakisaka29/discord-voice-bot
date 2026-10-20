import SwiftUI

struct VoiceListView: View {
    @EnvironmentObject private var projectLocator: ProjectLocator
    @EnvironmentObject private var configuration: ConfigurationStore
    @State private var editingVoice: VoiceProfile?
    @State private var isAddingVoice = false
    @State private var deletingVoice: VoiceProfile?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("登録済みの声")
                        .font(.title2.bold())
                    if let defaultVoice = configuration.defaultVoice {
                        Text("\(configuration.voices.count)件 • デフォルト: \(defaultVoice.label) (\(defaultVoice.id))")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("登録された声はありません")
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button("再読み込み", systemImage: "arrow.clockwise") {
                    configuration.load(from: projectLocator.projectURL)
                }
                Button("声を追加", systemImage: "plus") { isAddingVoice = true }
                    .buttonStyle(.borderedProminent)
                    .disabled(!projectLocator.isValid)
            }
            .padding(24)

            Divider()

            if configuration.voices.isEmpty {
                ContentUnavailableView {
                    Label("声が登録されていません", systemImage: "waveform.slash")
                } description: {
                    Text("macOS標準音声または許可を得たクローン音声を追加してください。")
                } actions: {
                    Button("最初の声を追加") { isAddingVoice = true }
                }
            } else {
                List {
                    ForEach(configuration.voices) { voice in
                        voiceRow(voice)
                            .contextMenu {
                                Button("編集") { editingVoice = voice }
                                if configuration.defaultVoiceID != voice.id {
                                    Button("デフォルトに設定") { setDefault(voice) }
                                }
                                Divider()
                                Button("削除", role: .destructive) { deletingVoice = voice }
                            }
                    }
                }
                .listStyle(.inset)
            }

            if let notice = configuration.notice {
                HStack {
                    Label(notice, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Spacer()
                }
                .padding()
                .background(.green.opacity(0.08))
            }
        }
        .navigationTitle("声の管理")
        .onAppear {
            configuration.load(from: projectLocator.projectURL)
        }
        .sheet(isPresented: $isAddingVoice) {
            VoiceEditorView(profile: .empty, originalID: nil)
        }
        .sheet(item: $editingVoice) { voice in
            VoiceEditorView(profile: voice, originalID: voice.id)
        }
        .confirmationDialog(
            "「\(deletingVoice?.label ?? "")」を削除しますか？",
            isPresented: Binding(
                get: { deletingVoice != nil },
                set: { if !$0 { deletingVoice = nil } }
            )
        ) {
            Button("削除", role: .destructive) {
                guard let voice = deletingVoice else { return }
                do {
                    try configuration.deleteVoice(id: voice.id, from: projectLocator.projectURL)
                } catch {
                    errorMessage = error.localizedDescription
                }
                deletingVoice = nil
            }
            Button("キャンセル", role: .cancel) { deletingVoice = nil }
        } message: {
            Text("voices.jsonから削除されます。すでに起動中のBotには再起動後に反映されます。")
        }
        .alert("操作を完了できませんでした", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "不明なエラー")
        }
    }

    private func voiceRow(_ voice: VoiceProfile) -> some View {
        HStack(spacing: 15) {
            Image(systemName: voice.engine.symbol)
                .font(.title2)
                .foregroundStyle(.indigo)
                .frame(width: 44, height: 44)
                .background(.indigo.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(voice.label)
                        .font(.headline)
                    if configuration.defaultVoiceID == voice.id {
                        Text("デフォルト")
                            .font(.caption2.bold())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.indigo.opacity(0.12), in: Capsule())
                    }
                }
                HStack(spacing: 8) {
                    Text(voice.engine.label)
                    Text("•")
                    Text(voice.id)
                        .fontDesign(.monospaced)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if configuration.defaultVoiceID != voice.id {
                Button("デフォルト") { setDefault(voice) }
            }
            Button("編集") { editingVoice = voice }
            Button {
                deletingVoice = voice
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.red)
            .help("この声を削除")
        }
        .padding(.vertical, 8)
    }

    private func setDefault(_ voice: VoiceProfile) {
        do {
            try configuration.setDefaultVoice(id: voice.id, in: projectLocator.projectURL)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
