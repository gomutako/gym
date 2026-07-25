import Foundation
import Capacitor
import HealthKit

@objc(HealthKitLivePlugin)
public class HealthKitLivePlugin: CAPPlugin {
    private let store = HKHealthStore()
    private var hrQuery: HKAnchoredObjectQuery?
    private var enQuery: HKAnchoredObjectQuery?

    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let enType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
    private let iso = ISO8601DateFormatter()

    // Parse tollerante: prova prima con frazioni di secondo (3 cifre, es. "end" da
    // Date#toISOString() lato JS), poi senza. Nota: PostgREST serializza i timestamptz
    // con 6 cifre decimali (es. "start" da session.started_at), che nessuno dei due rami
    // qui sotto accetta — per quello il chiamante JS normalizza "start" prima di passarlo.
    private func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    @objc func requestAuth(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false]); return
        }
        store.requestAuthorization(toShare: nil, read: [hrType, enType]) { ok, _ in
            call.resolve(["granted": ok])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        startStream(type: hrType, event: "heartRate", unit: HKUnit.count().unitDivided(by: .minute())) { q in self.hrQuery = q }
        startStream(type: enType, event: "activeEnergy", unit: HKUnit.kilocalorie()) { q in self.enQuery = q }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        if let q = hrQuery { store.stop(q); hrQuery = nil }
        if let q = enQuery { store.stop(q); enQuery = nil }
        call.resolve()
    }

    private func startStream(type: HKQuantityType, event: String, unit: HKUnit, keep: @escaping (HKAnchoredObjectQuery) -> Void) {
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = { [weak self] _, samples, _, _, _ in
            guard let self = self else { return }
            for s in (samples as? [HKQuantitySample]) ?? [] {
                let value = s.quantity.doubleValue(for: unit)
                self.notifyListeners(event, data: [
                    "value": value,
                    "timestamp": self.iso.string(from: s.endDate),
                ])
            }
        }
        // Ancora la query a "adesso": senza predicate, la prima resultsHandler
        // consegnerebbe l'intera storia HealthKit dell'utente invece dei soli
        // campioni della sessione corrente.
        let pred = HKQuery.predicateForSamples(withStart: Date(), end: nil, options: .strictStartDate)
        let q = HKAnchoredObjectQuery(type: type, predicate: pred, anchor: nil,
                                      limit: HKObjectQueryNoLimit, resultsHandler: handler)
        q.updateHandler = handler
        store.execute(q)
        keep(q)
    }

    @objc func summary(_ call: CAPPluginCall) {
        guard let startStr = call.getString("start"), let endStr = call.getString("end"),
              let start = parseISO(startStr), let end = parseISO(endStr) else {
            call.reject("start/end ISO richiesti"); return
        }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let group = DispatchGroup()

        // Ogni completion handler scrive su una propria variabile locale invece che su un
        // dizionario condiviso: HealthKit può invocarli concorrentemente su code diverse, e i
        // Dictionary Swift non sono sicuri sotto mutazione concorrente da più thread.
        var hrAvg: Int?
        var hrMax: Int?
        group.enter()
        let hrStat = HKStatisticsQuery(quantityType: hrType, quantitySamplePredicate: pred,
                                       options: [.discreteAverage, .discreteMax]) { _, stats, _ in
            let bpm = HKUnit.count().unitDivided(by: .minute())
            if let avg = stats?.averageQuantity()?.doubleValue(for: bpm) { hrAvg = Int(avg.rounded()) }
            if let mx = stats?.maximumQuantity()?.doubleValue(for: bpm) { hrMax = Int(mx.rounded()) }
            group.leave()
        }
        store.execute(hrStat)

        var activeKcal: Double?
        group.enter()
        let enStat = HKStatisticsQuery(quantityType: enType, quantitySamplePredicate: pred,
                                       options: .cumulativeSum) { _, stats, _ in
            if let kcal = stats?.sumQuantity()?.doubleValue(for: .kilocalorie()) { activeKcal = kcal }
            group.leave()
        }
        store.execute(enStat)

        group.notify(queue: .main) {
            call.resolve([
                "hr_avg": hrAvg as Any? ?? NSNull(),
                "hr_max": hrMax as Any? ?? NSNull(),
                "active_kcal": activeKcal as Any? ?? NSNull(),
            ])
        }
    }
}
