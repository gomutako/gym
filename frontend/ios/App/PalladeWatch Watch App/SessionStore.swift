// =====================================================
// Lo stato della sessione al polso e l'UNICO posto in cui avviene la fusione
// con ciò che arriva dall'iPhone.
//
// ⚠️ Le tre regole di `mergeSetDone` sono la replica esatta di
// frontend/src/lib/session-merge.js. Modificarne una qui senza modificarla
// là fa divergere i due dispositivi in modo silenzioso: i casi di prova sono
// gli stessi da entrambe le parti.
//
// Il timer di recupero NON è stato: è la scadenza derivata
// `done_at + rest_seconds`, che iPhone e Watch calcolano identica senza
// scambiarsi nulla. È anche ciò che lo rende immune alla sospensione.
// =====================================================
import Combine
import Foundation

struct LiveSet: Codable, Hashable {
    var uid: String
    var reps: Int?
    var load: Double?
    var incline: Double?
    var done: Bool
    var doneAt: Date?
}

struct LiveExercise: Codable, Hashable {
    var exerciseId: String
    var name: String
    var targetReps: Int?
    var restSeconds: Int
    var loadType: String
    var hasIncline: Bool
    var sets: [LiveSet]
}

struct LiveSession: Codable {
    var clientSessionId: String
    var workoutId: String
    var workoutTitle: String
    var dayIndex: Int
    var dayName: String
    var startedAt: Date
    var exercises: [LiveExercise]
}

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var session: LiveSession?

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                           in: .userDomainMask)[0]
        // Non esiste ancora su un'installazione pulita: senza questo,
        // `persist()` (che scrive con `try?`) fallirebbe in silenzio finché
        // qualcos'altro (es. CatalogStore) non avesse già creato la
        // directory prima.
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("session.json")
    }()

    private init() {
        if let data = try? Data(contentsOf: url),
           let s = try? JSONDecoder().decode(LiveSession.self, from: data) {
            session = s
        }
    }

    // MARK: - Ciclo di vita

    /// Apre una sessione dalla cache. Gli uid nascono QUI e non nella cache:
    /// due sessioni costruite dallo stesso modello devono avere identità di
    /// serie distinte, altrimenti un "fatto" dell'una toccherebbe l'altra.
    func begin(workout: CachedWorkout, day: CachedDay) -> LiveSession {
        let s = LiveSession(
            clientSessionId: UUID().uuidString,
            workoutId: workout.id,
            workoutTitle: workout.title,
            dayIndex: day.index,
            dayName: day.name,
            startedAt: Date(),
            exercises: day.exercises.map { e in
                LiveExercise(
                    exerciseId: e.exerciseId, name: e.name, targetReps: e.reps,
                    restSeconds: e.restSeconds, loadType: e.loadType, hasIncline: e.hasIncline,
                    sets: e.suggested.map {
                        LiveSet(uid: UUID().uuidString, reps: $0.reps, load: $0.load,
                                incline: $0.incline, done: false, doneAt: nil)
                    })
            })
        session = s
        // Una nuova sessione riapre la persistenza eventualmente sospesa da
        // un `forgetPersisted()` precedente: quel blocco valeva per la
        // sessione dell'account uscito, non per questa.
        persistenceSuspended = false
        persist()
        return s
    }

    func close() {
        session = nil
        persistenceSuspended = false
        try? FileManager.default.removeItem(at: url)
        RestNotifier.cancel()
    }

    /// Cancella la copia su disco lasciando VIVA la sessione in memoria (e
    /// quindi l'allenamento al polso e la sua HKWorkoutSession, che qui non
    /// si tocca).
    ///
    /// Serve al logout arrivato dall'iPhone mentre un allenamento è in
    /// corso: lì `close()` non si può chiamare — distruggerebbe uno sforzo
    /// fisico reale — ma lasciare `session.json` sul disco lascia un file
    /// che nessuno potrà più togliere. Al lancio successivo `init()` lo
    /// ricarica in `session` mentre `WorkoutController` è `.idle`, quindi
    /// `ContentView` non mostra `ExecutionView` (che pretende `.running`) e
    /// non esiste nessun percorso di interfaccia per chiuderla; da quel
    /// momento `store.session != nil` sopprime PER SEMPRE il banner di
    /// adozione, che `ContentView.requestState` offre solo quando la
    /// sessione è nil — per l'utente successivo e per tutti quelli dopo.
    ///
    /// La persistenza resta sospesa fino alla prossima `begin()`/`adopt()`:
    /// altrimenti il primo "fatto" segnato dopo il logout riscriverebbe il
    /// file e ricreerebbe esattamente l'orfano. Il prezzo è che se l'app
    /// viene terminata prima della fine di QUEST'ALLENAMENTO non si
    /// recupera al riavvio — un peggioramento che vale solo dopo un logout
    /// a metà allenamento, mentre l'orfano avvelenava ogni avvio futuro.
    func forgetPersisted() {
        persistenceSuspended = true
        try? FileManager.default.removeItem(at: url)
    }

    /// Adotta una sessione già aperta sull'iPhone (aggancio a metà sessione).
    /// Le serie senza `uid` non sono correlabili: sono sessioni create prima
    /// che le righe avessero un identificativo stabile (vedi 2739c65), e la
    /// sessione va rifiutata invece di agganciarsi a indici che cambierebbero
    /// sotto i piedi se sul telefono si aggiungono o tolgono serie.
    func adopt(_ payload: [String: Any], nameFor: (String) -> String) -> Bool {
        guard let cid = payload["client_session_id"] as? String,
              let log = payload["exercises_log"] as? [[String: Any]],
              !log.isEmpty else { return false }

        var exercises: [LiveExercise] = []
        for ex in log {
            guard let exId = ex["exercise_id"] as? String,
                  let rows = ex["sets_log"] as? [[String: Any]] else { return false }
            var sets: [LiveSet] = []
            for r in rows {
                guard let uid = r["uid"] as? String else { return false }
                sets.append(LiveSet(
                    uid: uid, reps: r["reps"] as? Int, load: r["load"] as? Double,
                    incline: r["incline"] as? Double,
                    done: r["done"] as? Bool ?? false,
                    doneAt: (r["done_at"] as? String)
                        .flatMap { ISO8601DateFormatter.withFraction.date(from: $0) }))
            }
            exercises.append(LiveExercise(
                exerciseId: exId, name: nameFor(exId), targetReps: ex["target_reps"] as? Int,
                restSeconds: ex["rest_seconds"] as? Int ?? 0,
                loadType: ex["load_type"] as? String ?? "weight",
                hasIncline: ex["has_incline"] as? Bool ?? false, sets: sets))
        }

        session = LiveSession(
            clientSessionId: cid,
            workoutId: payload["workout_id"] as? String ?? "",
            workoutTitle: payload["workout_title"] as? String ?? "Allenamento",
            dayIndex: payload["day_index"] as? Int ?? 0,
            dayName: payload["day_name"] as? String ?? "",
            startedAt: (payload["started_at"] as? String)
                .flatMap { ISO8601DateFormatter.withFraction.date(from: $0) } ?? Date(),
            exercises: exercises)
        persistenceSuspended = false // vedi begin()
        persist()
        return true
    }

    // MARK: - Fusione (replica di session-merge.js)

    /// Applica un "serie completata". Ritorna true solo se ha cambiato
    /// qualcosa: false significa che l'evento non va né persistito né
    /// ritrasmesso, altrimenti i due dispositivi si rimbalzerebbero lo
    /// stesso fatto all'infinito.
    @discardableResult
    func mergeSetDone(uid: String, reps: Int?, load: Double?, incline: Double?,
                      doneAt: Date) -> Bool {
        guard var s = session else { return false }
        for (ei, ex) in s.exercises.enumerated() {
            guard let si = ex.sets.firstIndex(where: { $0.uid == uid }) else { continue }
            let row = ex.sets[si]
            // Regola 2: vince chi è arrivato prima nel tempo reale.
            if row.done, let existing = row.doneAt, doneAt >= existing { return false }

            var updated = row
            updated.reps = reps
            updated.load = load
            if incline != nil { updated.incline = incline }
            updated.done = true
            updated.doneAt = doneAt
            s.exercises[ei].sets[si] = updated
            session = s
            persist()
            return true
        }
        return false
    }

    /// Smista un dizionario in arrivo dall'iPhone. Ritorna true se lo ha
    /// riconosciuto: chi chiama non deve indovinare.
    @discardableResult
    func apply(_ message: [String: Any]) -> Bool {
        guard (message["type"] as? String) == "set_done",
              let uid = message["uid"] as? String,
              let atString = message["done_at"] as? String,
              let at = ISO8601DateFormatter.withFraction.date(from: atString)
        else { return false }
        mergeSetDone(uid: uid, reps: message["reps"] as? Int,
                     load: message["load"] as? Double,
                     incline: message["incline"] as? Double, doneAt: at)
        return true
    }

    // MARK: - Recupero, derivato

    /// La scadenza del recupero di una serie. Non è memorizzata da nessuna
    /// parte: si ricalcola, quindi non può andare fuori sincrono e sopravvive
    /// alla sospensione dell'app.
    func restDeadline(exerciseIndex: Int, setUid: String) -> Date? {
        guard let s = session, s.exercises.indices.contains(exerciseIndex) else { return nil }
        let ex = s.exercises[exerciseIndex]
        guard let row = ex.sets.first(where: { $0.uid == setUid }),
              let at = row.doneAt, ex.restSeconds > 0 else { return nil }
        return at.addingTimeInterval(TimeInterval(ex.restSeconds))
    }

    /// Vero dopo `forgetPersisted()`: la sessione continua a vivere in
    /// memoria ma non torna più sul disco, o il file appena cancellato
    /// rinascerebbe al primo "fatto".
    private var persistenceSuspended = false

    private func persist() {
        guard !persistenceSuspended,
              let s = session, let data = try? JSONEncoder().encode(s) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

extension ISO8601DateFormatter {
    /// I timestamp JS (`toISOString()`) hanno tre decimali; quelli PostgREST
    /// sei. Un formatter senza `.withFractionalSeconds` li rifiuta entrambi.
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

#if DEBUG
extension SessionStore {
    /// Solo per i test XCTest (`@testable import`, build Debug): inietta
    /// direttamente una riga "fatta" con `doneAt` assente, lo stato che in
    /// JS corrisponde a un `done_at` presente ma non parsabile (`rowTime`
    /// NaN in session-merge.js). In Swift `doneAt` è un `Date?` tipato, quindi
    /// questo stato non può nascere dalle API pubbliche (`mergeSetDone` e
    /// `apply` valorizzano sempre `done` e `doneAt` insieme, mai l'uno senza
    /// l'altro) — ma è comunque il caso per cui la versione JS è stata
    /// corretta, e va provato: una riga così "corrotta" non deve mai
    /// bloccare un evento valido successivo.
    func _test_markDoneWithoutTimestamp(exerciseIndex: Int, setIndex: Int) {
        guard var s = session else { return }
        var row = s.exercises[exerciseIndex].sets[setIndex]
        row.done = true
        row.doneAt = nil
        s.exercises[exerciseIndex].sets[setIndex] = row
        session = s
    }
}
#endif
