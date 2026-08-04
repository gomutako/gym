import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @StateObject private var store = SessionStore.shared
    @State private var error: String?
    /// Sessione aperta sull'iPhone offerta in adozione al Watch, letta con
    /// `PhoneLink.shared.requestState` all'apertura. `nil` finché non arriva
    /// una risposta, o se non c'è nulla da riprendere.
    @State private var pendingAdoption: [String: Any]?

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
                        let id = store.session?.clientSessionId ?? ""
                        await workout.end()
                        PhoneLink.shared.send([
                            "type": "session_closed",
                            "client_session_id": id,
                            "completed_at": ISO8601DateFormatter.withFraction.string(from: Date()),
                        ], queued: true)
                        store.close()
                    }
                }
            } else {
                PickerView(onPick: { w, d in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        let live = store.begin(workout: w, day: d)
                        PhoneLink.shared.send(sessionStartedPayload(live), queued: true)
                        do { try await workout.start() }
                        catch {
                            store.close()
                            self.error = error.localizedDescription
                        }
                    }
                }, adoption: pendingAdoption, onAdopt: {
                    guard let pending = pendingAdoption else { return }
                    // `uniquingKeysWith`, non `uniqueKeysWithValues`: lo
                    // stesso esercizio compare in più giornate e più schede,
                    // e il costruttore che pretende chiavi uniche va in
                    // crash a runtime sui duplicati.
                    let names = Dictionary(
                        CatalogStore.shared.workouts
                            .flatMap { $0.days }.flatMap { $0.exercises }
                            .map { ($0.exerciseId, $0.name) },
                        uniquingKeysWith: { first, _ in first })
                    guard SessionStore.shared.adopt(pending, nameFor: { names[$0] ?? "Esercizio" })
                    else {
                        error = "Questo allenamento è stato creato con una versione precedente e non si può riprendere dal Watch."
                        pendingAdoption = nil
                        return
                    }
                    Task {
                        guard await WorkoutController.shared.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            SessionStore.shared.close()
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        do { try await WorkoutController.shared.start() }
                        catch {
                            SessionStore.shared.close()
                            self.error = error.localizedDescription
                        }
                        pendingAdoption = nil
                    }
                })
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
            // Solo se non è già in corso una sessione al polso: altrimenti
            // un aggancio arrivato in ritardo rimpiazzerebbe silenziosamente
            // un allenamento già iniziato qui.
            PhoneLink.shared.requestState { payload in
                guard let payload, SessionStore.shared.session == nil else { return }
                pendingAdoption = payload
            }
        }
    }
}

/// Snapshot completo per l'iPhone. Deve bastare a creare la riga Supabase da
/// solo: l'app iPhone potrebbe non essere mai stata aperta durante
/// l'allenamento.
private func sessionStartedPayload(_ s: LiveSession) -> [String: Any] {
    [
        "type": "session_started",
        "client_session_id": s.clientSessionId,
        "workout_id": s.workoutId,
        "workout_title": s.workoutTitle,
        "day_index": s.dayIndex,
        "day_name": s.dayName,
        "started_at": ISO8601DateFormatter.withFraction.string(from: s.startedAt),
        "exercises_log": s.exercises.map { ex in
            [
                "exercise_id": ex.exerciseId,
                "rest_seconds": ex.restSeconds,
                "load_type": ex.loadType,
                "sets_log": ex.sets.map { r -> [String: Any] in
                    // `as Any? ?? NSNull()`, non `as Any`: un Optional.none
                    // incapsulato da solo rende il dizionario non
                    // deserializzabile da WatchConnectivity, che scarta
                    // l'INTERO payload in silenzio (stesso pattern già
                    // corretto in WorkoutController.publishBiometrics e
                    // HealthKitLivePlugin.swift). `load` è quasi sempre nil
                    // qui — è il caso normale alla prima volta su un
                    // esercizio, senza sessione precedente da cui
                    // precompilare — quindi senza questo fix session_started
                    // non arriverebbe MAI per la maggior parte degli
                    // allenamenti, e l'iPhone non saprebbe che la sessione
                    // esiste.
                    var row: [String: Any] = [
                        "uid": r.uid,
                        "reps": r.reps as Any? ?? NSNull(),
                        "load": r.load as Any? ?? NSNull(),
                        "done": r.done,
                    ]
                    if let inc = r.incline { row["incline"] = inc }
                    return row
                },
            ] as [String: Any]
        },
    ]
}
