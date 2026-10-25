# Halloween 42sp Voting

Aplicação web para votação da plateia, avaliação dos jurados e administração do concurso de fantasias Halloween 42sp. A interface React e a API Node/Express são publicadas pela Vercel; os dados persistem no Supabase PostgreSQL.

## Requisitos

- Node.js 20 ou superior
- npm
- Projeto Supabase

## Configurar o Supabase

1. No Supabase, abra o **SQL Editor** e execute, em ordem, as migrations em `supabase/migrations/`: [`202610250001_initial_schema.sql`](./supabase/migrations/202610250001_initial_schema.sql), [`202610250002_qr_code_visibility.sql`](./supabase/migrations/202610250002_qr_code_visibility.sql) e [`202610250003_encrypted_judge_pins.sql`](./supabase/migrations/202610250003_encrypted_judge_pins.sql). Elas criam o esquema, o controle de visibilidade do QR Code e o armazenamento criptografado dos PINs.
2. Em **Project Settings → Database → Connection string**, selecione **Transaction pooler** (porta `6543`) e copie a connection string.
3. Preencha `.env.local` (ou `.env`) com:

```env
DATABASE_URL=postgresql://postgres.projeto:senha@aws-0-regiao.pooler.supabase.com:6543/postgres?sslmode=require
ADMIN_USERNAME=admin
ADMIN_PASSWORD=defina-uma-senha-forte
SESSION_SECRET=gere-um-segredo-aleatorio-com-32-caracteres-ou-mais
PORT=3001
```

Substitua a connection string de exemplo pelos dados reais do seu projeto. Gere um segredo de sessão com, por exemplo, `openssl rand -base64 32`. O servidor conecta diretamente ao PostgreSQL; não precisa de `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_ANON_KEY`. A chave `anon` e a URL pública são necessárias quando o navegador usa o SDK Supabase diretamente, o que esta aplicação não faz.

Para a função serverless da Vercel, o pool local do `pg` fica limitado a uma conexão. O cliente força TLS, mas aceita a cadeia de certificado do pooler sem validá-la (`rejectUnauthorized: false`), necessário para contornar a cadeia autoassinada reportada pelo pooler. O tráfego segue criptografado; para também validar a identidade do servidor, configure o certificado CA do Supabase no cliente Postgres antes de usar em ambientes que exijam verificação estrita do certificado.

> **Segurança:** nunca inclua `DATABASE_URL`, `ADMIN_PASSWORD` ou `SESSION_SECRET` em variáveis `VITE_*`, no frontend, em commits ou em repositórios públicos. A API exige usuário e senha do painel e emite um token de sessão HMAC com validade de 12 horas. As operações críticas de voto e finalização são funções SQL transacionais.

## Executar localmente

```bash
npm install
npm run dev
```

O frontend fica em `http://localhost:5173` e a API em `http://localhost:3001`. O Vite encaminha `/api` para a API local. O `.env` é carregado pelo servidor.

## Fluxos

- `/votar`: voto anônimo por dispositivo, liberado somente com a sessão aberta. O token é guardado no `localStorage` e a unicidade é garantida no banco.
- `/jurado/avaliar`: acesso por PIN. O jurado pode navegar e revisar notas; ao finalizar, toda a ficha é gravada atomicamente e bloqueada.
- `/admin`: CRUD de candidatos, gestão de PINs, controle da sessão e ranking com desempates. O ranking atualiza a cada 10 segundos.
- Na página inicial, o QR Code para `/votar` aparece somente quando o admin ativa **Mostrar QR Code** no painel. O endereço é montado com o domínio atual, então no site publicado leva diretamente para a votação da Vercel.

## Publicação na Vercel

1. Importe o repositório na Vercel e mantenha os comandos de build padrão (`npm run build`) e o diretório de saída `dist`.
2. Em **Project Settings → Environment Variables**, configure `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` e `SESSION_SECRET` para os ambientes necessários (Production/Preview/Development). `PORT` não é necessário na Vercel.
3. Faça o deploy. [`vercel.json`](./vercel.json) encaminha `/api/*` à função serverless [`api/index.ts`](./api/index.ts) e as demais rotas ao React SPA.

A API não mantém estado em memória entre requisições. Sessões de jurado são persistidas no Supabase como hashes de tokens com expiração; sessões administrativas são assinadas e stateless. PINs de jurados são mantidos como hash para autenticação e criptografados com `SESSION_SECRET` para consulta no painel. Se o segredo mudar, os PINs criptografados precisarão ser regenerados. PINs antigos, criados antes da migration de criptografia, não podem ser recuperados; use **Novo PIN** no painel para gerar outro. Votos e finalizações são atômicos no PostgreSQL. Os dados do arquivo JSON da versão anterior **não são importados automaticamente**. Preserve e importe manualmente qualquer dado local que precise manter.

## Build e testes

```bash
npm test
npm run build
```
