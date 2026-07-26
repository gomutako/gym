// =====================================================
// Palette del brand: unica sorgente per Tailwind e per il codice.
//
// La scala è derivata dal rosa antico #D3919E (passo 300) conservandone la
// tonalità in OKLCh e variando la profondità: l'app resta *quel* rosa, ma i
// passi profondi possono portare testo, cosa che il 300 non può fare (2,53:1
// sul bianco, sotto la soglia di 4,5:1).
//
// La importa anche tailwind.config.js: duplicare gli hex significherebbe che
// alla prima ritinteggiatura una delle due copie resta indietro — e la copia
// dimenticata sarebbe quella nativa, che non si vede finché non apri l'app.
// =====================================================
export const brand = {
  50: '#FFF2F4',
  100: '#FFE3E8', // fondo delle chip
  200: '#F7C9D1',
  300: '#D3919E', // la tinta scelta: superfici, gradienti, testo del tema scuro
  400: '#C87D8C',
  500: '#B7687A',
  600: '#A45668', // primario: testo, bordi, bottoni pieni, tab attiva (5,11:1)
  700: '#8E4858', // testo su chip rosa (5,41:1), stato premuto
  800: '#743947',
  900: '#5C2D38',
};

/**
 * Tinta della tab bar nativa iOS. Due valori perché la barra vive su due fondi:
 * chiaro (dove serve il passo profondo) e scuro (dove il 300 dà il meglio).
 */
export const tabBarTint = {
  light: brand[600],
  dark: brand[300],
};
