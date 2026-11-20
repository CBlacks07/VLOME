import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Envoi d'e-mails transactionnels (SMTP).
 *
 * Deux principes :
 * - Aucune configuration => aucun envoi, mais l'application démarre et fonctionne normalement.
 *   Le site doit rester utilisable même si la messagerie est mal réglée ou indisponible.
 * - Un échec d'envoi ne fait JAMAIS échouer l'action métier : on ne va pas annuler une inscription
 *   à un tournoi parce que le serveur de mail n'a pas répondu. L'erreur est journalisée, c'est tout.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transporter: nodemailer.Transporter | null = null;
  /** Exposé à l'admin (booléen) pour diagnostiquer sans accès au serveur. */
  readonly configured: boolean;
  private readonly from: string;
  readonly siteUrl: string;
  private readonly host: string;
  private readonly port: number;

  constructor() {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    this.siteUrl = (process.env.SITE_URL?.trim() || 'https://www.miabe-esport.community').replace(/\/$/, '');
    this.from = process.env.MAIL_FROM?.trim() || (user ? `Miabe Esport <${user}>` : '');
    this.host = host || '';
    this.port = Number(process.env.SMTP_PORT) || 465;
    this.configured = !!(host && user && pass);
    if (!this.configured) {
      this.logger.warn("SMTP non configuré : aucun e-mail ne sera envoyé (mot de passe oublié, confirmations…).");
      return;
    }
    const port = Number(process.env.SMTP_PORT) || 465;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = TLS implicite (Zoho) ; 587 = STARTTLS
      auth: { user: user!, pass },
    });
  }

  /** Envoie un e-mail. Ne lève jamais : renvoie simplement false si l'envoi n'a pas eu lieu. */
  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, text: htmlToText(html) });
      return true;
    } catch (e) {
      this.logger.error(`Envoi impossible vers ${to} (« ${subject} ») : ${(e as Error).message}`);
      return false;
    }
  }

  /** Diagnostic pour l'admin (jamais de secret) : réglages présents, connexion au serveur SMTP, et — si `to` est fourni — envoi réel d'un
   *  e-mail de test avec le message d'erreur exact du serveur en cas d'échec. */
  async diagnose(to?: string): Promise<{ configured: boolean; host: string; port: number; from: string; siteUrl: string; connection: 'ok' | 'error' | 'unconfigured'; error?: string; sent?: boolean }> {
    const base = { configured: this.configured, host: this.host, port: this.port, from: this.from, siteUrl: this.siteUrl };
    if (!this.transporter) return { ...base, connection: 'unconfigured', error: 'Aucun réglage SMTP : il manque SMTP_HOST, SMTP_USER ou SMTP_PASS sur le serveur.' };
    try {
      await this.transporter.verify();
    } catch (e) {
      return { ...base, connection: 'error', error: (e as Error).message };
    }
    if (!to) return { ...base, connection: 'ok' };
    try {
      await this.transporter.sendMail({
        from: this.from, to, subject: 'Test de messagerie — Miabe Esport',
        html: this.layout('La messagerie fonctionne', '<p>Si tu lis ce message, le site peut envoyer des e-mails (mot de passe oublié, validations, confirmations…).</p>'),
        text: 'Si tu lis ce message, le site peut envoyer des e-mails.',
      });
      return { ...base, connection: 'ok', sent: true };
    } catch (e) {
      return { ...base, connection: 'ok', sent: false, error: (e as Error).message };
    }
  }

  /** Gabarit commun : en-tête de marque, contenu, pied de page — pour que tous les e-mails se ressemblent. */
  layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
    const button = cta
      ? `<p style="margin:26px 0"><a href="${cta.url}" style="display:inline-block;background:#22D3EE;color:#04222a;text-decoration:none;font-weight:700;font-size:15px;padding:13px 24px;border-radius:10px">${cta.label}</a></p>
         <p style="font-size:12px;color:#8E8FA6;margin:0">Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br><span style="color:#22D3EE;word-break:break-all">${cta.url}</span></p>`
      : '';
    return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#0B0B11;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:560px;margin:0 auto;background:#14141D;border:1px solid #282838;border-radius:16px;padding:32px 28px;color:#F4F5FB">
        <div style="font-size:22px;font-weight:800;letter-spacing:1.5px;margin-bottom:24px">MIABE <span style="color:#22D3EE">ESPORT</span></div>
        <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
        <div style="font-size:14.5px;line-height:1.7;color:#C9CBD8">${bodyHtml}</div>
        ${button}
        <hr style="border:0;border-top:1px solid #282838;margin:28px 0 16px" />
        <div style="font-size:12px;color:#5D5E72">Miabe Esport — le hub de l'esport togolais.<br><a href="${this.siteUrl}" style="color:#22D3EE;text-decoration:none">${this.siteUrl.replace(/^https?:\/\//, '')}</a></div>
      </div></body></html>`;
  }
}

/** Neutralise le HTML d'une donnée saisie par l'utilisateur (nom, référence…) insérée dans un e-mail. */
export function escapeHtml(v: string | null | undefined): string {
  return (v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Version texte brut, pour les clients de messagerie qui n'affichent pas le HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
