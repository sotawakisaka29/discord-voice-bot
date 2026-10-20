import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var projectLocator: ProjectLocator
    @EnvironmentObject private var configuration: ConfigurationStore
    @EnvironmentObject private var processManager: ProcessManager
    @Binding var selectedSection: AppSection?

    private var activeCount: Int {
        ManagedService.allCases.filter { processManager.state(for: $0).isActive }.count
    }

    private var usedEngines: Set<VoiceEngine> {
        Set(configuration.voices.map(\VoiceProfile.engine))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                header

                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("サービス")
                            .font(.title2.bold())
                        Text("必要な音声サーバーを先に起動してからBotを起動します。")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if !processManager.hasManagedActiveServices {
                        Button("必要なものを一括起動", systemImage: "play.fill") {
                            processManager.startRecommended(
                                in: projectLocator.projectURL,
                                engines: usedEngines
                            )
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!projectLocator.isValid)
                    } else {
                        Button("すべて停止", systemImage: "stop.fill", role: .destructive) {
                            processManager.stopAll()
                        }
                        .buttonStyle(.bordered)
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 235), spacing: 16)], spacing: 16) {
                    ForEach(ManagedService.allCases) { service in
                        ServiceCard(service: service, state: processManager.state(for: service)) {
                            processManager.toggle(service, in: projectLocator.projectURL)
                        }
                    }
                }

                recentActivity
            }
            .padding(30)
        }
        .navigationTitle("ホーム")
        .task {
            processManager.refreshServiceAvailability(in: projectLocator.projectURL)
        }
    }

    private var header: some View {
        HStack(spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 20)
                    .fill(.white.opacity(0.18))
                Image(systemName: "waveform.and.mic")
                    .font(.system(size: 34, weight: .semibold))
            }
            .frame(width: 72, height: 72)

            VStack(alignment: .leading, spacing: 6) {
                Text("VoiceBot コントロール")
                    .font(.largeTitle.bold())
                Text(activeCount == 0 ? "停止中です。準備ができたら起動してください。" : "\(activeCount)個のサービスが動いています。")
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.82))
            }
            Spacer()
        }
        .foregroundStyle(.white)
        .padding(24)
        .background(
            LinearGradient(colors: [.indigo, .purple.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 22)
        )
    }

    private var recentActivity: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("最近の動作")
                    .font(.title3.bold())
                Spacer()
                Button("ログをすべて見る") { selectedSection = .logs }
                    .buttonStyle(.link)
            }

            if processManager.logs.isEmpty {
                ContentUnavailableView(
                    "まだ実行履歴がありません",
                    systemImage: "clock",
                    description: Text("サービスを起動すると、ここに状態が表示されます。")
                )
                .frame(minHeight: 150)
            } else {
                VStack(spacing: 0) {
                    ForEach(processManager.logs.suffix(5).reversed()) { entry in
                        HStack(spacing: 12) {
                            Image(systemName: entry.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                                .foregroundStyle(entry.isError ? .red : .green)
                            Text(entry.service.title)
                                .font(.caption.weight(.semibold))
                                .frame(width: 125, alignment: .leading)
                            Text(entry.message)
                                .lineLimit(1)
                            Spacer()
                            Text(entry.date, style: .time)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 9)
                        if entry.id != processManager.logs.suffix(5).first?.id { Divider() }
                    }
                }
                .padding(.horizontal, 14)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}
