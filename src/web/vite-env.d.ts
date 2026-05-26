/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENTDESK_API_BASE_URL?: string;
  readonly VITE_AGENTDESK_PROJECT_ROOT?: string;
  readonly VITE_AGENTDESK_USE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
