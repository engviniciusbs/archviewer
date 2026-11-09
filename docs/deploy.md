# Produção

O app roda em **https://archviewer.viniciusbsarmento.com**.

- Todo push na `main` dispara o workflow `ci`. Se o job `core` passar (Rust, WASM, testes, typecheck, lint e e2e), o job `deploy` publica o `apps/web/dist` no environment `production`.
- O app é estático. Na VPS, o nginx serve `/var/www/archviewer/current`, e só o Cloudflare (proxy, SSL strict) chega à origem.
- O deploy entra como o usuário `archviewer`. A chave dele é restrita, no servidor, ao script [`deploy/archviewer-receive.sh`](../deploy/archviewer-receive.sh), instalado em `/usr/local/bin/archviewer-receive`. O script cria uma release nova, troca o link `current` e mantém as 5 últimas.
- **Rollback:** na VPS, aponte `current` para uma release anterior, por exemplo `ln -sfn /var/www/archviewer/releases/<release> /var/www/archviewer/current`.
- **Secrets** (environment `production`, liberado só para a `main`): `ARCHVIEWER_DEPLOY_KEY`, `ARCHVIEWER_KNOWN_HOSTS` e a variável `DEPLOY_HOST`.
