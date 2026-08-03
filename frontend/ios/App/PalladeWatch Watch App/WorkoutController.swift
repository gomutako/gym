// =====================================================
// Possiede la HKWorkoutSession. È l'UNICO a parlare con HealthKit: non sa
// nulla di schede, serie o iPhone.
//
// Aprire questa sessione è ciò che rende l'app viva in background — è
// l'unico meccanismo che watchOS offre per l'esecuzione continua e i
// sensori (background mode `workout-processing`). Senza, l'app viene
// sospesa appena si abbassa il polso.
//
// ⚠️ Su Apple Watch esiste UNA sola sessione di allenamento attiva alla
// volta, di sistema: se l'utente ha un allenamento aperto nell'app
// Allenamento, `startActivity` può non tornare mai (difetto storico, vedi
// rdar://45703316). Di qui il timeout esplicito in `start()`.
// =====================================================
import Combine
import Foundation
import HealthKit

@MainActor
final class WorkoutController: NSObject, ObservableObject {
    static let shared = WorkoutController()

    enum State: Equatable {
        case idle
        case running
        case ended
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var heartRate: Int?
    @Published private(set) var activeKcal: Double?

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    /// Guardia di rientranza per `start()`, impostata in modo sincrono prima
    /// di ogni `await`: un doppio tap sulla giornata rientra in `start()`
    /// mentre la prima chiamata è sospesa, e senza questo flag entrambe
    /// passerebbero il controllo su `state` (che diventa `.running` solo
    /// alla fine) creando due `HKWorkoutSession` e perdendo il riferimento
    /// alla prima.
    private var isStarting = false

    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let enType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!

    /// Chiede i permessi. Non rivela se la LETTURA è stata concessa (Apple non
    /// lo espone, per privacy): l'esito riguarda la scrittura del workout, che
    /// è ciò che serve per aprire la sessione.
    func requestAuth() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        do {
            try await store.requestAuthorization(
                toShare: [HKQuantityType.workoutType()],
                read: [hrType, enType])
            return store.authorizationStatus(for: HKQuantityType.workoutType())
                == .sharingAuthorized
        } catch {
            return false
        }
    }

    func start() async throws {
        // `isStarting` va letto e impostato qui, sincrono, prima di ogni
        // `await`: è l'unico modo per rendere il controllo atomico rispetto
        // a un rientro. `state != .running` da solo non basta perché
        // `state` passa a `.running` solo alla fine della funzione, dopo il
        // primo punto di sospensione.
        guard state != .running, !isStarting else { return }
        isStarting = true
        defer { isStarting = false }

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        let session = try HKWorkoutSession(healthStore: store, configuration: config)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: store,
                                                     workoutConfiguration: config)
        session.delegate = self
        builder.delegate = self
        self.session = session
        self.builder = builder

        let start = Date()
        session.startActivity(with: start)

        do {
            // Il timeout esiste per il caso "allenamento già attivo altrove", in
            // cui l'avvio non torna né riesce: senza, la schermata resterebbe
            // bloccata per sempre senza spiegare nulla.
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { try await builder.beginCollection(at: start) }
                group.addTask {
                    try await Task.sleep(nanoseconds: 8_000_000_000)
                    throw WorkoutError.timeout
                }
                try await group.next()
                group.cancelAll()
            }
        } catch {
            // Un avvio fallito (timeout compreso) non deve lasciare una
            // sessione orfana: su watchOS ce n'è UNA sola possibile di
            // sistema, quindi un residuo qui farebbe fallire per timeout
            // ogni tentativo successivo, dando la colpa a un allenamento
            // altrove che in realtà siamo noi.
            session.end()
            self.session = nil
            self.builder = nil
            throw error
        }

        state = .running
    }

    /// Trasferisce in modo atomico la proprietà di sessione e builder a chi
    /// la chiama, azzerando i riferimenti dell'istanza nello stesso istante
    /// (nessun `await` nel mezzo). Chi riceve la coppia è l'UNICO
    /// responsabile di chiuderla e salvarla; chiunque altro riceva `nil` non
    /// deve fare nulla. È quanto rende sicuri, insieme, il doppio tap su
    /// "Termina", la fine imposta dal sistema mentre `end()` è già in corso,
    /// ed `end()` chiamato senza che una sessione sia mai partita.
    private func takeOwnershipForFinalization() -> (session: HKWorkoutSession, builder: HKLiveWorkoutBuilder)? {
        guard let session, let builder else { return nil }
        self.session = nil
        self.builder = nil
        return (session, builder)
    }

    /// Chiude la sessione HealthKit e salva l'HKWorkout in Salute. Va
    /// chiamato SOLO con una coppia ottenuta da
    /// `takeOwnershipForFinalization()`, mai leggendo `self.session`/
    /// `self.builder` direttamente: altrimenti due percorsi concorrenti
    /// (l'utente e il sistema, o due tap) proverebbero a salvare lo stesso
    /// allenamento due volte.
    private func finalize(session: HKWorkoutSession, builder: HKLiveWorkoutBuilder) async {
        session.end()
        do {
            try await builder.endCollection(at: Date())
            // Salva l'HKWorkout in Salute: anelli, calorie e cronologia Fitness
            // restano corretti come se avesse registrato l'app Allenamento, ed è
            // ciò che HealthKitLivePlugin.summary() rileggerà sull'iPhone.
            _ = try await builder.finishWorkout()
            state = .ended
        } catch {
            // Senza questo ramo un salvataggio fallito sembra identico a uno
            // riuscito: l'utente crede che l'allenamento sia in Salute
            // quando non lo è. Il messaggio resta in italiano, l'errore
            // originale va in console per poterlo diagnosticare dal device
            // (`devicectl ... --console`).
            state = .failed("Non sono riuscito a salvare l'allenamento in Salute. Riprova.")
            print("WorkoutController: salvataggio del workout fallito - \(error.localizedDescription)")
        }
    }

    func end() async {
        guard let owned = takeOwnershipForFinalization() else { return }
        await finalize(session: owned.session, builder: owned.builder)
    }

    /// Inoltra i biometrici all'iPhone. NON accodati: un HR di trenta secondi
    /// fa non serve a nessuno, e accodarlo riempirebbe la coda ritardando i
    /// valori veri. Se il telefono è nell'armadietto il dato si perde e va
    /// bene: HealthKit lo registra comunque nel workout.
    private var lastPublish = Date.distantPast

    private func publishBiometrics() {
        // Un campione al secondo basta a un badge: senza freno il builder può
        // chiamare più volte per lo stesso istante.
        guard Date().timeIntervalSince(lastPublish) > 1 else { return }
        lastPublish = Date()
        PhoneLink.shared.send([
            "type": "biometrics",
            "hr": heartRate as Any,
            "kcal": activeKcal as Any,
            "at": ISO8601DateFormatter().string(from: Date()),
        ], queued: false)
    }

    enum WorkoutError: LocalizedError {
        case timeout
        var errorDescription: String? {
            "Sembra che tu abbia un allenamento attivo nell'app Allenamento: terminalo per continuare."
        }
    }
}

