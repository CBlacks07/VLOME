import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Global : la messagerie est transverse (auth, tournois, boutique, admin) — évite de la réimporter
// dans chaque module.
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
