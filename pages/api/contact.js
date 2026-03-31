import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { name, email, subject, message } = req.body || {}
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Missing fields' })
  }

  try {
    await transporter.sendMail({
      from: `"Polygon Guitar" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      replyTo: email,
      subject: `[Polygon Guitar] ${subject}`,
      text: `姓名：${name}\n電郵：${email}\n主題：${subject}\n\n${message}`,
      html: `<p><strong>姓名：</strong>${name}</p><p><strong>電郵：</strong>${email}</p><p><strong>主題：</strong>${subject}</p><hr/><p>${message.replace(/\n/g, '<br/>')}</p>`,
    })
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('[contact]', e?.message)
    return res.status(500).json({ error: 'Failed to send' })
  }
}
