# Morningstar — port Android

O jogo original é um **projeto Scratch 3 (TurboWarp) dentro de um app Electron**. Este port troca só o "casco":
o jogo roda em um WebView/Chrome, e as chamadas de arquivo do Node (que o Electron fornecia) são
reimplementadas por um disco virtual. **A lógica do jogo não foi alterada.**

## Rodar no celular agora (sem APK)
1. Instale o **Termux** (F-Droid) e rode: `pkg install python unzip`
2. Extraia este zip, entre na pasta e rode: `python3 tools/serve.py`
3. No Chrome do Android abra `http://localhost:8080`. Menu ⋮ → **Instalar app** (tela cheia, paisagem).

## Gerar o APK
O build precisa de Node 22, JDK 21 e Android SDK (não existem no ambiente onde este projeto foi feito).
- **GitHub Actions** (grátis): suba o projeto pelo `git` (o navegador só aceita arquivos até 25 MB; `part1.zip` tem 43 MB)
  e rode o workflow **Gerar APK**; o APK sai como artefato. Precisa de um computador uma única vez, ou do Termux: `bash tools/enviar_github.sh` faz o envio pelo celular (pede usuário, repositório, e-mail e token).
- **Local**: `npm install` → `npx cap add android` → `python3 tools/android_customize.py` → `npx cap sync android` →
  `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`.
O APK de debug instala direto (origens desconhecidas). O workflow assina com `tools/debug.keystore` (chave de debug fixa, sem valor sensível; não serve para a Play Store), então os APKs seguintes **instalam por cima do anterior sem apagar os saves**. Sem uma chave fixa, cada build sairia com assinatura diferente e o Android recusaria a atualização. Para a Play Store é preciso assinar e usar AAB (o pacote é grande, ~120 MB).

## Controles de toque (aparecem sozinhos em telas de toque)
Direcional (**D-pad** ou **Analógico**, com diagonais) + 7 botões: **Z, X, C, Shift, Enter, Esc, Ctrl** (Ctrl vem desligado).
Toque na engrenagem ⚙ (canto superior direito): modo Automático/Sempre/Nunca, D-pad ou Analógico, **opacidade**, **tamanho**,
vibração, esconder com controle físico, modo canhoto, botões visíveis, e **Editar posições e tamanhos** (arraste cada controle;
tamanho individual; paisagem e retrato separados). Tudo é salvo no aparelho. Controle Bluetooth funciona pela Gamepad API do jogo.
**Estilo**: *Undertale* (padrão: pixel-art, fonte do próprio jogo, coração vermelho no botão pressionado, setas pixel) ou *Clássico*.
**Toque imediato**: o jogo lê as teclas a cada passo (30/s); se ele engasga, um toque curto caía entre dois passos e se perdia. Agora a
tecla só é solta depois que o jogo executou 2 passos com ela pressionada (teto de 2,5 s).

## Desempenho e memória (⚙ › Desempenho)
- **Memória**: o runtime não liberava o áudio decodificado de sons apagados (cada música externa pesa 30–60 MB decodificada e ficava
  presa até o fim da sessão). `perf.js` solta esse áudio quando o som para. Causa provável de o app fechar após várias trocas de música.
- **Resolução**: Auto / Alta / Média (960 px) / Baixa (640×480, o tamanho do palco). Em celular o canvas chegava a ~1500×1100 px.
  *Auto* começa em Alta e baixa sozinho se o jogo ficar 8 s abaixo de 24 passos/s (só avalia após 40 s de jogo).
- **Movimento**: Original (30) ou *Suave* (interpolação, acompanha a taxa da tela detectada: 60/90/120 Hz; em 90 Hz+ há meia taxa).
- **Mostrar FPS** (passos do jogo/s, quadros/s, resolução) e **Copiar relatório**: registro das últimas transmissões do jogo, sons
  carregados/apagados, erros e memória. Fica no IndexedDB; se o app fechar sozinho, o aviso aparece na próxima abertura.

## Ícone do app
`assets/icon.png` → `python3 tools/make_icons.py minha_imagem.png` gera ícone adaptativo, redondo e a tela de abertura em
`android-res/` (versionada; `android_customize.py` copia para o projeto). Hoje é uma arte provisória (coração + estrela). Requer Pillow.

## O que foi alterado
- `index.html`: 5 mudanças (scripts do port, espera do disco virtual antes de iniciar, notch, manifesto de app). `tools/patch_index.py` reaplica.
- Novos em `www/ms-android/`: `vfs-shim.js` (fs/path/os/process/Buffer; caminhos do Windows `\`, sem diferenciar maiúsculas;
  saves no IndexedDB), `touch-controls.js`, `perf.js` (memória, resolução, FPS, relatório), `ms-extras.js` (pausa em segundo plano, tela acesa, GPU de alto desempenho),
  `manifest.json` (gerado por `tools/gen_manifest.py`), `app.webmanifest`.
- Os outros 342 arquivos do jogo são **idênticos** ao original (conferido por hash; ver `tools/ORIGINAL_SHA256.txt`).
- `tools/android_customize.py` também ajusta o `build.gradle` para o Android **não descartar arquivos que começam com ponto** (`data/lang/.README.txt` está no manifesto do disco virtual).

## Verificado × não verificado
Verificado (Chromium 141 + Node 22): o código **original** das extensões de arquivo rodando sobre o shim (18 testes); controles de toque com
toques reais, multitoque, painel, editor e persistência (13 testes); `perf.js` no jogo rodando (tests/test_perf.py: resolução, movimento suave,
vazamento de áudio com controle sem a correção, toque durante engasgo de 700 ms, crash do renderer e persistência) e funções puras (25 testes);
boot completo do jogo até o `part1.zip`, sem erros no console.
**Não verificado:** build do APK; ícone e splash (conferidos só em prévia, não em aparelho); se o vazamento de áudio era mesmo a causa do crash no primeiro inimigo dos sonhos; `MainActivity.java` gerado (não compilado); qualquer aparelho Android real; desempenho (o teste rodou em GPU por
software, ~5 fps, sem valor como medida); jogar o jogo inteiro; áudio (o ambiente de teste não toca som).

## Limitações e riscos conhecidos
- Memória: o jogo carrega ~63 MB de dados e um JSON de ~20 MB. Aparelhos com 2 GB de RAM ou menos podem fechar o app.
- O jogo procura a pasta `UNDERTALE` do Windows; no Android ela não existe (a verificação devolve "não existe").
- Saves ficam no armazenamento do WebView: limpar os dados do app apaga os saves. O app já pede armazenamento persistente ao navegador para reduzir o risco de perder saves.
- Em telas 16:9 os controles sobrepõem parte do jogo; reduza tamanho/opacidade ou reposicione no editor.
- Capacitor fixado em 8.5.3 (com `package-lock.json`); o Gradle 8.14.3 e o AGP 8.13.0 vêm dessa versão. A geração do projeto Android (`cap add`, `android_customize.py`, `cap sync`) foi conferida; o `gradlew assembleDebug` não. Se o workflow falhar, o log aponta o passo.
