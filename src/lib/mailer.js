import nodemailer from 'nodemailer';

export function createTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: pass.replace(/\s+/g, '') },
    pool: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

export async function send({ subject, html, text }, { transport } = {}) {
  const to = process.env.ALERT_TO || process.env.GMAIL_USER;
  if (!to) throw new Error('ALERT_TO (or GMAIL_USER) must be set');

  const tx = transport || createTransport();
  const info = await tx.sendMail({
    from: `"DJI Price Watch" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
  return info;
}
