import { Global, Module } from '@nestjs/common';
import { AssociationsController } from './associations.controller';
import { AssociationsService } from './associations.service';

// Global : l'inscription et le profil joueur préviennent l'association d'une demande d'adhésion (voir notifyJoinRequest).
@Global()
@Module({
  controllers: [AssociationsController],
  providers: [AssociationsService],
  exports: [AssociationsService],
})
export class AssociationsModule {}
