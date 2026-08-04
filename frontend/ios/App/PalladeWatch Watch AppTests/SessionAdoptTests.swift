// =====================================================
// Prova l'aggancio a metà sessione (SessionStore.adopt): una sessione
// aperta sull'iPhone e offerta al Watch tramite `state_request`.
//
// Il caso che conta di più: le sessioni create prima di 2739c65 non hanno
// `uid` sulle righe delle serie. Senza quell'identificativo il Watch non
// può correlare le serie in arrivo dall'iPhone con le proprie — le
// posizioni si spostano quando si aggiungono o tolgono serie sul telefono
// — quindi l'aggancio va rifiutato, non tentato per indice.
// =====================================================
import XCTest
@testable import PalladeWatch_Watch_App

@MainActor
final class SessionAdoptTests: XCTestCase {

    private func namesFrom(_ dict: [String: String]) -> (String) -> String {
        { dict[$0] ?? "Esercizio" }
    }

    private func validPayload() -> [String: Any] {
        [
            "client_session_id": "cs-1",
            "workout_id": "w-1",
            "workout_title": "Scheda A",
            "day_index": 0,
            "day_name": "Giorno 1",
            "started_at": "2026-08-02T10:00:00.000Z",
            "exercises_log": [
                [
                    "exercise_id": "e1",
                    "rest_seconds": 90,
                    "load_type": "weight",
                    "sets_log": [
                        ["uid": "u1", "reps": 10, "load": 50.0, "done": true,
                         "done_at": "2026-08-02T10:05:00.000Z"],
                        ["uid": "u2", "reps": 10, "load": 50.0, "done": false],
                    ],
                ],
            ],
        ]
    }

    override func setUp() {
        SessionStore.shared.close()
    }

    override func tearDown() {
        SessionStore.shared.close()
    }

    // MARK: - Rifiuto delle sessioni senza `uid`

    func testRifiutaSessioneSenzaUidSuUnaRiga() {
        var payload = validPayload()
        var log = payload["exercises_log"] as! [[String: Any]]
        var sets = log[0]["sets_log"] as! [[String: Any]]
        sets[1].removeValue(forKey: "uid") // una sola riga senza uid basta a rifiutare tutto
        log[0]["sets_log"] = sets
        payload["exercises_log"] = log

        XCTAssertFalse(SessionStore.shared.adopt(payload, nameFor: namesFrom([:])),
                       "una riga senza uid deve far rifiutare l'intera sessione")
        XCTAssertNil(SessionStore.shared.session, "un aggancio rifiutato non deve creare nessuna sessione")
    }

    func testRifiutaSessioneConTutteLeRigheSenzaUid() {
        var payload = validPayload()
        var log = payload["exercises_log"] as! [[String: Any]]
        log[0]["sets_log"] = [
            ["reps": 10, "load": 50.0, "done": false],
            ["reps": 10, "load": 50.0, "done": false],
        ]
        payload["exercises_log"] = log

        XCTAssertFalse(SessionStore.shared.adopt(payload, nameFor: namesFrom([:])))
        XCTAssertNil(SessionStore.shared.session)
    }

    // MARK: - Altre forme non correlabili

    func testRifiutaSessioneConLogVuoto() {
        var payload = validPayload()
        payload["exercises_log"] = []
        XCTAssertFalse(SessionStore.shared.adopt(payload, nameFor: namesFrom([:])))
    }

    func testRifiutaSenzaClientSessionId() {
        var payload = validPayload()
        payload.removeValue(forKey: "client_session_id")
        XCTAssertFalse(SessionStore.shared.adopt(payload, nameFor: namesFrom([:])))
    }

    func testRifiutaEsercizioSenzaSetsLog() {
        var payload = validPayload()
        var log = payload["exercises_log"] as! [[String: Any]]
        log[0].removeValue(forKey: "sets_log")
        payload["exercises_log"] = log
        XCTAssertFalse(SessionStore.shared.adopt(payload, nameFor: namesFrom([:])))
    }

    // MARK: - Adozione riuscita

    func testAdottaSessioneValidaEPreservaLoStatoDelleSerie() {
        let ok = SessionStore.shared.adopt(validPayload(), nameFor: namesFrom(["e1": "Panca piana"]))
        XCTAssertTrue(ok)

        let s = SessionStore.shared.session
        XCTAssertNotNil(s)
        XCTAssertEqual(s?.clientSessionId, "cs-1")
        XCTAssertEqual(s?.workoutTitle, "Scheda A")
        XCTAssertEqual(s?.dayName, "Giorno 1")
        XCTAssertEqual(s?.exercises.count, 1)
        XCTAssertEqual(s?.exercises[0].name, "Panca piana")
        XCTAssertEqual(s?.exercises[0].sets.count, 2)

        // La serie già fatta sull'iPhone resta fatta: il Watch non deve
        // farla ripetere.
        XCTAssertEqual(s?.exercises[0].sets[0].uid, "u1")
        XCTAssertTrue(s?.exercises[0].sets[0].done ?? false)
        XCTAssertEqual(s?.exercises[0].sets[0].doneAt,
                       ISO8601DateFormatter.withFraction.date(from: "2026-08-02T10:05:00.000Z"))
        XCTAssertFalse(s?.exercises[0].sets[1].done ?? true)
    }

    func testUnaSerieAdottataECorrelabilePerUidConSetDoneSuccessivo() {
        _ = SessionStore.shared.adopt(validPayload(), nameFor: namesFrom([:]))
        // La seconda serie (u2), non ancora fatta al momento dell'aggancio,
        // arriva "fatta" con un set_done successivo dal Watch stesso: deve
        // trovare la riga per uid, non per posizione.
        let changed = SessionStore.shared.mergeSetDone(
            uid: "u2", reps: 8, load: 55, incline: nil,
            doneAt: ISO8601DateFormatter.withFraction.date(from: "2026-08-02T10:10:00.000Z")!)
        XCTAssertTrue(changed)
        XCTAssertTrue(SessionStore.shared.session?.exercises[0].sets[1].done ?? false)
    }
}
