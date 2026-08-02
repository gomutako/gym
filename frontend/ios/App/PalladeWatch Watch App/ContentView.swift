import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @State private var error: String?

    /// Il messaggio di un salvataggio fallito vive in `workout.state`, non in
    /// `error`: senza intercettarlo qui, `.failed` cade nel `default` dello
    /// switch e l'utente torna al picker credendo che l'allenamento sia
    /// stato salvato in Salute quando non lo è.
    private var savedFailureMessage: String? {
        if case .failed(let message) = workout.state { return message }
        return nil
    }

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
                    if let message = savedFailureMessage ?? error {
                        Text(message).font(.caption2).foregroundStyle(.red)
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
