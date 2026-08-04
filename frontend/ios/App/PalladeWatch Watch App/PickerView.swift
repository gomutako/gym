import SwiftUI

struct PickerView: View {
    @StateObject private var catalog = CatalogStore.shared
    /// Invocata con la giornata scelta. Chi la consuma apre la sessione:
    /// questa vista non sa nulla di HealthKit.
    var onPick: (CachedWorkout, CachedDay) -> Void
    /// Sessione già aperta sull'iPhone, se ce n'è una da riprendere. Questa
    /// vista non possiede lo stato dell'aggancio: lo riceve e segnala
    /// l'intenzione con `onAdopt`, come già fa con `onPick`.
    var adoption: [String: Any]?
    var onAdopt: () -> Void

    var body: some View {
        if catalog.workouts.isEmpty {
            VStack(spacing: 8) {
                Text("Nessuna scheda").font(.headline)
                Text("Apri Pallade sull'iPhone per sincronizzare le schede.")
                    .font(.caption2).multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
        } else {
            List {
                if let adoption, let title = adoption["day_name"] as? String {
                    Section {
                        Button("Riprendi \(title)") { onAdopt() }
                        // Non decorativa: prima dell'aggancio non esisteva un
                        // workout attivo, quindi i biometrici non coprono
                        // l'inizio della sessione e l'utente deve saperlo.
                        Text("Frequenza cardiaca e calorie partono da adesso.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                ForEach(catalog.workouts, id: \.id) { w in
                    Section(w.title) {
                        ForEach(w.days, id: \.index) { d in
                            Button {
                                onPick(w, d)
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(d.name)
                                    Text("\(d.exercises.count) esercizi")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if let at = catalog.syncedAt {
                    Text("Aggiornato \(at.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}
