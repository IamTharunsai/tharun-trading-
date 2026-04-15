import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logger.error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables');
  process.exit(1);
}

// Public client (for user-facing operations, respects RLS policies)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Service role client (for backend admin operations, bypasses RLS)
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY  // Fallback to anon key if service key not available
);

// Helper to verify user JWT token from Supabase
export async function verifySupabaseToken(token: string) {
  try {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return user;
  } catch (err) {
    logger.error('Error verifying Supabase token:', err);
    return null;
  }
}

// Helper to get session from access token
export async function getSessionFromToken(token: string) {
  try {
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) {
      logger.error('Error getting session:', error);
      return null;
    }

    return session;
  } catch (err) {
    logger.error('Error in getSessionFromToken:', err);
    return null;
  }
}

// Helper to create new user during setup
export async function createSupabaseUser(email: string, password: string) {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true  // Auto-confirm email
    });

    if (error) {
      logger.error('Error creating Supabase user:', error);
      throw error;
    }

    return data.user;
  } catch (err) {
    logger.error('Error in createSupabaseUser:', err);
    throw err;
  }
}

// Helper to update user password
export async function updateSupabasePassword(userId: string, password: string) {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });

    if (error) {
      logger.error('Error updating password:', error);
      throw error;
    }

    return data.user;
  } catch (err) {
    logger.error('Error in updateSupabasePassword:', err);
    throw err;
  }
}

// Helper to sign in user
export async function signInSupabaseUser(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logger.error('Error signing in:', error);
      throw error;
    }

    return data;
  } catch (err) {
    logger.error('Error in signInSupabaseUser:', err);
    throw err;
  }
}

// Helper to enable 2FA (TOTP)
export async function generateTOTP() {
  try {
    // This is a simplified version - you may need to implement custom TOTP generation
    // if Supabase doesn't provide this out of the box
    const secret = require('speakeasy').generateSecret({
      name: 'Tharun Agentic Trading',
      issuer: 'TharunTrading'
    });

    return {
      secret: secret.base32,
      qrCode: secret.otpauth_url
    };
  } catch (err) {
    logger.error('Error generating TOTP:', err);
    throw err;
  }
}

export default supabase;
