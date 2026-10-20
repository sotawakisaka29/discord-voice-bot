import SwiftUI

struct ServiceCard: View {
    let service: ManagedService
    let state: ServiceRunState
    let action: () -> Void

    private var statusColor: Color {
        switch state {
        case .running, .externalRunning: .green
        case .starting, .stopping: .orange
        case .failed: .red
        case .stopped: .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                Image(systemName: service.symbol)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.indigo)
                    .frame(width: 44, height: 44)
                    .background(.indigo.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                Spacer()
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                    Text(state.label)
                        .font(.caption.weight(.medium))
                }
                .foregroundStyle(statusColor)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(service.title)
                    .font(.headline)
                Text(service.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Button(action: action) {
                Label(
                    state.isExternallyManaged ? "強制停止" : (state.isActive ? "停止" : "起動"),
                    systemImage: state.isActive ? "stop.fill" : "play.fill"
                )
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(state.isActive ? .red : .indigo)
            .disabled(state == .starting || state == .stopping)
        }
        .padding(18)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(.separator.opacity(0.45), lineWidth: 1)
        }
    }
}
