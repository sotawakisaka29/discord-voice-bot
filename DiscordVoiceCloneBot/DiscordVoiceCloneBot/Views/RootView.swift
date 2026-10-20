import SwiftUI

struct RootView: View {
    @EnvironmentObject private var projectLocator: ProjectLocator
    @State private var selectedSection: AppSection? = .dashboard

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $selectedSection) { section in
                Label(section.title, systemImage: section.symbol)
                    .tag(section)
                    .padding(.vertical, 4)
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 220)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(
                        projectLocator.isValid ? "プロジェクト接続済み" : "プロジェクト未設定",
                        systemImage: projectLocator.isValid ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
                    )
                    .foregroundStyle(projectLocator.isValid ? .green : .orange)
                    Text(projectLocator.projectURL.lastPathComponent)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
        } detail: {
            switch selectedSection ?? .dashboard {
            case .dashboard: DashboardView(selectedSection: $selectedSection)
            case .voices: VoiceListView()
            case .modelComparison: ModelComparisonView()
            case .settings: SettingsView()
            case .logs: LogView()
            }
        }
        .tint(.indigo)
    }
}

#Preview {
    RootView()
        .environmentObject(AppState())
        .environmentObject(ProjectLocator())
        .environmentObject(ConfigurationStore())
        .environmentObject(ProcessManager())
}
