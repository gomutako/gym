import Combine
import SwiftUI

struct ExecutionView: View {
    @StateObject private var store = SessionStore.shared
    @StateObject private var workout = WorkoutController.shared
    @State private var exerciseIndex = 0
    @State private var now = Date()
    var onFinish: () -> Void

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var exercise: LiveExercise? {
        guard let s = store.session, s.exercises.indices.contains(exerciseIndex) else { return nil }
        return s.exercises[exerciseIndex]
    }

    /// La prima serie non ancora fatta: è quella che il tasto chiude.
    private var nextSet: LiveSet? { exercise?.sets.first(where: { !$0.done }) }

    private var restRemaining: Int? {
        guard let ex = exercise,
              let last = ex.sets.filter({ $0.done }).max(by: { ($0.doneAt ?? .distantPast) < ($1.doneAt ?? .distantPast) }),
              let deadline = store.restDeadline(exerciseIndex: exerciseIndex, setUid: last.uid)
        else { return nil }
        let left = Int(deadline.timeIntervalSince(now).rounded(.up))
        return left > 0 ? left : nil
    }

    var body: some View {
        TabView(selection: $exerciseIndex) {
            ForEach(Array((store.session?.exercises ?? []).enumerated()), id: \.offset) { i, ex in
                VStack(spacing: 4) {
                    Text(ex.name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                    Text("\(ex.sets.filter { $0.done }.count)/\(ex.sets.count) serie")
                        .font(.caption2).foregroundStyle(.secondary)

                    if let left = restRemaining, i == exerciseIndex {
                        Text("\(left / 60):\(String(format: "%02d", left % 60))")
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .foregroundStyle(.orange)
                        Text("recupero").font(.caption2).foregroundStyle(.secondary)
                    } else if let set = nextSet, i == exerciseIndex {
                        Text(setLabel(ex: ex, set: set))
                            .font(.system(size: 24, weight: .semibold, design: .rounded))
                        Button("Fatto") { markDone(ex: ex, set: set) }
                            .tint(.green)
                    } else {
                        Text("Completato").font(.caption2).foregroundStyle(.green)
                    }

                    HStack(spacing: 6) {
                        Text(workout.heartRate.map { "\($0) bpm" } ?? "— bpm")
                        Text(workout.activeKcal.map { String(format: "%.0f kcal", $0) } ?? "")
                    }
                    .font(.caption2).foregroundStyle(.secondary)
                }
                .tag(i)
            }
        }
        .tabViewStyle(.verticalPage)
        .onReceive(tick) { now = $0 }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Fine") { onFinish() }
            }
        }
    }

    private func setLabel(ex: LiveExercise, set: LiveSet) -> String {
        let reps = set.reps.map(String.init) ?? "—"
        guard let load = set.load else { return "\(reps) rip" }
        return ex.loadType == "level"
            ? "\(reps) × liv \(Int(load))"
            : "\(reps) × \(load.formatted(.number.precision(.fractionLength(0...1)))) kg"
    }

    private func markDone(ex: LiveExercise, set: LiveSet) {
        let at = Date()
        guard store.mergeSetDone(uid: set.uid, reps: set.reps, load: set.load,
                                 incline: set.incline, doneAt: at) else { return }
        if ex.restSeconds > 0 {
            RestNotifier.schedule(seconds: TimeInterval(ex.restSeconds),
                                  body: "\(ex.name) — pronto per la serie successiva")
        }
    }
}
