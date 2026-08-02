import SwiftUI

struct ContentView: View {
    @StateObject private var link = PhoneLink.shared
    @State private var lastMessage = "—"

    var body: some View {
        VStack(spacing: 6) {
            Text("Pallade").font(.headline)
            Text(link.isReachable ? "iPhone raggiungibile" : "iPhone non raggiungibile")
                .font(.caption2)
                .foregroundStyle(link.isReachable ? .green : .secondary)
            Text(lastMessage).font(.caption2).lineLimit(2)
            Button("Ping") {
                PhoneLink.shared.send(["type": "ping", "at": ISO8601DateFormatter().string(from: Date())],
                                      queued: true)
            }
        }
        .onAppear {
            PhoneLink.shared.onMessage = { msg in
                lastMessage = (msg["type"] as? String) ?? "?"
            }
            PhoneLink.shared.activate()
        }
    }
}
