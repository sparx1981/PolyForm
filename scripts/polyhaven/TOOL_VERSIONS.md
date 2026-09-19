# Poly Haven conversion tool lock

- KTX-Software / `toktx`: 4.4.2 (`sha256:1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe` for the Windows x64 installer)
- OpenImageIO / `oiiotool`: 3.1.17.0 (`openimageio-3.1.17.0-cp312-cp312-win_amd64.whl`)
- Runtime decoder: Three.js 0.183.x `KTX2Loader` with the matching locally hosted Basis transcoder

The ingest job must record the exact executable version output and CI image digest in every release manifest. A converter or configuration change creates a new immutable release.
