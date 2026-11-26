import { readEnv } from '../config/env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
export class DevelopmentOutbox implements Mailer {
  async send(message: MailMessage): Promise<void> {
    const env = readEnv();
    if (env.NODE_ENV !== 'development' || !env.AUTH_DEV_OUTBOX)
      throw new Error('Development outbox is disabled');
    const folder = resolve(process.cwd(), '.dev-outbox');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(folder, `${Date.now()}-${randomUUID()}.json`),
      JSON.stringify(message),
      { mode: 0o600, flag: 'wx' },
    );
  }
}
export class ResendMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    const env = readEnv();
    if (env.MAIL_PROVIDER !== 'resend' || !env.MAIL_API_KEY || !env.MAIL_FROM)
      throw new Error('Mail provider is not configured');
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!result.ok) throw new Error('Mail delivery failed');
  }
}
let override: Mailer | undefined;
export function setTestMailer(mailer?: Mailer): void {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Test mailer is test-only');
  override = mailer;
}
export function getMailer(): Mailer {
  if (override) return override;
  const env = readEnv();
  if (env.NODE_ENV === 'development' && env.AUTH_DEV_OUTBOX)
    return new DevelopmentOutbox();
  if (env.MAIL_PROVIDER === 'resend') return new ResendMailer();
  throw new Error('Mail provider is not configured');
}
