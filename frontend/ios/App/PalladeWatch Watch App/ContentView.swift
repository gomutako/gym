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
                    // La sessione invece NON è solo "dati dell'account
                    // uscente": è lo sforzo fisico che chi ha il Watch al
                    // polso sta facendo IN QUESTO MOMENTO. Cosa farne dipende
                    // da PERCHÉ è arrivato il logout, e il messaggio ora lo
                    // dice (`explicit`, vedi notifyWatchLogout in
                    // watch-session.js): true per l'uscita voluta dal profilo
                    // e per la cancellazione account, false per l'uscita
                    // implicita — refresh token scaduto o revocato su un
                    // telefono fermo a lungo in tasca.
                    let explicit = (msg["explicit"] as? Bool) ?? false
                    Task { @MainActor in
                        if explicit {
                            // L'utente ha detto che questo telefono non è più
                            // suo. Da qui in poi le serie di questo
                            // allenamento non sono più salvabili DA NESSUNA
                            // PARTE: `resolveSessionId` (watch-session.js)
                            // risolve solo dentro il `member_id` di chi è
                            // connesso, quindi ogni `set_done` successivo
                            // esaurirebbe i cinque tentativi e verrebbe
                            // scartato. Tenere aperta la sessione non
                            // salverebbe nulla, e intanto ExecutionView
                            // resterebbe a schermo con giornata, nomi degli
                            // esercizi, ripetizioni e carichi dell'account
                            // appena uscito — la stessa classe di fuga di
                            // `pendingAdoption` qui sopra, ma visibile invece
                            // che latente. Si chiude quindi l'allenamento per
                            // davvero: `end()` finalizza e SALVA in Salute
                            // (frequenza, calorie, durata restano all'utente,
                            // che è dove appartengono), invece di lasciare una
                            // HKWorkoutSession viva senza interfaccia — lo
                            // slot di sistema è uno solo e resterebbe occupato.
                            //
                            // ⚠️ `state == .running` NON è ridondante, ed è la
                            // stessa condizione (per la stessa ragione) del
                            // guard in `didChangeTo` di WorkoutController. Ogni
                            // altro chiamante di `end()` è il tasto "Fine" di
                            // ExecutionView, che esiste solo quando lo stato è
                            // già `.running`; questo invece può arrivare in
                            // qualunque istante, compresa la finestra dentro
                            // `start()` in cui `session`/`builder` sono già
                            // assegnati ma `state` non è ancora `.running`
                            // (fino a 8s, il timeout per "allenamento già
                            // attivo altrove"). Lì `takeOwnershipForFinalization`
                            // riuscirebbe e `finalize()` chiamerebbe
                            // endCollection/finishWorkout mentre `start()`
                            // aspetta ancora `beginCollection` sullo STESSO
                            // HKLiveWorkoutBuilder — due chiamate di lifecycle
                            // concorrenti, non supportate da HealthKit. E se
                            // poi `beginCollection` vincesse la corsa, `start()`
                            // scriverebbe `.running` sopra `.ended` con
                            // session/builder ormai nil: `end()` diventerebbe
                            // un no-op e il `guard state != .running` di
                            // `start()` rifiuterebbe per sempre ogni nuovo
                            // allenamento fino al riavvio dell'app.
                            if WorkoutController.shared.state == .running {
                                await WorkoutController.shared.end()
                            }
                            SessionStore.shared.close()
                        } else if WorkoutController.shared.state != .running {
                            SessionStore.shared.close()
                        } else {
                            // Uscita implicita: l'utente non è cambiato, molto
                            // probabilmente rientrerà con lo stesso account e
                            // le serie di questo allenamento si risolveranno
                            // regolarmente. Interromperglielo qui sarebbe
                            // distruggere uno sforzo fisico reale per un
                            // evento di cui non si è nemmeno accorto. Si
                            // cancella però la copia su DISCO: lasciarla
                            // creerebbe un session.json che nessuna
                            // interfaccia potrà più togliere e che sopprime
                            // per sempre il banner di adozione (vedi
                            // SessionStore.forgetPersisted()).
                            SessionStore.shared.forgetPersisted()
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
            // `target_reps`/`has_incline`: senza queste due chiavi una
            // sessione nata al polso arriva sull'iPhone con "3x" invece di
            // "3x10" e senza colonna inclinazione — `CachedExercise` le
            // porta già (popolate da watch-catalog.js), ma `begin()` non le
            // copiava in `LiveExercise`.
            //
            // NESSUN campo opzionale qui usa NSNull(): WatchConnectivity
            // accetta solo tipi property-list (NSString, NSNumber, NSDate,
            // NSData, NSArray, NSDictionary), e NSNull non è uno di questi —
            // un payload che lo contiene, anche una sola volta e in un
            // punto qualsiasi (anche annidato in `sets_log`), viene scartato
            // per INTERO e in silenzio: non un crash, non un errore,
            // l'error handler di PhoneLink.send è vuoto di proposito per il
            // traffico best-effort. `load` è quasi sempre nil qui — è il
            // caso normale alla prima volta su un esercizio, senza sessione
            // precedente da cui precompilare — quindi senza omettere la
            // chiave, `session_started` non arriverebbe MAI per la maggior
            // parte degli allenamenti, e l'iPhone non saprebbe che la
            // sessione esiste. Regola: quando un valore manca si OMETTE LA
            // CHIAVE, mai `null`.
            var row: [String: Any] = [
                "exercise_id": ex.exerciseId,
                "rest_seconds": ex.restSeconds,
                "load_type": ex.loadType,
                "has_incline": ex.hasIncline,
                "sets_log": ex.sets.map { r -> [String: Any] in
                    var setRow: [String: Any] = [
                        "uid": r.uid,
                        "done": r.done,
                    ]
                    if let reps = r.reps { setRow["reps"] = reps }
                    if let load = r.load { setRow["load"] = load }
                    if let inc = r.incline { setRow["incline"] = inc }
                    return setRow
                },
            ]
            if let targetReps = ex.targetReps { row["target_reps"] = targetReps }
            return row as [String: Any]
        },
    ]
}
