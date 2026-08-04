import SwiftUI

struct ContentView: View {
    @StateObject private var workout = WorkoutController.shared
    @StateObject private var store = SessionStore.shared
    @State private var error: String?
    /// Sessione aperta sull'iPhone offerta in adozione al Watch, letta con
    /// `PhoneLink.shared.requestState` all'apertura. `nil` finché non arriva
    /// una risposta, o se non c'è nulla da riprendere.
    @State private var pendingAdoption: [String: Any]?

    /// Il messaggio di un salvataggio fallito vive in `workout.state`, non in
    /// `error`: senza intercettarlo qui, `.failed` cade nel ramo `else` (che
    /// mostra il picker) e l'utente torna all'inizio credendo che
    /// l'allenamento sia stato salvato in Salute quando non lo è. Perso una
    /// volta già in un refactoring precedente — chi tocca questa vista in
    /// futuro: se sposti di nuovo la logica dei rami, porta con te anche
    /// questo computed.
    private var savedFailureMessage: String? {
        if case .failed(let message) = workout.state { return message }
        return nil
    }

    var body: some View {
        Group {
            if workout.state == .running, store.session != nil {
                ExecutionView {
                    Task {
                        let id = store.session?.clientSessionId ?? ""
                        await workout.end()
                        PhoneLink.shared.send([
                            "type": "session_closed",
                            "client_session_id": id,
                            "completed_at": ISO8601DateFormatter.withFraction.string(from: Date()),
                        ], queued: true)
                        store.close()
                    }
                }
            } else {
                PickerView(onPick: { w, d in
                    Task {
                        guard await workout.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        let live = store.begin(workout: w, day: d)
                        // Inviato SOLO dopo che `start()` è tornato: prima
                        // girava invertito rispetto al flusso della spec
                        // (startActivity prima dell'invio). Sul percorso di
                        // fallimento previsto — l'utente ha un altro
                        // allenamento aperto nell'app Allenamento, `start()`
                        // lancia dopo il timeout di 8s — `transferUserInfo`
                        // accodato non si può richiamare indietro: un invio
                        // anticipato materializzerebbe sull'iPhone una riga
                        // "in corso" orfana, mai completata, rimovibile solo
                        // a mano.
                        do {
                            try await workout.start()
                            PhoneLink.shared.send(sessionStartedPayload(live), queued: true)
                        }
                        catch {
                            store.close()
                            self.error = error.localizedDescription
                        }
                    }
                }, adoption: pendingAdoption, onAdopt: {
                    guard let pending = pendingAdoption else { return }
                    // `uniquingKeysWith`, non `uniqueKeysWithValues`: lo
                    // stesso esercizio compare in più giornate e più schede,
                    // e il costruttore che pretende chiavi uniche va in
                    // crash a runtime sui duplicati.
                    let names = Dictionary(
                        CatalogStore.shared.workouts
                            .flatMap { $0.days }.flatMap { $0.exercises }
                            .map { ($0.exerciseId, $0.name) },
                        uniquingKeysWith: { first, _ in first })
                    guard SessionStore.shared.adopt(pending, nameFor: { names[$0] ?? "Esercizio" })
                    else {
                        error = "Questo allenamento è stato creato con una versione precedente e non si può riprendere dal Watch."
                        pendingAdoption = nil
                        return
                    }
                    Task {
                        guard await WorkoutController.shared.requestAuth() else {
                            error = "Senza accesso a Salute non posso registrare l'allenamento."
                            SessionStore.shared.close()
                            return
                        }
                        _ = await RestNotifier.requestPermission()
                        // `pendingAdoption = nil` SOLO sul successo: prima
                        // girava dopo il do/catch, quindi scattava anche sul
                        // fallimento ritentabile di `start()` (l'utente ha
                        // un altro allenamento aperto altrove) e faceva
                        // sparire il banner "Riprendi" — l'unico posto da
                        // cui riparte è `requestState` in `onAppear`, quindi
                        // dopo aver chiuso l'altro allenamento non c'era più
                        // modo di tornare indietro. Il ramo di permesso
                        // negato sopra, che non è ritentabile senza passare
                        // da Impostazioni, non tocca `pendingAdoption` ed è
                        // già corretto così.
                        do {
                            try await WorkoutController.shared.start()
                            pendingAdoption = nil
                        }
                        catch {
                            SessionStore.shared.close()
                            self.error = error.localizedDescription
                        }
                    }
                })
                .overlay(alignment: .bottom) {
                    // Precedenza al salvataggio fallito, anche se `error` è
                    // più recente: un `.failed` non ancora riconosciuto
                    // dall'utente rappresenta un allenamento perso, mentre un
                    // errore di avvio è recuperabile con un nuovo tentativo.
                    // Meglio rischiare di mostrare un messaggio "vecchio" che
                    // farne sparire uno su un dato che non si può più
                    // recuperare.
                    if let message = savedFailureMessage ?? error {
                        Text(message).font(.caption2).foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
            }
        }
        .onAppear {
            PhoneLink.shared.onMessage = { msg in
                // Messaggio dedicato, non un catalogo/contesto vuoto: dice
                // esplicitamente cosa significa (l'utente sul telefono è
                // uscito o l'account non esiste più), invece di lasciare che
                // CatalogStore.apply lo confonda con un catalogo
                // legittimamente vuoto. Inviato da watch-session.js sugli
                // stessi tre percorsi che già cancellano
                // watchlink-state.json: uscita esplicita, uscita implicita
                // (token scaduto/revocato), cancellazione account.
                if (msg["type"] as? String) == "logout" {
                    // Il catalogo è dati DELL'ALTRO account (schede, esercizi,
                    // carichi suggeriti): va sempre svuotato, o il prossimo
                    // utente lo vedrebbe ancora finché non arriva un nuovo
                    // push (vedi CatalogStore.clear()).
                    CatalogStore.shared.clear()
                    // `pendingAdoption` è la STESSA classe di minaccia, ma sul
                    // lato lettura: contiene lo snapshot (giornata + intero
                    // exercises_log) dell'allenamento aperto sull'iPhone
                    // dell'account che sta uscendo. Senza cancellarlo qui,
                    // resta nello `@State` di questa view — invisibile finché
                    // il catalogo è vuoto (PickerView nasconde il banner), ma
                    // pronto a ricomparire come "Riprendi <giornata>" con le
                    // serie e i carichi di chi ha appena fatto logout non
                    // appena arriva il primo `pushCatalog` del prossimo
                    // utente. Adottarlo non potrebbe scrivere sui dati
                    // dell'altro account (`resolveSessionId` in
                    // watch-session.js filtra per `member_id`), ma è comunque
                    // una lettura a cui il nuovo utente non ha diritto — la
                    // stessa minaccia per cui sono già passati tre round.
                    pendingAdoption = nil
                    // La sessione invece NON è "dati dell'account uscente": è
                    // lo sforzo fisico che chi ha il Watch al polso sta
                    // facendo IN QUESTO MOMENTO. Chiuderla incondizionatamente
                    // (come faceva prima) cancella un allenamento in corso
                    // ogni volta che il token dell'iPhone scade con lo
                    // schermo bloccato in tasca — il messaggio "logout" arriva
                    // anche lì, e in quel caso l'utente non è affatto
                    // cambiato: non c'è nessuna ragione di privacy per
                    // interrompergli l'allenamento, la UI cadrebbe su
                    // PickerView e il recupero (rientrare scegliendo di nuovo
                    // la giornata) è tutt'altro che ovvio.
                    //
                    // Scelta deliberata, non per omissione: non chiudere MAI
                    // una sessione in corso su "logout", nemmeno quando è un
                    // logout ESPLICITO con vero cambio di account. Due motivi.
                    // Primo, il Watch non può distinguere i due casi: lo
                    // stesso messaggio "logout" arriva sui tre percorsi
                    // (uscita esplicita, uscita implicita per token
                    // scaduto/revocato, cancellazione account — vedi
                    // notifyWatchLogout in watch-session.js), senza portare
                    // CHI o PERCHÉ. Costruire un comportamento diverso per
                    // "esplicito" richiederebbe indovinare una distinzione che
                    // il messaggio non porta. Secondo, anche nel caso peggiore
                    // (account davvero cambiato, workout lasciato aperto) non
                    // trapela nulla di nuovo: il rischio è già coperto sul
                    // lato SCRITTURA da `resolveSessionId`, che filtra sempre
                    // per `member_id` — un `set_done`/`session_closed` di
                    // questa sessione non potrà mai applicarsi alla riga di un
                    // altro account, al più finisce scartato dopo i tentativi
                    // di retry, esattamente come già succede oggi per un
                    // client_session_id orfano. Chiuderla a forza qui
                    // distruggerebbe con certezza uno sforzo fisico reale, la
                    // stessa classe di perdita che questo branch insegue da
                    // cinque round, in cambio di un beneficio di privacy che
                    // nel caso peggiore non si materializza comunque.
                    Task { @MainActor in
                        if WorkoutController.shared.state != .running {
                            SessionStore.shared.close()
                        }
                    }
                    return
                }
                if CatalogStore.shared.apply(msg) { return }
                Task { @MainActor in SessionStore.shared.apply(msg) }
            }
            PhoneLink.shared.activate()
            // Solo se non è già in corso una sessione al polso: altrimenti
            // un aggancio arrivato in ritardo rimpiazzerebbe silenziosamente
            // un allenamento già iniziato qui.
            PhoneLink.shared.requestState { payload in
                guard let payload, SessionStore.shared.session == nil else { return }
                pendingAdoption = payload
            }
        }
    }
}

/// Snapshot completo per l'iPhone. Deve bastare a creare la riga Supabase da
/// solo: l'app iPhone potrebbe non essere mai stata aperta durante
/// l'allenamento.
private func sessionStartedPayload(_ s: LiveSession) -> [String: Any] {
    [
        "type": "session_started",
        "client_session_id": s.clientSessionId,
        "workout_id": s.workoutId,
        "workout_title": s.workoutTitle,
        "day_index": s.dayIndex,
        "day_name": s.dayName,
        "started_at": ISO8601DateFormatter.withFraction.string(from: s.startedAt),
        "exercises_log": s.exercises.map { ex in
            [
                "exercise_id": ex.exerciseId,
                // `target_reps`/`has_incline`: senza queste due chiavi una
                // sessione nata al polso arriva sull'iPhone con "3x" invece
                // di "3x10" e senza colonna inclinazione — `CachedExercise`
                // le porta già (popolate da watch-catalog.js), ma `begin()`
                // non le copiava in `LiveExercise`. `target_reps` come gli
                // altri opzionali di questo payload (`as Any? ?? NSNull()`,
                // mai `as Any` nudo: un Optional.none incapsulato da solo fa
                // scartare l'INTERO payload da WatchConnectivity).
                "target_reps": ex.targetReps as Any? ?? NSNull(),
                "rest_seconds": ex.restSeconds,
                "load_type": ex.loadType,
                "has_incline": ex.hasIncline,
                "sets_log": ex.sets.map { r -> [String: Any] in
                    // `as Any? ?? NSNull()`, non `as Any`: un Optional.none
                    // incapsulato da solo rende il dizionario non
                    // deserializzabile da WatchConnectivity, che scarta
                    // l'INTERO payload in silenzio (stesso pattern già
                    // corretto in WorkoutController.publishBiometrics e
                    // HealthKitLivePlugin.swift). `load` è quasi sempre nil
                    // qui — è il caso normale alla prima volta su un
                    // esercizio, senza sessione precedente da cui
                    // precompilare — quindi senza questo fix session_started
                    // non arriverebbe MAI per la maggior parte degli
                    // allenamenti, e l'iPhone non saprebbe che la sessione
                    // esiste.
                    var row: [String: Any] = [
                        "uid": r.uid,
                        "reps": r.reps as Any? ?? NSNull(),
                        "load": r.load as Any? ?? NSNull(),
                        "done": r.done,
                    ]
                    if let inc = r.incline { row["incline"] = inc }
                    return row
                },
            ] as [String: Any]
        },
    ]
}