extension WorkoutController: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {
        Task { @MainActor in
            // Il sistema può terminare la nostra sessione se l'utente ne apre
            // un'altra (es. dall'app Allenamento): va salvata comunque,
            // altrimenti frequenza cardiaca e calorie raccolte fino a quel
            // momento si perdono in silenzio. `takeOwnershipForFinalization`
            // torna `nil` se `end()` ha già preso in carico la chiusura
            // (es. l'utente ha premuto "Termina" un istante prima), quindi
            // qui non si rischia una doppia finalizzazione.
            //
            // ⚠️ `self.state == .running` NON è ridondante con la presa di
            // proprietà: `session`/`builder` vengono assegnati in `start()`
            // PRIMA dell'`await` su `beginCollection`, quindi esiste una
            // finestra in cui sono già valorizzati ma `state` non è ancora
            // `.running`. È esattamente la finestra del timeout di 8s (un
            // altro allenamento già attivo altrove): se il sistema consegna
            // `didChangeTo(.ended)` in quella finestra e la lasciamo passare,
            // rubiamo la coppia a `start()` e chiamiamo `finalize()`
            // (`endCollection`/`finishWorkout`) mentre il task group di
            // `start()` sta ancora aspettando `beginCollection` sullo stesso
            // builder — due chiamate di lifecycle concorrenti su un solo
            // `HKLiveWorkoutBuilder`, non supportato da HealthKit. Non
            // togliere questa condizione "per pulizia".
            guard toState == .ended, self.state == .running,
                  let owned = self.takeOwnershipForFinalization() else { return }
            await self.finalize(session: owned.session, builder: owned.builder)
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didFailWithError error: Error) {
        Task { @MainActor in
            self.state = .failed(error.localizedDescription)
            // Prendiamo comunque possesso di session/builder e li chiudiamo:
            // altrimenti un `start()` successivo li sovrascriverebbe senza
            // mai rilasciare lo slot di sistema (se HealthKit lo liberi da
            // solo alla consegna di un fallimento non è documentato, quindi
            // non ci si può contare). Non chiamiamo `finalize()`: i dati
            // raccolti fino a un fallimento di sessione non sono affidabili
            // e NON vanno salvati in Salute — è una scelta deliberata, non
            // una dimenticanza.
            if let owned = self.takeOwnershipForFinalization() {
                owned.session.end()
            }
        }
    }
}

extension WorkoutController: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: quantityType) else { continue }

            if quantityType == HKQuantityType.quantityType(forIdentifier: .heartRate) {
                let bpm = HKUnit.count().unitDivided(by: .minute())
                let value = stats.mostRecentQuantity()?.doubleValue(for: bpm)
                Task { @MainActor in
                    self.heartRate = value.map { Int($0.rounded()) }
                    self.publishBiometrics()
                }
            } else if quantityType == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                let value = stats.sumQuantity()?.doubleValue(for: .kilocalorie())
                Task { @MainActor in
                    self.activeKcal = value
                    self.publishBiometrics()
                }
            }
        }
    }
}
