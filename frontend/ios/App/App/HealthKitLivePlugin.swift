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
        let q = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: nil,
                                      limit: HKObjectQueryNoLimit, resultsHandler: handler)
        q.updateHandler = handler
        store.execute(q)
        keep(q)
    }

    @objc func summary(_ call: CAPPluginCall) {
        guard let startStr = call.getString("start"), let endStr = call.getString("end"),
              let start = iso.date(from: startStr), let end = iso.date(from: endStr) else {
            call.reject("start/end ISO richiesti"); return
        }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        var result: [String: Any] = ["hr_avg": NSNull(), "hr_max": NSNull(), "active_kcal": NSNull()]
        let group = DispatchGroup()

        group.enter()
        let hrStat = HKStatisticsQuery(quantityType: hrType, quantitySamplePredicate: pred,
                                       options: [.discreteAverage, .discreteMax]) { _, stats, _ in
            let bpm = HKUnit.count().unitDivided(by: .minute())
            if let avg = stats?.averageQuantity()?.doubleValue(for: bpm) { result["hr_avg"] = Int(avg.rounded()) }
            if let mx = stats?.maximumQuantity()?.doubleValue(for: bpm) { result["hr_max"] = Int(mx.rounded()) }
            group.leave()
        }
        store.execute(hrStat)

        group.enter()
        let enStat = HKStatisticsQuery(quantityType: enType, quantitySamplePredicate: pred,
                                       options: .cumulativeSum) { _, stats, _ in
            if let kcal = stats?.sumQuantity()?.doubleValue(for: .kilocalorie()) { result["active_kcal"] = kcal }
            group.leave()
        }
        store.execute(enStat)

        group.notify(queue: .main) { call.resolve(result) }
    }
}
