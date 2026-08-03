// =====================================================
// Prova che la fusione Swift di SessionStore.mergeSetDone concorda con
// frontend/src/lib/session-merge.js sugli stessi casi. Le due implementazioni
// sono duplicate di proposito (watchOS non esegue JavaScript): questo file è
// la sola difesa contro una divergenza silenziosa fra i due dispositivi.
// =====================================================
import XCTest
@testable import PalladeWatch_Watch_App

@MainActor
final class SessionMergeTests: XCTestCase {
    private let t0 = ISO8601DateFormatter.withFraction.date(from: "2026-08-02T10:00:00.000Z")!
    private let tLate = ISO8601DateFormatter.withFraction.date(from: "2026-08-02T10:05:00.000Z")!
    private let tEarly = ISO8601DateFormatter.withFraction.date(from: "2026-08-02T09:55:00.000Z")!

    private func makeStore() -> SessionStore {
        let store = SessionStore.shared
        store.close()
        let day = CachedDay(index: 0, name: "A", exercises: [
            CachedExercise(exerciseId: "e1", name: "Panca", reps: 10, restSeconds: 90,
                           loadType: "weight", hasIncline: false,
                           suggested: [CachedSuggestion(reps: 10, load: 50, incline: nil),
                                       CachedSuggestion(reps: 10, load: 50, incline: nil)]),
        ])
        _ = store.begin(workout: CachedWorkout(id: "w1", title: "Scheda", days: [day]), day: day)
        return store
    }

    // MARK: - Regola 1: `done` vince su non-`done`

