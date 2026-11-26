import type { FromBandeja as FromBandejaFacts } from '../../bandeja.ts';
import { t } from '../../i18n/i18n.ts';
import { hablarHash } from '../../selection.ts';

// The way back from an item page to the Bandeja note it was refined from: «salió de la Bandeja ·
// "…"», which opens Hablar, where the Bandeja is. Nothing at all for an item that came from elsewhere.
export function FromBandeja({ from }: { from: FromBandejaFacts | undefined }) {
  if (!from) return null;
  return (
    <p className="hb-from bn-from">
      <a href={hablarHash()}>{t('bandeja.from', { snippet: from.snippet })}</a>
    </p>
  );
}
