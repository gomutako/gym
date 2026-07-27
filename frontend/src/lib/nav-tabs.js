// =====================================================
// Voci di navigazione, in un unico posto: le consumano sia BottomNav.vue (web)
// sia la tab bar nativa iOS. Tenerle in due elenchi separati significherebbe
// che ogni voce nuova va aggiunta due volte, e prima o poi divergono.
//
// `name` è il nome della rotta Vue, `icon` il nome dell'SVG inline usato dal
// web, `symbol` l'SF Symbol equivalente usato da UIKit.
// =====================================================
const HOME = { name: 'dashboard', label: 'Home', icon: 'home', symbol: 'house.fill' };
const PROFILE = { name: 'profile', label: 'Profilo', icon: 'user', symbol: 'person.crop.circle.fill' };
const TEMPLATES = { name: 'templates', label: 'Modelli', icon: 'stack', symbol: 'rectangle.stack.fill' };

export function tabsForRole(role) {
  if (role === 'admin') {
    return [
      HOME,
      { name: 'users', label: 'Utenti', icon: 'group', symbol: 'person.2.fill' },
      { name: 'schedule', label: 'Corsi', icon: 'calendar', symbol: 'calendar' },
      TEMPLATES,
      PROFILE,
    ];
  }
  if (role === 'trainer') {
    return [
      HOME,
      { name: 'clients', label: 'Clienti', icon: 'group', symbol: 'person.2.fill' },
      { name: 'exercises', label: 'Esercizi', icon: 'dumbbell', symbol: 'figure.strengthtraining.traditional' },
      TEMPLATES,
      PROFILE,
    ];
  }
  return [
    HOME,
    { name: 'bookings', label: 'Corsi', icon: 'calendar', symbol: 'calendar' },
    { name: 'training', label: 'Allenamenti', icon: 'play', symbol: 'play.circle.fill' },
    PROFILE,
  ];
}
