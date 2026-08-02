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
        guard state != .running else { return }

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

        state = .running
    }

    func end() async {
        guard let session, let builder else { return }
        session.end()
        try? await builder.endCollection(at: Date())
        // Salva l'HKWorkout in Salute: anelli, calorie e cronologia Fitness
        // restano corretti come se avesse registrato l'app Allenamento, ed è
        // ciò che HealthKitLivePlugin.summary() rileggerà sull'iPhone.
        _ = try? await builder.finishWorkout()
        self.session = nil
        self.builder = nil
        state = .ended
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
            // un'altra: va notato, non subito in silenzio.
            if toState == .ended, self.state == .running { self.state = .ended }
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didFailWithError error: Error) {
        Task { @MainActor in self.state = .failed(error.localizedDescription) }
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
                }
            } else if quantityType == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                let value = stats.sumQuantity()?.doubleValue(for: .kilocalorie())
                Task { @MainActor in self.activeKcal = value }
            }
        }
    }
}
