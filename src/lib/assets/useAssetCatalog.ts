import { useEffect, useMemo, useState } from 'react';
import { FALLBACK_CATALOG, loadCatalogIndex } from './catalog';
import type { AssetSummary, CatalogIndex } from './types';

export function useAssetCatalog(kind?: AssetSummary['kind']) {
  const [catalog, setCatalog] = useState<CatalogIndex>(FALLBACK_CATALOG);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadCatalogIndex('/polyhaven/catalog.v1.json', controller.signal).then(next => {
      setCatalog(next);
      setFallback(next === FALLBACK_CATALOG || next.release === FALLBACK_CATALOG.release);
    }).catch(() => {
      // Aborting a catalog request during test teardown or route changes is expected.
      // Keep the bundled fallback and, importantly, consume the rejected promise.
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const assets = useMemo(() => kind ? catalog.assets.filter(asset => asset.kind === kind) : catalog.assets, [catalog, kind]);
  return { catalog, assets, loading, fallback };
}
