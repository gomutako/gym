// =====================================================
// Vue Router: rotte + guardie di autenticazione/ruolo.
// Le viste sono lazy-loaded (code splitting).
// =====================================================
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    // Reset password: vi si arriva dal link nell'email di recupero (Supabase
    // stabilisce una sessione di recovery leggendo il token dall'URL).
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { public: true },
  },
  {
    // Area protetta: usa il layout con bottom navigation
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        // Home: mostra la dashboard giusta in base al ruolo
        path: '',
        name: 'dashboard',
        component: () => import('@/views/HomeDispatcher.vue'),
      },
      {
        path: 'corsi',
        name: 'bookings',
        component: () => import('@/views/member/BookingsView.vue'),
        meta: { roles: ['member', 'admin'] },
      },
      {
        path: 'allenamento',
        name: 'training',
        component: () => import('@/views/member/TrainingView.vue'),
        meta: { roles: ['member'] },
      },
      {
        path: 'allenamento/sessione/:id',
        name: 'session',
        component: () => import('@/views/member/SessionView.vue'),
        meta: { roles: ['member'] },
      },
      {
        path: 'clienti',
        name: 'clients',
        component: () => import('@/views/trainer/ClientsView.vue'),
        meta: { roles: ['trainer', 'admin'] },
      },
      {
        path: 'clienti/:memberId/schede',
        name: 'client-workouts',
        component: () => import('@/views/trainer/WorkoutsView.vue'),
        meta: { roles: ['trainer', 'admin'] },
      },
      {
        path: 'esercizi',
        name: 'exercises',
        component: () => import('@/views/trainer/ExercisesView.vue'),
        meta: { roles: ['trainer', 'admin'] },
      },
      {
        path: 'modelli',
        name: 'templates',
        component: () => import('@/views/trainer/TemplatesView.vue'),
        meta: { roles: ['trainer', 'admin'] },
      },
      {
        path: 'utenti',
        name: 'users',
        component: () => import('@/views/admin/UsersView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'palinsesto',
        name: 'schedule',
        component: () => import('@/views/admin/ClassesView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'profilo',
        name: 'profile',
        component: () => import('@/views/ProfileView.vue'),
      },
    ],
  },
  // Fallback: qualsiasi rotta sconosciuta -> dashboard
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Guardia globale: protegge le rotte e reindirizza in base allo stato di login
router.beforeEach((to) => {
  const auth = useAuthStore();

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login' };
  }
  // Se sei già loggato, la pagina di login ti rimanda alla dashboard
  if (to.name === 'login' && auth.isLoggedIn) {
    return { name: 'dashboard' };
  }

  // Controllo per ruolo (per rotte che dichiarano meta.roles)
  if (to.meta.roles && !to.meta.roles.includes(auth.role)) {
    return { name: 'dashboard' };
  }
});

export default router;
