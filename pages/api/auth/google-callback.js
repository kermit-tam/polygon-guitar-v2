import { getAdminAuth } from '@/lib/admin-db'

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export default async function handler(req, res) {
  const { code, state, error } = req.query

  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return res.redirect('/login?error=missing_params')
  }

  // Validate state cookie
  const cookieState = getCookie(req.headers.cookie, 'oauth_state')
  const [stateToken, encodedReturnTo] = state.split(':')
  const returnTo = encodedReturnTo ? decodeURIComponent(encodedReturnTo) : '/'

  if (!cookieState || cookieState !== stateToken) {
    return res.redirect('/login?error=invalid_state')
  }

  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const redirectUri = `${protocol}://${host}/api/auth/google-callback`

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()

    if (!tokens.access_token) {
      console.error('[google-callback] token exchange failed', tokens)
      return res.redirect('/login?error=token_exchange')
    }

    // Get user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = await userInfoRes.json()

    if (!userInfo.email) {
      return res.redirect('/login?error=no_email')
    }

    // Get or create Firebase user
    const adminAuth = getAdminAuth()
    let firebaseUid
    try {
      const existing = await adminAuth.getUserByEmail(userInfo.email)
      firebaseUid = existing.uid
    } catch {
      const created = await adminAuth.createUser({
        email: userInfo.email,
        displayName: userInfo.name || '',
        photoURL: userInfo.picture || '',
        emailVerified: userInfo.email_verified || false,
      })
      firebaseUid = created.uid
    }

    // Create custom token
    const customToken = await adminAuth.createCustomToken(firebaseUid)

    // Clear state cookie and redirect to login page with token
    res.setHeader('Set-Cookie', 'oauth_state=; HttpOnly; Max-Age=0; Path=/')
    return res.redirect(`/login?customToken=${encodeURIComponent(customToken)}&returnTo=${encodeURIComponent(returnTo)}`)
  } catch (e) {
    console.error('[google-callback]', e?.message)
    return res.redirect('/login?error=server_error')
  }
}
