// =====================================================
// Caricamento variabili d'ambiente.
// Path esplicito a backend/.env così funziona a prescindere
// dalla working directory da cui si lancia il server.
// Va importato PRIMA di qualsiasi modulo che legge process.env.
// =====================================================
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
