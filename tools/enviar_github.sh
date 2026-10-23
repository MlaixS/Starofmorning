#!/usr/bin/env bash
# Envia o projeto para o GitHub (feito para o Termux). O envio dispara o workflow "Gerar APK".
# Uso, dentro da pasta do projeto:  bash tools/enviar_github.sh
set -u
cd "$(dirname "$0")/.." || exit 1
command -v git >/dev/null || { echo "git não encontrado. Rode: pkg install git"; exit 1; }

read -rp "Usuário do GitHub: " U
read -rp "Nome do repositório (já criado, vazio): " R
read -rp "Seu e-mail: " E
read -rsp "Token (não aparece enquanto você cola): " T; echo
if [ -z "$U" ] || [ -z "$R" ] || [ -z "$E" ] || [ -z "$T" ]; then echo "Faltou preencher algum campo."; exit 1; fi

[ -d .git ] || git init -q
git add -A
git diff --cached --quiet || git -c user.name="$U" -c user.email="$E" commit -q -m "Morningstar Android"
git branch -M main
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/$U/$R.git"

# O token vai por variável de ambiente (nunca na URL nem em arquivo).
ASK="$(mktemp)"; trap 'rm -f "$ASK"' EXIT
cat > "$ASK" <<'ASKEOF'
#!/bin/sh
case "$1" in Username*) printf '%s' "$GH_U" ;; *) printf '%s' "$GH_T" ;; esac
ASKEOF
chmod 700 "$ASK"

echo "Enviando (uns 120 MB; use Wi-Fi)..."
if GH_U="$U" GH_T="$T" GIT_ASKPASS="$ASK" GIT_TERMINAL_PROMPT=0 git -c http.postBuffer=524288000 push origin main; then
  echo; echo "Pronto! O build começou. Acompanhe em: https://github.com/$U/$R/actions"
else
  echo; echo "O envio falhou. Causas comuns:"
  echo " - token sem os escopos repo e workflow (erro 403)"
  echo " - usuário ou nome do repositório errado (erro 404)"
  echo " - repositório não está vazio: crie outro, sem README/.gitignore/licença"
  exit 1
fi
