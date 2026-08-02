import SwiftUI

struct PickerView: View {
    @StateObject private var catalog = CatalogStore.shared
    /// Invocata con la giornata scelta. Chi la consuma apre la sessione:
    /// questa vista non sa nulla di HealthKit.
    var onPick: (CachedWorkout, CachedDay) -> Void

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
