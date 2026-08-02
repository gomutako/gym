import SwiftUI

struct ContentView: View {
    var body: some View {
        PickerView { workout, day in
            print("scelta: \(workout.title) / \(day.name)")
        }
        .onAppear {
            PhoneLink.shared.onMessage = { msg in
                CatalogStore.shared.apply(msg)
            }
            PhoneLink.shared.activate()
        }
    }
}
