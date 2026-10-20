import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var projectLocator: ProjectLocator
    @EnvironmentObject private var configuration: ConfigurationStore
    @State private var errorMessage: String?
    @State private var showToken = false

    var body: some View {
        Form {
            Section("VoiceBotプロジェクト") {
                LabeledContent("フォルダ") {
                    HStack {
                    Text(projectLocator.projectURL.path)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .foregroundStyle(.secondary)
                        Button("選択…") { appState.chooseProjectFolder() }
                    }
                }
                if !projectLocator.isValid {
                    Label("package.json と bot.js が見つかりません。", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }

            Section("Discord") {
                LabeledContent("Botトークン") {
                    HStack {
                        Group {
                            if showToken {
                                TextField("Discord Bot Token", text: $configuration.discordBotToken)
                            } else {
                                SecureField("Discord Bot Token", text: $configuration.discordBotToken)
                            }
                        }
                        .textFieldStyle(.roundedBorder)
                        Button {
                            showToken.toggle()
                        } label: {
                            Image(systemName: showToken ? "eye.slash" : "eye")
                        }
                        .help(showToken ? "トークンを隠す" : "トークンを表示")
                    }
                    .frame(maxWidth: 380)
                }
                LabeledContent("対象サーバー") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach($configuration.discordGuilds) { $guild in
                            HStack(spacing: 8) {
                                TextField("サーバーID（半角数字）", text: $guild.value)
                                    .textFieldStyle(.roundedBorder)

                                Button {
                                    configuration.removeDiscordGuild(id: guild.id)
                                } label: {
                                    Image(systemName: "minus.circle.fill")
                                        .foregroundStyle(.red)
                                }
                                .buttonStyle(.plain)
                                .help("このサーバーを削除")
                            }
                        }

                        Button("サーバーを追加", systemImage: "plus.circle") {
                            configuration.addDiscordGuild()
                        }
                        .buttonStyle(.borderless)
                    }
                    .frame(maxWidth: 380)
                }
                Text("Botを使うDiscordサーバーを1件ずつ入力します。サーバーIDはDiscordの開発者モードでサーバーを右クリックするとコピーできます。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("トークンは選択したプロジェクトの .env にだけ保存されます。ログには表示しません。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                HStack {
                    if let notice = configuration.notice {
                        Label(notice, systemImage: "checkmark.circle.fill")
                            .font(.callout)
                            .foregroundStyle(.green)
                    }
                    Spacer()
                    Button("再読み込み") { appState.reloadConfiguration() }
                    Button("設定を保存") {
                        do {
                            try configuration.saveEnvironment(to: projectLocator.projectURL)
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!projectLocator.isValid)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Bot設定")
        .alert("設定を保存できませんでした", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "不明なエラー")
        }
    }
}
