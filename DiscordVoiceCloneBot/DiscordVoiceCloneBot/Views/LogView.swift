import SwiftUI

struct LogView: View {
    @EnvironmentObject private var processManager: ProcessManager
    @State private var filter: ManagedService?

    private var filteredLogs: [ServiceLogEntry] {
        guard let filter else { return processManager.logs }
        return processManager.logs.filter { $0.service == filter }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("表示", selection: $filter) {
                    Text("すべて").tag(nil as ManagedService?)
                    ForEach(ManagedService.allCases) { service in
                        Text(service.title).tag(service as ManagedService?)
                    }
                }
                .frame(width: 220)
                Spacer()
                Button("消去", systemImage: "trash", role: .destructive) {
                    processManager.clearLogs()
                }
                .disabled(processManager.logs.isEmpty)
            }
            .padding()

            Divider()

            if filteredLogs.isEmpty {
                ContentUnavailableView("ログはありません", systemImage: "terminal")
            } else {
                ScrollViewReader { proxy in
                    List(filteredLogs) { entry in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(entry.date, format: .dateTime.hour().minute().second())
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                            Text(entry.service.title)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.indigo)
                                .frame(width: 130, alignment: .leading)
                            Text(entry.message)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(entry.isError ? .red : .primary)
                                .textSelection(.enabled)
                        }
                        .id(entry.id)
                    }
                    .onChange(of: processManager.logs.count) {
                        if let last = filteredLogs.last { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
        }
        .navigationTitle("実行ログ")
    }
}
