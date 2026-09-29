# Content management system

The CMS lives in `src/components/cms` and is available from the profile menu only to the verified administrator `craigtrickett@gmail.com`.

It stores `marketingCms/draft`, `marketingCms/published`, and immutable `marketingCmsHistory/{revision}` documents in the existing Enterprise Firestore database. Published content is public read-only; drafts and history are administrator-only. Images use immutable administrator-only uploads under `marketing-media/`.

The original five marketing routes remain the source of their layout. Their native sections are represented in the editor so they can be reordered or hidden, while their copy and recognised media slots are editable. New pages and structured sections are rendered by the CMS layout. An empty CMS document always falls back to the existing source, so initial deployment does not alter the current site.

For agent updates, use [AI-WORKFLOW.md](./AI-WORKFLOW.md). The client checks the proposal baseline and Firestore rules require atomic draft and publication revisions.
