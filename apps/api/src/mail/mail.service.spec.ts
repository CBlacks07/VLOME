import { MailService } from './mail.service';

const ENV_KEYS = ['RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_REPLY_TO', 'ADMIN_NOTIFY_EMAIL'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }); });
afterEach(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); jest.restoreAllMocks(); });

describe('MailService (Resend)', () => {
  it('envoie par l\'API Resend avec expéditeur no-reply et réponses vers la boîte de l\'équipe', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    const mail = new MailService();
    expect(mail.provider).toBe('resend');
    await expect(mail.send('joueur@x.tg', 'Sujet', '<p>Bonjour</p>')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer re_test' });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ from: 'Miabe Esport <no-reply@miabe-esport.community>', to: ['joueur@x.tg'], subject: 'Sujet', reply_to: 'miabeapeto@miabe-esport.community' });
  });

  it("renvoie false (sans lever) quand Resend refuse, et diagnose remonte le message exact", async () => {
    process.env.RESEND_API_KEY = 're_test';
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('{"message":"The domain is not verified."}', { status: 403 }));
    const mail = new MailService();
    await expect(mail.send('a@b.tg', 'S', '<p>x</p>')).resolves.toBe(false);
    await expect(mail.diagnose('a@b.tg')).resolves.toMatchObject({ provider: 'resend', sent: false, error: expect.stringContaining('domain is not verified') });
  });

  it('sans aucune configuration : rien n\'est envoyé et le diagnostic le dit', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const mail = new MailService();
    expect(mail.provider).toBe('none');
    await expect(mail.send('a@b.tg', 'S', '<p>x</p>')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(mail.diagnose()).resolves.toMatchObject({ configured: false, connection: 'unconfigured' });
  });

  it("l'équipe est prévenue à l'adresse ADMIN_NOTIFY_EMAIL, sinon à l'adresse de réponse", () => {
    process.env.RESEND_API_KEY = 're_test';
    expect(new MailService().teamEmail).toBe('miabeapeto@miabe-esport.community');
    process.env.ADMIN_NOTIFY_EMAIL = 'equipe@x.tg';
    expect(new MailService().teamEmail).toBe('equipe@x.tg');
  });
});
