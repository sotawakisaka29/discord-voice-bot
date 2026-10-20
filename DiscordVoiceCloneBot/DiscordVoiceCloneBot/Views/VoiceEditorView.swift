import SwiftUI

struct VoiceEditorView: View {
    @EnvironmentObject private var projectLocator: ProjectLocator
    @EnvironmentObject private var configuration: ConfigurationStore
    @Environment(\.dismiss) private var dismiss
    @State private var profile: VoiceProfile
    @State private var hasVoicePermission = false
    @State private var errorMessage: String?
    let originalID: String?

    init(profile: VoiceProfile, originalID: String?) {
        _profile = State(initialValue: profile)
        self.originalID = originalID
        _hasVoicePermission = State(initialValue: originalID != nil)
    }

    private var requiresConsent: Bool { profile.engine != .macOS }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本情報") {
                    TextField("表示名", text: $profile.label, prompt: Text("例：自分の声"))
                    TextField("声のID", text: $profile.id, prompt: Text("例：my-voice"))
                    Text("IDには半角小文字、数字、ハイフン、アンダースコアが使えます。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("音声エンジン", selection: $profile.engine) {
                        ForEach(VoiceEngine.allCases) { engine in
                            Label(engine.label, systemImage: engine.symbol).tag(engine)
                        }
                    }
                }

                engineSettings

                if requiresConsent {
                    Section("音声の利用許可") {
                        Toggle("この声は自分の声、または本人からクローン作成と利用の明確な許可を得た声です", isOn: $hasVoicePermission)
                        Text("参照音声やモデルはMac内に置かれ、このアプリから外部へアップロードされません。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(originalID == nil ? "声を追加" : "声を編集")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .buttonStyle(.borderedProminent)
                        .disabled(requiresConsent && !hasVoicePermission)
                }
            }
        }
        .frame(width: 620, height: 590)
        .alert("声を保存できませんでした", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "不明なエラー")
        }
        .onChange(of: profile.engine) { _, engine in
            applyDefaults(for: engine)
        }
    }

    @ViewBuilder
    private var engineSettings: some View {
        switch profile.engine {
        case .macOS:
            Section("macOS標準音声") {
                TextField(
                    "音声ID",
                    text: optionalBinding(\.macosVoice),
                    prompt: Text("com.apple.voice.compact.ja-JP.Kyoko")
                )
                Text("Macにインストール済みの音声識別子を指定します。音声サーバーは不要です。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .styleBertVITS2:
            Section("Style-Bert-VITS2") {
                TextField("API URL", text: optionalBinding(\.apiUrl))
                if configuration.styleBertModels.isEmpty {
                    LabeledContent("モデル") {
                        Text("利用可能なモデルがありません")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Picker("モデル", selection: optionalBinding(\.modelId)) {
                        if let modelID = profile.modelId,
                           !modelID.isEmpty,
                           !configuration.styleBertModels.contains(where: { $0.id == modelID }) {
                            Text("\(modelID)（設定にありません）").tag(modelID)
                        }
                        ForEach(configuration.styleBertModels) { model in
                            VStack(alignment: .leading) {
                                Text(model.id)
                                Text(model.modelFile)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .tag(model.id)
                        }
                    }
                }
                Text("style-bert-vits2-models.json に登録されたモデルから選択します。APIはこのMac内のアドレスだけを登録できます。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func optionalBinding(_ keyPath: WritableKeyPath<VoiceProfile, String?>) -> Binding<String> {
        Binding(
            get: { profile[keyPath: keyPath] ?? "" },
            set: { profile[keyPath: keyPath] = $0.isEmpty ? nil : $0 }
        )
    }

    private func applyDefaults(for engine: VoiceEngine) {
        switch engine {
        case .macOS:
            if profile.macosVoice == nil { profile.macosVoice = "com.apple.voice.compact.ja-JP.Kyoko" }
        case .styleBertVITS2:
            if profile.apiUrl == nil {
                profile.apiUrl = "http://127.0.0.1:5000/tts"
            }
            if profile.modelId == nil {
                profile.modelId = configuration.defaultStyleBertModelID
            }
        }
    }

    private func save() {
        do {
            try configuration.saveVoice(
                profile,
                replacing: originalID,
                to: projectLocator.projectURL
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
