import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @StateObject private var store = SessionStore.shared
    @State private var error: String?

    /// Il messaggio di un salvataggio fallito vive in `workout.state`, non in
    /// `error`: senza intercettarlo qui, `.failed` cade nel ramo `else` (che
    /// mostra il picker) e l'utente torna all'inizio credendo che
    /// l'allenamento sia stato salvato in Salute quando non lo è. Perso una
    /// volta già in un refactoring precedente — chi tocca questa vista in
    /// futuro: se sposti di nuovo la logica dei rami, porta con te anche
    /// questo computed.
    private var savedFailureMessage: String? {
        if case .failed(let message) = workout.state { return message }
        return nil
    }

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
                    // Precedenza al salvataggio fallito, anche se `error` è
                    // più recente: un `.failed` non ancora riconosciuto
                    // dall'utente rappresenta un allenamento perso, mentre un
                    // errore di avvio è recuperabile con un nuovo tentativo.
                    // Meglio rischiare di mostrare un messaggio "vecchio" che
                    // farne sparire uno su un dato che non si può più
                    // recuperare.
                    if let message = savedFailureMessage ?? error {
                        Text(message).font(.caption2).foregroundStyle(.red)
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
