// =====================================================
// La cache delle schede ricevuta dall'iPhone. Sopravvive alla chiusura
// dell'app: senza persistenza, riaprire l'app in palestra con il telefono
// nell'armadietto mostrerebbe una lista vuota.
// =====================================================
import Combine
import Foundation

struct CachedSuggestion: Codable, Hashable {
    var reps: Int?
    var load: Double?
    var incline: Double?
}

struct CachedExercise: Codable, Hashable {
    var exerciseId: String
    var name: String
    var reps: Int?
    var restSeconds: Int
    var loadType: String
    var hasIncline: Bool
    var suggested: [CachedSuggestion]
}

struct CachedDay: Codable, Hashable {
    var index: Int
    var name: String
    var exercises: [CachedExercise]
}

struct CachedWorkout: Codable, Hashable {
    var id: String
    var title: String
    var days: [CachedDay]
}

final class CatalogStore: ObservableObject {
    static let shared = CatalogStore()

    @Published private(set) var workouts: [CachedWorkout] = []
    @Published private(set) var syncedAt: Date?

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("catalog.json")
    }()

    private init() { load() }

    /// Accetta il dizionario grezzo di WatchConnectivity. Ritorna false se il
    /// messaggio non è una cache: il chiamante smista, questa classe non
    /// indovina.
    @discardableResult
    func apply(_ message: [String: Any]) -> Bool {
        guard (message["type"] as? String) == "catalog",
              let raw = message["workouts"] as? [[String: Any]] else { return false }

        // I compactMap scartano workout/giornata/esercizio malformati invece
        // di far fallire l'intera cache — una lista parziale è più utile di
        // una vuota in palestra. Ma scartare in silenzio renderebbe
        // undiagnosticabile senza cavo un futuro cambio di forma del
        // payload: ogni scarto stampa cosa e perché.
        let parsed: [CachedWorkout] = raw.compactMap { w in
            guard let id = w["id"] as? String else {
                print("[CatalogStore] scheda scartata: chiave 'id' mancante o non stringa — \(w)")
                return nil
            }
            guard let title = w["title"] as? String else {
                print("[CatalogStore] scheda \(id) scartata: chiave 'title' mancante o non stringa")
                return nil
            }
            guard let days = w["days"] as? [[String: Any]] else {
                print("[CatalogStore] scheda \(id) scartata: chiave 'days' mancante o non è un array")
                return nil
            }
            return CachedWorkout(id: id, title: title, days: days.compactMap { d in
                guard let index = d["index"] as? Int else {
                    print("[CatalogStore] giornata di '\(title)' scartata: chiave 'index' mancante o non intera")
                    return nil
                }
                guard let name = d["name"] as? String else {
                    print("[CatalogStore] giornata \(index) di '\(title)' scartata: chiave 'name' mancante o non stringa")
                    return nil
                }
                guard let exs = d["exercises"] as? [[String: Any]] else {
                    print("[CatalogStore] giornata \(index) di '\(title)' scartata: chiave 'exercises' mancante o non è un array")
                    return nil
                }
                return CachedDay(index: index, name: name, exercises: exs.compactMap { e in
                    guard let exId = e["exercise_id"] as? String else {
                        print("[CatalogStore] esercizio scartato in '\(title)'/'\(name)': chiave 'exercise_id' mancante o non stringa")
                        return nil
                    }
                    guard let exName = e["name"] as? String else {
                        print("[CatalogStore] esercizio \(exId) scartato in '\(title)'/'\(name)': chiave 'name' mancante o non stringa")
                        return nil
                    }
                    let sugg = (e["suggested"] as? [[String: Any]] ?? []).map {
                        CachedSuggestion(reps: $0["reps"] as? Int,
                                         load: $0["load"] as? Double,
                                         incline: $0["incline"] as? Double)
                    }
                    return CachedExercise(
                        exerciseId: exId, name: exName, reps: e["reps"] as? Int,
                        restSeconds: e["rest_seconds"] as? Int ?? 0,
                        loadType: e["load_type"] as? String ?? "weight",
                        hasIncline: e["has_incline"] as? Bool ?? false,
                        suggested: sugg)
                })
            })
        }

        let stamp = (message["synced_at"] as? String)
            .flatMap { ISO8601DateFormatter().date(from: $0) } ?? Date()

        DispatchQueue.main.async {
            self.workouts = parsed
            self.syncedAt = stamp
            self.persist()
        }
        return true
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(workouts) else { return }
        try? data.write(to: url, options: .atomic)
        UserDefaults.standard.set(syncedAt, forKey: "catalogSyncedAt")
    }

    private func load() {
        if let data = try? Data(contentsOf: url),
           let items = try? JSONDecoder().decode([CachedWorkout].self, from: data) {
            workouts = items
        }
        syncedAt = UserDefaults.standard.object(forKey: "catalogSyncedAt") as? Date
    }
}
