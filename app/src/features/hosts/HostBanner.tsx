// Bandeau d'hôte de l'accueil, au dessus de chaque onglet. Un seul à la fois, décidé par
// `hostBanner` (`net/failover.ts`). Tout est dit en texte : nom du Mac et état, jamais la
// seule couleur.
import { useState } from 'react';
import { Alert } from 'react-native';

import { Banner } from '@/ui/States';
import { useFailover } from '@/store/failover';
import { goToHost } from './failoverWatch';
import { t } from '@/i18n/en';

export function HostBanner() {
  const banner = useFailover((s) => s.banner);
  const [busy, setBusy] = useState(false);
  if (!banner) return null;

  const go = (id: string) => {
    if (busy) return;
    setBusy(true);
    goToHost(id).catch((error: unknown) => {
      setBusy(false);
      Alert.alert(t.settingsHostSwitchFailed(error instanceof Error ? error.message : String(error)));
    });
  };

  if (banner.kind === 'failedOver') {
    return <Banner tone="warn" text={t.hostFailedOverBanner(banner.from, banner.here)} />;
  }
  if (banner.kind === 'returnAvailable') {
    return (
      <Banner
        text={t.hostReturnBanner(banner.to.name)}
        actionLabel={busy ? t.hostSwitching : t.hostReturnAction}
        onAction={() => go(banner.to.id)}
      />
    );
  }
  return (
    <Banner
      tone="warn"
      text={t.hostOfferBanner(banner.to.name)}
      actionLabel={busy ? t.hostSwitching : t.settingsHostSwitchAction}
      onAction={() => go(banner.to.id)}
    />
  );
}
