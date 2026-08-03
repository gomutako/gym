import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @StateObject private var store = SessionStore.shared
    @State private var error: String?

    var body: some View {
        Group {
            if workout.state == .running, store.session != nil {
                ExecutionView {
                    Task {
                        await workout.end()
                        store.close()
                    }
                }
            } else {
                PickerView { w, d in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        _ = store.begin(workout: w, day: d)
                        do { try await workout.start() }
                        catch {
                            store.close()
                            self.error = error.localizedDescription
                        }
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
            PhoneLink.shared.onMessage = { msg in
                if CatalogStore.shared.apply(msg) { return }
                Task { @MainActor in SessionStore.shared.apply(msg) }
            }
            PhoneLink.shared.activate()
        }
    }
}
