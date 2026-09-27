// Roofs are built from a straight skeleton loaded as WebAssembly; load it before any test runs,
// as the app does at start-up.
import { initRoofSkeleton } from '../lib/roofSkeleton';

await initRoofSkeleton();
