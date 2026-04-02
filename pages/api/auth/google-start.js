import crypto from 'crypto'

export default function handler(req, res) {
  const state = crypto.randomBytes(16).toString('hex')
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/'

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const redirectUri = `${protocol}://${host}/api/auth/google-callback`

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: `${state}:${encodeURIComponent(returnTo)}`,
    access_type: 'online',
    prompt: 'select_account',
  })

  res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`)
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
