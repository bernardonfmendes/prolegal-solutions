// Configuração da app. Só precisa de editar este ficheiro.
// 1. Crie um projeto em supabase.com (escolha a região Europa, ex.: Frankfurt ou Irlanda).
// 2. Em Project Settings → API copie o "Project URL" e a chave "anon public".
// A chave anon é pública por desenho: a segurança está nas regras RLS do supabase.sql.
window.APP_CONFIG = {
  SUPABASE_URL: 'COLE_AQUI_O_PROJECT_URL',          // ex.: https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_CHAVE_ANON',      // começa por eyJ...
  // Assinatura usada nas mensagens de confirmação enviadas aos clientes
  ASSINATURA: 'Prolegal Solutions'
};
