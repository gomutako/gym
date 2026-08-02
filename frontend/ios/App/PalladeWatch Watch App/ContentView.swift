import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @State private var error: String?

    var body: some View {
        Group {
            switch workout.state {
            case .running:
                VStack(spacing: 4) {
                    Text(workout.heartRate.map { "\($0)" } ?? "—")
                        .font(.system(size: 44, weight: .semibold, design: .rounded))
                    Text("bpm").font(.caption2).foregroundStyle(.secondary)
                    Text(workout.activeKcal.map { String(format: "%.0f kcal", $0) } ?? "— kcal")
                        .font(.caption2).foregroundStyle(.secondary)
                    Button("Termina") { Task { await workout.end() } }
                }
            default:
                PickerView { _, _ in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        do { try await workout.start() }
                        catch { self.error = error.localizedDescription }
                    }
                }
                .overlay(alignment: .bottom) {
                    if let error {
                        Text(error).font(.caption2).foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
            }
        }
        .onAppear {
            PhoneLink.shared.onMessage = { CatalogStore.shared.apply($0) }
            PhoneLink.shared.activate()
        }
    }
}