    func testMarcaLaSerieEApplicaIValori() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        XCTAssertTrue(store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0))
        XCTAssertTrue(store.session!.exercises[0].sets[0].done)
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 12)
        XCTAssertEqual(store.session!.exercises[0].sets[0].load, 55)
        XCTAssertFalse(store.session!.exercises[0].sets[1].done, "non deve toccare le altre")
    }

    func testIdempotente() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0)
        XCTAssertFalse(store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0))
    }

    // MARK: - Regola 2: vince il `done_at` PIÙ VECCHIO

    func testIlPiuRecenteNonSovrascrive() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0)
        XCTAssertFalse(store.mergeSetDone(uid: uid, reps: 8, load: 40, incline: nil, doneAt: tLate))
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 12)
    }

    func testIlPiuVecchioVince() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 12, load: 55, incline: nil, doneAt: t0)
        XCTAssertTrue(store.mergeSetDone(uid: uid, reps: 8, load: 40, incline: nil, doneAt: tEarly))
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 8)
    }

    // MARK: - Regola 3: l'annullamento non attraversa il confine del dispositivo

    /// `mergeSetDone` non accetta `done: false` come parametro (non esiste
    /// nella sua firma) e `apply` riconosce solo `"type": "set_done"`: non
    /// c'è alcun percorso, dal messaggio dell'iPhone al Watch, che possa
    /// annullare una serie. Replica strutturale della Regola 3: né un tipo
    /// di messaggio "set_undone" (sconosciuto ad `apply`) né un flag
    /// `done: false` dentro un "set_done" (mai letto da `apply`) riescono ad
    /// annullare la serie già segnata.
    func testAnnullamentoNonAttraversaIlConfineDelDispositivo() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 10, load: 50, incline: nil, doneAt: t0)
        XCTAssertTrue(store.session!.exercises[0].sets[0].done)

        let undoMessage: [String: Any] = ["type": "set_undone", "uid": uid]
        XCTAssertFalse(store.apply(undoMessage), "nessun tipo di messaggio annulla una serie")
        XCTAssertTrue(store.session!.exercises[0].sets[0].done, "l'annullamento non arriva mai dal telefono")

        // Un "set_done" con `done: false` è comunque letto come un fatto
        // compiuto: `apply`/`mergeSetDone` non leggono affatto quella chiave.
        let ignoredFlag: [String: Any] = [
            "type": "set_done", "uid": uid, "done": false,
            "done_at": "2026-08-02T09:00:00.000Z",
        ]
        XCTAssertTrue(store.apply(ignoredFlag), "resta un 'set_done' valido, solo con un campo ignorato")
        XCTAssertTrue(store.session!.exercises[0].sets[0].done, "la serie non può tornare non fatta")
    }

    // MARK: - uid sconosciuto

    func testUidSconosciutoIgnorato() {
        let store = makeStore()
        XCTAssertFalse(store.mergeSetDone(uid: "zzz", reps: 1, load: 1, incline: nil, doneAt: t0))
    }

    // MARK: - Guardia d'ingresso: `done_at` mancante o non parsabile (il fix di 9e9de85)

    /// Replica la Regola 1 del fix JS: un `done_at` non parsabile non deve
    /// superare la guardia d'ingresso. In Swift la guardia è strutturale —
    /// `ISO8601DateFormatter.date(from:)` torna nil e `apply` si ferma prima
    /// di toccare `mergeSetDone` — ma il comportamento osservabile deve
    /// essere lo stesso della versione JS corretta: l'evento è scartato, non
    /// scritto come "fatto".
    func testDoneAtNonParsabileVieneScartatoDaApply() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        let corrupted: [String: Any] = [
            "type": "set_done", "uid": uid, "done_at": "non-una-data",
            "reps": 5, "load": 20.0,
        ]
        XCTAssertFalse(store.apply(corrupted), "un done_at non parsabile va scartato, non applicato")
        XCTAssertFalse(store.session!.exercises[0].sets[0].done, "la riga non deve risultare fatta")
    }

    /// Un tentativo scartato non deve lasciare nulla "congelato": un evento
    /// valido successivo per lo stesso uid deve poter comunque marcare la
    /// serie.
    func testDoneAtNonParsabileNonCongelaLaRigaPerEventiSuccessivi() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.apply([
            "type": "set_done", "uid": uid, "done_at": "non-una-data",
            "reps": 5, "load": 20.0,
        ])
        XCTAssertTrue(store.mergeSetDone(uid: uid, reps: 10, load: 50, incline: nil, doneAt: t0),
                      "un evento valido successivo deve poter marcare la serie")
        XCTAssertTrue(store.session!.exercises[0].sets[0].done)
    }

    /// Replica la Regola 2 del fix JS: anche se una riga ESISTENTE fosse già
    /// "fatta" con un `done_at` corrotto (in Swift: assente — è l'unico modo
    /// in cui una riga tipizzata `Date?` può rappresentare "non parsabile",
    /// dato che `mergeSetDone` e `apply` non producono mai questo stato da
    /// sole), un evento valido successivo deve comunque vincere: una riga
    /// corrotta non ha nessuna pretesa difendibile di restare bloccata per
    /// sempre. È il bug esatto corretto in 9e9de85: un confronto con NaN è
    /// sempre falso, quindi la vecchia guardia lasciava la riga congelata.
    func testRigaConDoneAtAssenteNonRestaCongelata() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        store._test_markDoneWithoutTimestamp(exerciseIndex: 0, setIndex: 0)
        XCTAssertTrue(store.session!.exercises[0].sets[0].done)
        XCTAssertNil(store.session!.exercises[0].sets[0].doneAt)

        XCTAssertTrue(store.mergeSetDone(uid: uid, reps: 9, load: 45, incline: nil, doneAt: t0),
                      "un evento valido deve correggere una riga 'fatta' senza timestamp")
        XCTAssertEqual(store.session!.exercises[0].sets[0].reps, 9)
        XCTAssertEqual(store.session!.exercises[0].sets[0].doneAt, t0)
    }

    // MARK: - Recupero derivato

    func testScadenzaDelRecuperoDerivata() {
        let store = makeStore()
        let uid = store.session!.exercises[0].sets[0].uid
        _ = store.mergeSetDone(uid: uid, reps: 10, load: 50, incline: nil, doneAt: t0)
        // 90 secondi di recupero: la scadenza si RICALCOLA, non è memorizzata.
        XCTAssertEqual(store.restDeadline(exerciseIndex: 0, setUid: uid),
                       t0.addingTimeInterval(90))
    }

    // MARK: - Identità delle serie

    func testUidDistintiFraSessioniDalloStessoModello() {
        let a = makeStore().session!.exercises[0].sets[0].uid
        let b = makeStore().session!.exercises[0].sets[0].uid
        XCTAssertNotEqual(a, b, "due sessioni dalla stessa cache devono avere identità distinte")
    }
}
