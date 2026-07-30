import { supabase } from '../supabaseClient.js';

/**
 * authService wraps Supabase Auth (email + password) and the user's
 * `profiles` row (which carries the app-level role: 'annotator' | 'admin').
 *
 * Nothing here stores a hand-rolled session — Supabase's client already
 * persists a real JWT session in localStorage and keeps it fresh, which is
 * what makes auth.uid() work inside RLS policies and the claim/save RPCs.
 */
export const authService = {
  /**
   * Sign up a new annotator account. First/last name are stored as Supabase
   * Auth user metadata and copied into `profiles` by the `handle_new_user`
   * database trigger (see supabase/migrations/0002_add_names.sql).
   * @param {string} email
   * @param {string} password
   * @param {{ firstName?: string, lastName?: string }} [nameFields]
   */
  async signUp(email, password, { firstName = '', lastName = '' } = {}) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName.trim(), last_name: lastName.trim() },
      },
    });
    if (error) throw new Error(error.message);
    return data.user;
  },

  /**
   * Log in with email + password.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{id: string, email: string, role: string}>}
   */
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return this.getProfile(data.user.id);
  },

  /** Sign out the current user. */
  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  },

  /**
   * Fetch the profile row (id, email, role) for a given auth user id.
   */
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, role, created_at')
      .eq('id', userId)
      .single();

    if (error) throw new Error(`Failed to load profile: ${error.message}`);
    return data;
  },

  /**
   * Get the current Supabase Auth session, or null if not logged in.
   */
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    return data.session;
  },

  /**
   * Get the current logged-in user's profile (id, email, role), or null.
   */
  async getCurrentUser() {
    const session = await this.getSession();
    if (!session?.user) return null;
    try {
      return await this.getProfile(session.user.id);
    } catch {
      return null;
    }
  },

  /** Admin dashboard: list all user profiles (id, email, role). */
  async listProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, role, created_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Failed to load users: ${error.message}`);
    return data;
  },

  /** Admin dashboard: promote another user to the 'admin' role. */
  async promoteToAdmin(userId) {
    const { error } = await supabase.rpc('promote_to_admin', { p_user_id: userId });
    if (error) throw new Error(`Failed to promote user: ${error.message}`);
  },

  /**
   * Subscribe to auth state changes (login/logout/token refresh).
   * Returns an unsubscribe function.
   */
  onAuthStateChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
    return () => data.subscription.unsubscribe();
  },
};
