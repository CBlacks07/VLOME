import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Envoi d'e-mails transactionnels.
 *
 * Deux fournisseurs, choisis par la configuration du serveur :
 * - Resend (recommandé) : variable RESEND_API_KEY. Envoi par API HTTPS (aucun port SMTP à ouvrir), domaine à vérifier dans Resend.
 * - SMTP (secours, ex. Zoho) : SMTP_HOST / SMTP_USER / SMTP_PASS (+ SMTP_PORT).
 * Si les deux sont présents, Resend l'emporte.
 *
 * Deux principes :
 * - Aucune configuration => aucun envoi, mais l'application démarre et fonctionne normalement.
 *   Le site doit rester utilisable même si la messagerie est mal réglée ou indisponible.
 * - Un échec d'envoi ne fait JAMAIS échouer l'action métier : on ne va pas annuler une inscription
 *   à un tournoi parce que le serveur de mail n'a pas répondu. L'erreur est journalisée, c'est tout.
 *
 * Réglages facultatifs : MAIL_FROM (expéditeur), MAIL_REPLY_TO (adresse qui reçoit les réponses des joueurs),
 * ADMIN_NOTIFY_EMAIL (équipe prévenue des demandes à valider), SITE_URL.
 */
const DEFAULT_REPLY_TO = 'miabeapeto@miabe-esport.community';
const DEFAULT_RESEND_FROM = 'Miabe Esport <no-reply@miabe-esport.community>';

export type MailProvider = 'resend' | 'smtp' | 'none';

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transporter: nodemailer.Transporter | null = null;
  private readonly resendKey: string;
  /** Exposé à l'admin (booléen) pour diagnostiquer sans accès au serveur. */
  readonly configured: boolean;
  readonly provider: MailProvider;
  private readonly from: string;
  /** Adresse qui reçoit les réponses des destinataires (les e-mails partent d'une adresse « no-reply »). */
  readonly replyTo: string;
  /** Adresse de l'équipe, prévenue des demandes à valider (organisateur, association). */
  readonly teamEmail: string;
  readonly siteUrl: string;
  private readonly host: string;
  private readonly port: number;

  constructor() {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    this.resendKey = process.env.RESEND_API_KEY?.trim() || '';
    this.siteUrl = (process.env.SITE_URL?.trim() || 'https://www.miabe-esport.community').replace(/\/$/, '');
    this.replyTo = process.env.MAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO;
    this.teamEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || this.replyTo;
    this.host = this.resendKey ? 'api.resend.com' : host || '';
    this.port = Number(process.env.SMTP_PORT) || 465;
    const smtpOk = !!(host && user && pass);
    this.provider = this.resendKey ? 'resend' : smtpOk ? 'smtp' : 'none';
    this.configured = this.provider !== 'none';
    this.from = process.env.MAIL_FROM?.trim() || (this.provider === 'resend' ? DEFAULT_RESEND_FROM : user ? `Miabe Esport <${user}>` : '');
    if (this.provider === 'none') {
      this.logger.warn("Aucune messagerie configurée (RESEND_API_KEY ou SMTP_*) : aucun e-mail ne sera envoyé (mot de passe oublié, confirmations…).");
      return;
    }
    if (this.provider === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host, port: this.port,
        secure: this.port === 465, // 465 = TLS implicite (Zoho) ; 587 = STARTTLS
        auth: { user: user!, pass },
      });
    }
  }

  /** Envoi par l'API Resend. Lève une Error portant le message exact du service. */
  private async sendViaResend(to: string, subject: string, html: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject, html, text: htmlToText(html), reply_to: this.replyTo }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string; name?: string } | null;
      throw new Error(`Resend ${res.status}${body?.message ? ` — ${body.message}` : ''}`);
    }
  }

  /** Envoi brut (fournisseur actif). Lève en cas d'échec. */
  private async deliver(to: string, subject: string, html: string): Promise<void> {
    if (this.provider === 'resend') return this.sendViaResend(to, subject, html);
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.from, to, subject, html, text: htmlToText(html), replyTo: this.replyTo });
      return;
    }
    throw new Error('Messagerie non configurée.');
  }

  /** Envoie un e-mail. Ne lève jamais : renvoie simplement false si l'envoi n'a pas eu lieu. */
  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (this.provider === 'none' || !to) return false;
    try {
      await this.deliver(to, subject, html);
      return true;
    } catch (e) {
      this.logger.error(`Envoi impossible vers ${to} (« ${subject} ») : ${(e as Error).message}`);
      return false;
    }
  }

  /** Prévient l'équipe Miabe (demande d'organisateur / d'association à valider…). Best-effort. */
  notifyTeam(subject: string, title: string, bodyHtml: string, cta?: { label: string; url: string }): Promise<boolean> {
    return this.send(this.teamEmail, subject, this.layout(title, bodyHtml, cta));
  }

  /** Diagnostic pour l'admin (jamais de secret) : réglages présents, connexion au serveur d'envoi, et — si `to` est fourni — envoi réel
   *  d'un e-mail de test avec le message d'erreur exact du fournisseur en cas d'échec. */
  async diagnose(to?: string): Promise<{ configured: boolean; provider: MailProvider; host: string; port: number; from: string; replyTo: string; siteUrl: string; connection: 'ok' | 'error' | 'unconfigured'; error?: string; sent?: boolean }> {
    const base = { configured: this.configured, provider: this.provider, host: this.host, port: this.provider === 'resend' ? 443 : this.port, from: this.from, replyTo: this.replyTo, siteUrl: this.siteUrl };
    if (this.provider === 'none') return { ...base, connection: 'unconfigured', error: 'Aucun réglage de messagerie : ajoute RESEND_API_KEY (ou SMTP_HOST, SMTP_USER, SMTP_PASS) sur le serveur.' };
    if (this.transporter) {
      try { await this.transporter.verify(); } catch (e) { return { ...base, connection: 'error', error: (e as Error).message }; }
    }
    if (!to) return { ...base, connection: 'ok' };
    try {
      await this.deliver(to, 'Test de messagerie — Miabe Esport', this.layout('La messagerie fonctionne', '<p>Si tu lis ce message, le site peut envoyer des e-mails (mot de passe oublié, validations, confirmations…).</p>'));
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
        <div style="font-size:12px;color:#5D5E72">Miabe Esport — le hub de l'esport togolais.<br><a href="${this.siteUrl}" style="color:#22D3EE;text-decoration:none">${this.siteUrl.replace(/^https?:\/\//, '')}</a><br>Une question ? Réponds simplement à cet e-mail.</div>
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
