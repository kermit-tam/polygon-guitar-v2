/**
 * Firebase Admin SDK – server only. Use for cache writes so we don't need public write rules.
 *
 * Credentials via (first wins):
 * 1. FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY
 *    (use these on Vercel; private key must be server-only)
 * 2. FIREBASE_SERVICE_ACCOUNT = path to service account JSON (for local dev; file is not in Vercel deploy)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import path from 'path'
import { readFileSync } from 'fs'

let _adminDb = null

function getAdminEnv(key) {
  const unprefixed = process.env[`FIREBASE_ADMIN_${key}`]
  if (unprefixed) return unprefixed
  if (key !== 'PRIVATE_KEY') {
    return process.env[`NEXT_PUBLIC_FIREBASE_ADMIN_${key}`]
  }
  return undefined
}

function initFromServiceAccountFile() {
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!filePath || typeof process.cwd !== 'function') return false
  try {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
    const keyContent = readFileSync(absolutePath, 'utf8')
    const keyJson = JSON.parse(keyContent)
    initializeApp({ credential: cert(keyJson) })
    return true
  } catch (e) {
    console.error('[admin-db] FIREBASE_SERVICE_ACCOUNT read failed', e?.message)
    return false
  }
}

function initFromEnvVars() {
  const privateKey = getAdminEnv('PRIVATE_KEY')?.replace(/\\n/g, '\n')
  const projectId = getAdminEnv('PROJECT_ID')
  const clientEmail = getAdminEnv('CLIENT_EMAIL')
  if (!privateKey || !clientEmail || !projectId) return false
  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey
    })
  })
  return true
}

let _adminAuth = null

export function getAdminAuth() {
  if (_adminAuth) return _adminAuth
  if (typeof window !== 'undefined') return null
  try {
    if (getApps().length === 0) {
      if (!initFromEnvVars() && process.env.FIREBASE_SERVICE_ACCOUNT && !initFromServiceAccountFile()) {
        return null
      }
      if (getApps().length === 0) return null
    }
    const { getAuth } = require('firebase-admin/auth')
    _adminAuth = getAuth()
    return _adminAuth
  } catch (e) {
    console.error('[admin-auth]', e?.message)
    return null
  }
}

export function getAdminDb() {
  if (_adminDb) return _adminDb
  if (typeof window !== 'undefined') return null
  try {
    if (getApps().length === 0) {
      // Prefer env vars (work on Vercel); fall back to file (local dev only)
      if (!initFromEnvVars() && process.env.FIREBASE_SERVICE_ACCOUNT && !initFromServiceAccountFile()) {
        return null
      }
      if (getApps().length === 0) return null
    }
    _adminDb = getFirestore()
    return _adminDb
  } catch (e) {
    console.error('[admin-db]', e?.message)
    return null
  }
}
